import type { Job, JobFailure, JobResult, JobType } from "../domain/jobTypes.js";
import { noopLogger, redactJobPayload, type Logger } from "../observability/logger.js";
import type { JobRepository } from "../repositories/jobRepository.js";

export type JobHandler = (job: Job) => Promise<JobResult | void>;
export type JobHandlers = Partial<Record<JobType, JobHandler>>;

export type ProcessOneResult =
  | { processed: false; reason: "no_job" }
  | { processed: true; jobId: string; status: "succeeded" | "failed" | "retry_scheduled" };

export class RetryableJobError extends Error {
  readonly retryable = true;

  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export class PermanentJobError extends Error {
  readonly retryable = false;

  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export class JobWorker {
  constructor(
    private readonly jobs: JobRepository,
    private readonly handlers: JobHandlers,
    private readonly logger: Logger = noopLogger
  ) {}

  async processOne(input: { workerId: string; now?: Date }): Promise<ProcessOneResult> {
    const job = await this.jobs.claimNextDue(input);
    if (!job) return { processed: false, reason: "no_job" };

    this.logger.info({ event: "job_claimed", jobId: job.id, type: job.type, attempt: job.attempts, ...redactJobPayload(job.payload) }, "job claimed");
    const handler = this.handlers[job.type];
    if (!handler) {
      const failed = await this.jobs.markFailed(job.id, {
        code: "UNKNOWN_JOB_HANDLER",
        message: `No handler registered for job type ${job.type}.`,
        retryable: false
      });
      this.logger.error({ event: "job_failed", jobId: job.id, type: job.type, status: failed.status, errorCode: failed.errorCode }, "job failed");
      return { processed: true, jobId: job.id, status: failed.status === "retry_scheduled" ? "retry_scheduled" : "failed" };
    }

    try {
      this.logger.info({ event: "job_started", jobId: job.id, type: job.type, attempt: job.attempts }, "job started");
      const result = (await handler(job)) ?? {};
      await this.jobs.markSucceeded(job.id, result);
      this.logger.info({ event: "job_succeeded", jobId: job.id, type: job.type }, "job succeeded");
      return { processed: true, jobId: job.id, status: "succeeded" };
    } catch (error) {
      const failure = failureFromError(error);
      const updated = await this.jobs.markFailed(job.id, failure);
      const level = updated.status === "retry_scheduled" ? "warn" : "error";
      this.logger[level](
        { event: updated.status === "retry_scheduled" ? "job_retry_scheduled" : "job_failed", jobId: job.id, type: job.type, status: updated.status, errorCode: failure.code },
        updated.status === "retry_scheduled" ? "job retry scheduled" : "job failed"
      );
      return { processed: true, jobId: job.id, status: updated.status === "retry_scheduled" ? "retry_scheduled" : "failed" };
    }
  }
}

function failureFromError(error: unknown): JobFailure {
  if (error instanceof RetryableJobError || error instanceof PermanentJobError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  if (error instanceof Error) {
    return { code: "JOB_HANDLER_ERROR", message: error.message, retryable: false };
  }
  return { code: "JOB_HANDLER_ERROR", message: "Unknown job handler failure.", retryable: false };
}
