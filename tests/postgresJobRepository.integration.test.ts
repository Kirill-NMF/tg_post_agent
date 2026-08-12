import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import { MockModelAdapters } from "../src/adapters/mockModelAdapters.js";
import type { Job } from "../src/domain/jobTypes.js";
import { PgJobRepository } from "../src/repositories/pgJobRepository.js";
import { PgProjectRepository } from "../src/repositories/pgProjectRepository.js";
import { ProjectService } from "../src/services/projectService.js";
import { openTestDatabase, type TestDatabaseHandle } from "./helpers/postgres.js";

const describeWithPostgres = process.env.TEST_DATABASE_URL ? describe : describe.skip;

let database: TestDatabaseHandle;

describeWithPostgres("PgJobRepository", () => {
  beforeAll(async () => {
    const opened = await openTestDatabase(process.env);
    if (!opened) throw new Error("TEST_DATABASE_URL is required for Postgres integration tests.");
    database = opened;
  });

  afterAll(async () => {
    await database?.close();
  });

  beforeEach(async () => {
    await database.clean();
  });

  it("dedupes active jobs and allows new enqueue after terminal status", async () => {
    const jobs = new PgJobRepository(database.db);

    const first = await jobs.enqueue({ type: "PLAN_SPLIT", dedupeKey: "project-1:plan", payload: { transcriptRef: "project-1" } });
    const duplicate = await jobs.enqueue({ type: "PLAN_SPLIT", dedupeKey: "project-1:plan", payload: { transcriptRef: "project-1" } });
    expect(duplicate.id).toBe(first.id);

    await jobs.claimNextDue({ workerId: "worker-1" });
    await jobs.markSucceeded(first.id, { saved: true });

    const afterTerminal = await jobs.enqueue({ type: "PLAN_SPLIT", dedupeKey: "project-1:plan", payload: { transcriptRef: "project-1" } });
    expect(afterTerminal.id).not.toBe(first.id);
  });

  it("claims due jobs concurrently with skip-locked semantics", async () => {
    const jobsA = new PgJobRepository(database.db);
    const jobsB = new PgJobRepository(database.db);
    const first = await jobsA.enqueue({ type: "GENERATE_DRAFT", payload: { source: "stored" }, runAfter: new Date("2026-01-01T00:00:00Z") });
    const second = await jobsA.enqueue({ type: "FORMAT_POST", payload: { source: "stored" }, runAfter: new Date("2026-01-01T00:00:00Z") });

    const claimed = await Promise.all([
      jobsA.claimNextDue({ workerId: "worker-a", now: new Date("2026-01-01T00:00:01Z") }),
      jobsB.claimNextDue({ workerId: "worker-b", now: new Date("2026-01-01T00:00:01Z") })
    ]);

    expect(new Set(claimed.map((job) => job?.id))).toEqual(new Set([first.id, second.id]));
    expect(claimed.every((job) => job?.status === "running")).toBe(true);
    expect(claimed.every((job) => job?.attempts === 1)).toBe(true);
  });

  it("schedules retryable failures and stops after max attempts", async () => {
    const jobs = new PgJobRepository(database.db);
    const job = await jobs.enqueue({ type: "TRANSCRIBE_AUDIO", payload: {}, maxAttempts: 2, runAfter: new Date("2026-01-01T00:00:00Z") });

    const firstRun = await jobs.claimNextDue({ workerId: "worker-1", now: new Date("2026-01-01T00:00:01Z") });
    expect(firstRun?.id).toBe(job.id);
    const retry = await jobs.markFailed(job.id, { code: "NETWORK_TIMEOUT", message: "Temporary timeout.", retryable: true }, new Date("2026-01-01T00:00:01Z"));
    expect(retry.status).toBe("retry_scheduled");
    expect(retry.runAfter.getTime()).toBeGreaterThan(new Date("2026-01-01T00:00:01Z").getTime());

    const secondRun = await jobs.claimNextDue({ workerId: "worker-1", now: retry.runAfter });
    expect(secondRun?.attempts).toBe(2);
    const failed = await jobs.markFailed(job.id, { code: "NETWORK_TIMEOUT", message: "Still timing out.", retryable: true }, retry.runAfter);
    expect(failed.status).toBe("failed");
    expect(failed.finishedAt).toBeInstanceOf(Date);
  });

  it("recovers stale running jobs to retry_scheduled or failed", async () => {
    const jobs = new PgJobRepository(database.db);
    const retryable = await jobs.enqueue({ type: "REVISE_DRAFT", payload: {}, maxAttempts: 3, runAfter: new Date("2026-01-01T00:00:00Z") });
    const exhausted = await jobs.enqueue({ type: "FORMAT_POST", payload: {}, maxAttempts: 1, runAfter: new Date("2026-01-01T00:00:00Z") });

    await jobs.claimNextDue({ workerId: "worker-1", now: new Date("2026-01-01T00:00:00Z") });
    await jobs.claimNextDue({ workerId: "worker-1", now: new Date("2026-01-01T00:00:00Z") });

    const recovered = await jobs.recoverStaleRunning({ staleBefore: new Date("2026-01-01T00:01:00Z") });

    expect(recovered).toBe(2);
    expect(await jobs.findById(retryable.id)).toMatchObject({ status: "retry_scheduled", lockedBy: undefined, lockedAt: undefined });
    expect(await jobs.findById(exhausted.id)).toMatchObject({ status: "failed", errorCode: "STALE_RUNNING_EXHAUSTED" });
  });

  it("persists a TRANSCRIBE_EDIT_AUDIO job after migrations", async () => {
    const jobs = new PgJobRepository(database.db);

    const job = await jobs.enqueue({
      type: "TRANSCRIBE_EDIT_AUDIO",
      payload: { source: "telegram_file" }
    });

    await expect(jobs.findById(job.id)).resolves.toMatchObject({
      id: job.id,
      type: "TRANSCRIBE_EDIT_AUDIO",
      status: "queued"
    });
  });

  it("cancels queued and retry_scheduled project jobs while preserving running jobs", async () => {
    const projectId = await createProjectId();
    const jobs = new PgJobRepository(database.db);

    const queued = await jobs.enqueue({ type: "PLAN_SPLIT", projectId, payload: {}, runAfter: new Date("2099-01-01T00:00:00Z") });
    const retryCandidate = await jobs.enqueue({ type: "GENERATE_DRAFT", projectId, payload: {}, maxAttempts: 2 });
    const running = await jobs.enqueue({ type: "FORMAT_POST", projectId, payload: {} });
    await claimSpecificJob(jobs, retryCandidate.id);
    await jobs.markFailed(retryCandidate.id, { code: "RATE_LIMIT", message: "Rate limited.", retryable: true });
    await claimSpecificJob(jobs, running.id);

    const cancelled = await jobs.cancelQueuedForProject(projectId);

    expect(cancelled).toBe(2);
    expect((await jobs.findById(queued.id))?.status).toBe("cancelled");
    expect((await jobs.findById(retryCandidate.id))?.status).toBe("cancelled");
    expect((await jobs.findById(running.id))?.status).toBe("running");
  });
});

async function createProjectId(): Promise<string> {
  const projectRepository = new PgProjectRepository(database.db);
  const service = new ProjectService(projectRepository, new MockModelAdapters());
  await service.start("100", "200");
  const project = await service.getActiveProject("100");
  if (!project) throw new Error("Expected test project.");
  return project.id;
}

async function claimSpecificJob(jobs: PgJobRepository, jobId: string): Promise<Job> {
  for (let index = 0; index < 10; index += 1) {
    const claimed = await jobs.claimNextDue({ workerId: `worker-${index}` });
    if (!claimed) throw new Error(`Expected to claim job ${jobId}.`);
    if (claimed.id === jobId) return claimed;
  }
  throw new Error(`Unable to claim job ${jobId}.`);
}
