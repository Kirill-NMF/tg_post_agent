import type { PostId, ProjectId } from "./types.js";

export type JobId = string;

export type JobType =
  | "TRANSCRIBE_EDIT_AUDIO"
  | "TRANSCRIBE_AUDIO"
  | "PLAN_SPLIT"
  | "REVISE_PLAN"
  | "GENERATE_DRAFT"
  | "REVISE_DRAFT"
  | "FORMAT_POST"
  | "REVISE_FORMATTING"
  | "GENERATE_TXT_ARTIFACT"
  | "CLEANUP_TEMP_FILES";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "retry_scheduled";
export type JobPayload = Record<string, unknown>;
export type JobResult = Record<string, unknown>;

export type Job = {
  id: JobId;
  type: JobType;
  status: JobStatus;
  projectId?: ProjectId;
  postId?: PostId;
  dedupeKey?: string;
  payload: JobPayload;
  result?: JobResult;
  errorCode?: string;
  errorMessage?: string;
  attempts: number;
  maxAttempts: number;
  runAfter: Date;
  lockedBy?: string;
  lockedAt?: Date;
  startedAt?: Date;
  finishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type EnqueueJobInput = {
  type: JobType;
  projectId?: ProjectId;
  postId?: PostId;
  dedupeKey?: string;
  payload: JobPayload;
  maxAttempts?: number;
  runAfter?: Date;
};

export type JobFailure = {
  code: string;
  message: string;
  retryable: boolean;
};

export type RecoverStaleJobsInput = {
  staleBefore: Date;
};
