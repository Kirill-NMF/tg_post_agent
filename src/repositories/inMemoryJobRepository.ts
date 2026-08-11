import { randomUUID } from "node:crypto";
import type { EnqueueJobInput, Job, JobFailure, JobId, RecoverStaleJobsInput } from "../domain/jobTypes.js";
import type { ProjectId } from "../domain/types.js";
import { nextRetryRunAfter } from "../jobs/backoff.js";
import type { JobRepository } from "./jobRepository.js";

const activeDedupeStatuses = new Set(["queued", "running", "retry_scheduled"]);

export class InMemoryJobRepository implements JobRepository {
  private readonly jobs = new Map<JobId, Job>();

  async enqueue(input: EnqueueJobInput): Promise<Job> {
    if (input.dedupeKey) {
      const existing = [...this.jobs.values()].find((job) => job.dedupeKey === input.dedupeKey && activeDedupeStatuses.has(job.status));
      if (existing) return cloneJob(existing);
    }

    const now = new Date();
    const job: Job = {
      id: randomUUID(),
      type: input.type,
      status: "queued",
      projectId: input.projectId,
      postId: input.postId,
      dedupeKey: input.dedupeKey,
      payload: cloneRecord(input.payload),
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 3,
      runAfter: input.runAfter ? new Date(input.runAfter) : now,
      createdAt: now,
      updatedAt: now
    };
    this.jobs.set(job.id, job);
    return cloneJob(job);
  }

  async findById(jobId: JobId): Promise<Job | undefined> {
    const job = this.jobs.get(jobId);
    return job ? cloneJob(job) : undefined;
  }

  async claimNextDue(input: { workerId: string; now?: Date }): Promise<Job | undefined> {
    const now = input.now ?? new Date();
    const job = [...this.jobs.values()]
      .filter((candidate) => (candidate.status === "queued" || candidate.status === "retry_scheduled") && candidate.runAfter <= now)
      .sort((left, right) => left.runAfter.getTime() - right.runAfter.getTime() || left.createdAt.getTime() - right.createdAt.getTime())[0];
    if (!job) return undefined;

    job.status = "running";
    job.attempts += 1;
    job.lockedBy = input.workerId;
    job.lockedAt = now;
    job.startedAt = now;
    job.updatedAt = now;
    return cloneJob(job);
  }

  async markSucceeded(jobId: JobId, result: Record<string, unknown> = {}): Promise<Job> {
    const job = mustGet(this.jobs, jobId);
    const now = new Date();
    job.status = "succeeded";
    job.result = cloneRecord(result);
    job.errorCode = undefined;
    job.errorMessage = undefined;
    job.lockedBy = undefined;
    job.lockedAt = undefined;
    job.finishedAt = now;
    job.updatedAt = now;
    return cloneJob(job);
  }

  async markFailed(jobId: JobId, failure: JobFailure, now: Date = new Date()): Promise<Job> {
    const job = mustGet(this.jobs, jobId);
    job.errorCode = failure.code;
    job.errorMessage = failure.message;
    job.lockedBy = undefined;
    job.lockedAt = undefined;

    if (failure.retryable && job.attempts < job.maxAttempts) {
      job.status = "retry_scheduled";
      job.runAfter = nextRetryRunAfter(now, job.attempts);
      job.finishedAt = undefined;
    } else {
      job.status = "failed";
      job.finishedAt = now;
    }

    job.updatedAt = now;
    return cloneJob(job);
  }

  async cancelQueuedForProject(projectId: ProjectId): Promise<number> {
    let cancelled = 0;
    const now = new Date();
    for (const job of this.jobs.values()) {
      if (job.projectId === projectId && (job.status === "queued" || job.status === "retry_scheduled")) {
        job.status = "cancelled";
        job.finishedAt = now;
        job.updatedAt = now;
        cancelled += 1;
      }
    }
    return cancelled;
  }

  async recoverStaleRunning(input: RecoverStaleJobsInput): Promise<number> {
    let recovered = 0;
    const now = new Date();
    for (const job of this.jobs.values()) {
      if (job.status !== "running" || !job.lockedAt || job.lockedAt >= input.staleBefore) continue;
      job.lockedBy = undefined;
      job.lockedAt = undefined;
      if (job.attempts >= job.maxAttempts) {
        job.status = "failed";
        job.finishedAt = now;
        job.errorCode = job.errorCode ?? "STALE_RUNNING_EXHAUSTED";
        job.errorMessage = job.errorMessage ?? "Stale running job exhausted retry attempts.";
      } else {
        job.status = "retry_scheduled";
        job.runAfter = now;
      }
      job.updatedAt = now;
      recovered += 1;
    }
    return recovered;
  }
}

function mustGet(jobs: Map<JobId, Job>, jobId: JobId): Job {
  const job = jobs.get(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  return job;
}

function cloneJob(job: Job): Job {
  return {
    ...job,
    payload: cloneRecord(job.payload),
    result: job.result ? cloneRecord(job.result) : undefined,
    runAfter: new Date(job.runAfter),
    lockedAt: job.lockedAt ? new Date(job.lockedAt) : undefined,
    startedAt: job.startedAt ? new Date(job.startedAt) : undefined,
    finishedAt: job.finishedAt ? new Date(job.finishedAt) : undefined,
    createdAt: new Date(job.createdAt),
    updatedAt: new Date(job.updatedAt)
  };
}

function cloneRecord<T extends Record<string, unknown>>(value: T): T {
  return structuredClone(value);
}
