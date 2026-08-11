import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import type { AppDb } from "../db/connection.js";
import type { EnqueueJobInput, Job, JobFailure, JobId, JobStatus, JobType, RecoverStaleJobsInput } from "../domain/jobTypes.js";
import type { PostId, ProjectId } from "../domain/types.js";
import { nextRetryRunAfter } from "../jobs/backoff.js";
import type { JobRepository } from "./jobRepository.js";

type JobRow = {
  id: string;
  type: JobType;
  status: JobStatus;
  project_id: string | null;
  post_id: string | null;
  dedupe_key: string | null;
  payload_json: unknown;
  result_json: unknown;
  error_code: string | null;
  error_message: string | null;
  attempts: number;
  max_attempts: number;
  run_after: Date;
  locked_by: string | null;
  locked_at: Date | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

const activeDedupeStatuses = sql`('queued', 'running', 'retry_scheduled')`;

export class PgJobRepository implements JobRepository {
  constructor(private readonly db: AppDb) {}

  async enqueue(input: EnqueueJobInput): Promise<Job> {
    const now = new Date();
    const rows = rowsOf<JobRow>(
      await this.db.execute(sql`
        insert into jobs (
          id, type, status, project_id, post_id, dedupe_key, payload_json,
          max_attempts, run_after, created_at, updated_at
        )
        values (
          ${randomUUID()}, ${input.type}, 'queued', ${input.projectId ?? null}, ${input.postId ?? null},
          ${input.dedupeKey ?? null}, ${toJson(input.payload)}, ${input.maxAttempts ?? 3},
          ${input.runAfter ?? now}, ${now}, ${now}
        )
        on conflict (dedupe_key)
          where dedupe_key is not null and status in ${activeDedupeStatuses}
        do update set updated_at = jobs.updated_at
        returning *
      `)
    );
    return fromJobRow(rows[0]);
  }

  async findById(jobId: JobId): Promise<Job | undefined> {
    const rows = rowsOf<JobRow>(await this.db.execute(sql`select * from jobs where id = ${jobId} limit 1`));
    return rows[0] ? fromJobRow(rows[0]) : undefined;
  }

  async claimNextDue(input: { workerId: string; now?: Date }): Promise<Job | undefined> {
    const now = input.now ?? new Date();
    const rows = await this.db.transaction(async (tx) =>
      rowsOf<JobRow>(
        await tx.execute(sql`
          with next_job as (
            select id
            from jobs
            where status in ('queued', 'retry_scheduled')
              and run_after <= ${now}
            order by run_after asc, created_at asc
            limit 1
            for update skip locked
          )
          update jobs
          set status = 'running',
              attempts = jobs.attempts + 1,
              locked_by = ${input.workerId},
              locked_at = ${now},
              started_at = ${now},
              updated_at = ${now}
          from next_job
          where jobs.id = next_job.id
          returning jobs.*
        `)
      )
    );
    return rows[0] ? fromJobRow(rows[0]) : undefined;
  }

  async markSucceeded(jobId: JobId, result: Record<string, unknown> = {}): Promise<Job> {
    const now = new Date();
    const rows = rowsOf<JobRow>(
      await this.db.execute(sql`
        update jobs
        set status = 'succeeded',
            result_json = ${toJson(result)},
            error_code = null,
            error_message = null,
            locked_by = null,
            locked_at = null,
            finished_at = ${now},
            updated_at = ${now}
        where id = ${jobId}
        returning *
      `)
    );
    return mustReturn(rows, jobId);
  }

  async markFailed(jobId: JobId, failure: JobFailure, now: Date = new Date()): Promise<Job> {
    return this.db.transaction(async (tx) => {
      const current = mustReturnRow(
        rowsOf<JobRow>(
          await tx.execute(sql`
            select *
            from jobs
            where id = ${jobId}
            for update
          `)
        ),
        jobId
      );

      const shouldRetry = failure.retryable && current.attempts < current.max_attempts;
      const rows = rowsOf<JobRow>(
        await tx.execute(sql`
          update jobs
          set status = ${shouldRetry ? "retry_scheduled" : "failed"},
              run_after = ${shouldRetry ? nextRetryRunAfter(now, current.attempts) : current.run_after},
              error_code = ${safeErrorCode(failure.code)},
              error_message = ${safeErrorMessage(failure.message)},
              locked_by = null,
              locked_at = null,
              finished_at = ${shouldRetry ? null : now},
              updated_at = ${now}
          where id = ${jobId}
          returning *
        `)
      );
      return mustReturn(rows, jobId);
    });
  }

  async cancelQueuedForProject(projectId: ProjectId): Promise<number> {
    const rows = rowsOf<{ id: string }>(
      await this.db.execute(sql`
        update jobs
        set status = 'cancelled',
            locked_by = null,
            locked_at = null,
            finished_at = now(),
            updated_at = now()
        where project_id = ${projectId}
          and status in ('queued', 'retry_scheduled')
        returning id
      `)
    );
    return rows.length;
  }

  async recoverStaleRunning(input: RecoverStaleJobsInput): Promise<number> {
    return this.db.transaction(async (tx) => {
      const staleJobs = rowsOf<JobRow>(
        await tx.execute(sql`
          select *
          from jobs
          where status = 'running'
            and locked_at < ${input.staleBefore}
          order by locked_at asc, created_at asc
          for update
        `)
      );

      for (const job of staleJobs) {
        const shouldFail = job.attempts >= job.max_attempts;
        await updateRecoveredJob(tx, job, shouldFail);
      }

      return staleJobs.length;
    });
  }
}

async function updateRecoveredJob(tx: { execute(query: SQL): Promise<unknown> }, job: JobRow, shouldFail: boolean): Promise<void> {
  await tx.execute(sql`
    update jobs
    set status = ${shouldFail ? "failed" : "retry_scheduled"},
        run_after = ${shouldFail ? job.run_after : new Date()},
        error_code = ${shouldFail ? job.error_code ?? "STALE_RUNNING_EXHAUSTED" : job.error_code},
        error_message = ${shouldFail ? job.error_message ?? "Stale running job exhausted retry attempts." : job.error_message},
        locked_by = null,
        locked_at = null,
        finished_at = ${shouldFail ? new Date() : null},
        updated_at = now()
    where id = ${job.id}
  `);
}

function rowsOf<T>(result: unknown): T[] {
  return (result as { rows?: T[] }).rows ?? [];
}

function fromJobRow(row: JobRow | undefined): Job {
  if (!row) throw new Error("Job query returned no rows.");
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    projectId: row.project_id ?? undefined,
    postId: row.post_id ?? undefined,
    dedupeKey: row.dedupe_key ?? undefined,
    payload: asRecord(row.payload_json),
    result: row.result_json ? asRecord(row.result_json) : undefined,
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAfter: asDate(row.run_after),
    lockedBy: row.locked_by ?? undefined,
    lockedAt: row.locked_at ? asDate(row.locked_at) : undefined,
    startedAt: row.started_at ? asDate(row.started_at) : undefined,
    finishedAt: row.finished_at ? asDate(row.finished_at) : undefined,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at)
  };
}

function mustReturn(rows: JobRow[], jobId: JobId): Job {
  return fromJobRow(mustReturnRow(rows, jobId));
}

function mustReturnRow(rows: JobRow[], jobId: JobId): JobRow {
  if (!rows[0]) throw new Error(`Job not found: ${jobId}`);
  return rows[0];
}

function toJson(value: unknown): SQL {
  return sql`${JSON.stringify(value)}::jsonb`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function safeErrorCode(code: string): string {
  return code.trim().slice(0, 120) || "JOB_ERROR";
}

function safeErrorMessage(message: string): string {
  return message.trim().slice(0, 500) || "Job failed.";
}
