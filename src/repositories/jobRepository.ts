import type { EnqueueJobInput, Job, JobFailure, JobId, RecoverStaleJobsInput } from "../domain/jobTypes.js";
import type { ProjectId } from "../domain/types.js";

export type JobRepository = {
  enqueue(input: EnqueueJobInput): Promise<Job>;
  findById(jobId: JobId): Promise<Job | undefined>;
  claimNextDue(input: { workerId: string; now?: Date }): Promise<Job | undefined>;
  claimDueById(input: { jobId: JobId; workerId: string; now?: Date }): Promise<Job | undefined>;
  markSucceeded(jobId: JobId, result?: Record<string, unknown>): Promise<Job>;
  markFailed(jobId: JobId, failure: JobFailure, now?: Date): Promise<Job>;
  cancelQueuedForProject(projectId: ProjectId): Promise<number>;
  recoverStaleRunning(input: RecoverStaleJobsInput): Promise<number>;
};
