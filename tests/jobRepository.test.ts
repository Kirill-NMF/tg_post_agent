import { describe, expect, it } from "vitest";
import { InMemoryJobRepository } from "../src/repositories/inMemoryJobRepository.js";

describe("InMemoryJobRepository", () => {
  it("dedupes active jobs and allows a new job after terminal status", async () => {
    const jobs = new InMemoryJobRepository();

    const first = await jobs.enqueue({
      type: "PLAN_SPLIT",
      projectId: "project-1",
      dedupeKey: "project-1:plan",
      payload: { transcriptRef: "stored" },
      runAfter: new Date("2026-01-01T00:00:00Z")
    });
    const duplicate = await jobs.enqueue({
      type: "PLAN_SPLIT",
      projectId: "project-1",
      dedupeKey: "project-1:plan",
      payload: { transcriptRef: "stored" },
      runAfter: new Date("2026-01-01T00:00:00Z")
    });
    expect(duplicate.id).toBe(first.id);

    const claimed = await jobs.claimNextDue({ workerId: "worker-1", now: new Date("2026-01-01T00:00:00Z") });
    expect(claimed?.id).toBe(first.id);
    await jobs.markSucceeded(first.id, { ok: true });

    const afterSuccess = await jobs.enqueue({ type: "PLAN_SPLIT", projectId: "project-1", dedupeKey: "project-1:plan", payload: { transcriptRef: "stored" } });
    expect(afterSuccess.id).not.toBe(first.id);
  });

  it("claims due jobs by run_after then created_at and marks success", async () => {
    const jobs = new InMemoryJobRepository();
    const later = await jobs.enqueue({ type: "FORMAT_POST", payload: {}, runAfter: new Date("2026-01-01T00:01:00Z") });
    const earlier = await jobs.enqueue({ type: "GENERATE_DRAFT", payload: {}, runAfter: new Date("2026-01-01T00:00:30Z") });

    const claimed = await jobs.claimNextDue({ workerId: "worker-1", now: new Date("2026-01-01T00:02:00Z") });
    expect(claimed).toMatchObject({ id: earlier.id, status: "running", attempts: 1, lockedBy: "worker-1" });

    const succeeded = await jobs.markSucceeded(claimed?.id ?? "", { stored: true });
    expect(succeeded).toMatchObject({ status: "succeeded", result: { stored: true }, lockedBy: undefined, lockedAt: undefined });
    expect((await jobs.findById(later.id))?.status).toBe("queued");
  });

  it("schedules retry for retryable failures and fails terminal attempts", async () => {
    const jobs = new InMemoryJobRepository();
    const job = await jobs.enqueue({ type: "TRANSCRIBE_AUDIO", payload: {}, maxAttempts: 2, runAfter: new Date("2026-01-01T00:00:00Z") });

    const firstRun = await jobs.claimNextDue({ workerId: "worker-1", now: new Date("2026-01-01T00:00:00Z") });
    const retry = await jobs.markFailed(
      firstRun?.id ?? "",
      { code: "NETWORK_TIMEOUT", message: "Temporary network timeout.", retryable: true },
      new Date("2026-01-01T00:00:00Z")
    );
    expect(retry.status).toBe("retry_scheduled");
    expect(retry.runAfter.getTime()).toBeGreaterThan(new Date("2026-01-01T00:00:00Z").getTime());

    const secondRun = await jobs.claimNextDue({ workerId: "worker-1", now: retry.runAfter });
    expect(secondRun?.attempts).toBe(2);
    const failed = await jobs.markFailed(secondRun?.id ?? "", { code: "NETWORK_TIMEOUT", message: "Still down.", retryable: true }, retry.runAfter);
    expect(failed).toMatchObject({ id: job.id, status: "failed", errorCode: "NETWORK_TIMEOUT" });
  });

  it("cancels only queued and retry_scheduled jobs for a project", async () => {
    const jobs = new InMemoryJobRepository();
    const queued = await jobs.enqueue({ type: "PLAN_SPLIT", projectId: "project-1", payload: {} });
    const running = await jobs.enqueue({ type: "FORMAT_POST", projectId: "project-1", payload: {} });
    await jobs.claimNextDue({ workerId: "worker-1" });
    await jobs.claimNextDue({ workerId: "worker-1" });

    await jobs.markFailed(queued.id, { code: "RATE_LIMIT", message: "Rate limited.", retryable: true });
    const cancelled = await jobs.cancelQueuedForProject("project-1");

    expect(cancelled).toBe(1);
    expect((await jobs.findById(queued.id))?.status).toBe("cancelled");
    expect((await jobs.findById(running.id))?.status).toBe("running");
  });

  it("recovers stale running jobs without advancing project state", async () => {
    const jobs = new InMemoryJobRepository();
    const retryable = await jobs.enqueue({ type: "REVISE_DRAFT", payload: {}, maxAttempts: 3, runAfter: new Date("2026-01-01T00:00:00Z") });
    const exhausted = await jobs.enqueue({ type: "FORMAT_POST", payload: {}, maxAttempts: 1, runAfter: new Date("2026-01-01T00:00:00Z") });

    await jobs.claimNextDue({ workerId: "worker-1", now: new Date("2026-01-01T00:00:00Z") });
    await jobs.claimNextDue({ workerId: "worker-1", now: new Date("2026-01-01T00:00:00Z") });

    const recovered = await jobs.recoverStaleRunning({ staleBefore: new Date("2026-01-01T00:01:00Z") });

    expect(recovered).toBe(2);
    expect((await jobs.findById(retryable.id))?.status).toBe("retry_scheduled");
    expect((await jobs.findById(exhausted.id))?.status).toBe("failed");
  });
});
