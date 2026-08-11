import { describe, expect, it } from "vitest";
import type { LogFields, Logger } from "../src/observability/logger.js";
import { InMemoryJobRepository } from "../src/repositories/inMemoryJobRepository.js";
import { JobWorker, RetryableJobError } from "../src/services/jobWorker.js";

class CapturingLogger implements Logger {
  readonly entries: Array<{ level: "info" | "warn" | "error"; fields: LogFields; message: string }> = [];

  info(fields: LogFields, message: string): void {
    this.entries.push({ level: "info", fields, message });
  }

  warn(fields: LogFields, message: string): void {
    this.entries.push({ level: "warn", fields, message });
  }

  error(fields: LogFields, message: string): void {
    this.entries.push({ level: "error", fields, message });
  }
}

describe("JobWorker", () => {
  it("processes one job successfully and logs redacted payload shape", async () => {
    const jobs = new InMemoryJobRepository();
    const logger = new CapturingLogger();
    const job = await jobs.enqueue({ type: "PLAN_SPLIT", payload: { transcript: "full transcript text", projectId: "project-1" } });
    const worker = new JobWorker(
      jobs,
      {
        PLAN_SPLIT: async (claimed) => ({ handledJobId: claimed.id })
      },
      logger
    );

    const result = await worker.processOne({ workerId: "worker-1" });

    expect(result).toEqual({ processed: true, jobId: job.id, status: "succeeded" });
    expect(await jobs.findById(job.id)).toMatchObject({ status: "succeeded", result: { handledJobId: job.id } });
    expect(logger.entries.map((entry) => entry.fields.event)).toEqual(["job_claimed", "job_started", "job_succeeded"]);
    expect(JSON.stringify(logger.entries)).not.toContain("full transcript text");
    expect(logger.entries[0]?.fields.payloadKeys).toBe("projectId,transcript");
  });

  it("marks retryable handler failures as retry_scheduled", async () => {
    const jobs = new InMemoryJobRepository();
    const job = await jobs.enqueue({ type: "FORMAT_POST", payload: {}, maxAttempts: 2, runAfter: new Date("2026-01-01T00:00:00Z") });
    const worker = new JobWorker(jobs, {
      FORMAT_POST: async () => {
        throw new RetryableJobError("RATE_LIMIT", "Provider rate limit.");
      }
    });

    const result = await worker.processOne({ workerId: "worker-1", now: new Date("2026-01-01T00:00:00Z") });

    expect(result).toEqual({ processed: true, jobId: job.id, status: "retry_scheduled" });
    expect(await jobs.findById(job.id)).toMatchObject({ status: "retry_scheduled", attempts: 1, errorCode: "RATE_LIMIT" });
  });

  it("marks jobs with unknown handlers as non-retryable failures", async () => {
    const jobs = new InMemoryJobRepository();
    const job = await jobs.enqueue({ type: "CLEANUP_TEMP_FILES", payload: {} });
    const worker = new JobWorker(jobs, {});

    const result = await worker.processOne({ workerId: "worker-1" });

    expect(result).toEqual({ processed: true, jobId: job.id, status: "failed" });
    expect(await jobs.findById(job.id)).toMatchObject({ status: "failed", errorCode: "UNKNOWN_JOB_HANDLER" });
  });

  it("returns no_job when nothing is due", async () => {
    const jobs = new InMemoryJobRepository();
    await jobs.enqueue({ type: "PLAN_SPLIT", payload: {}, runAfter: new Date("2026-01-01T00:01:00Z") });
    const worker = new JobWorker(jobs, { PLAN_SPLIT: async () => ({ ok: true }) });

    await expect(worker.processOne({ workerId: "worker-1", now: new Date("2026-01-01T00:00:00Z") })).resolves.toEqual({
      processed: false,
      reason: "no_job"
    });
  });
});
