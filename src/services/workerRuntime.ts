import type { JobRepository } from "../repositories/jobRepository.js";
import { noopLogger, type Logger } from "../observability/logger.js";
import type { JobWorker, ProcessOneResult } from "./jobWorker.js";

export type WorkerRuntimeConfig = {
  enabled: boolean;
  intervalMs: number;
  staleMs: number;
  workerId: string;
};

export type WorkerRuntimeTimer = {
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
  now(): number;
};

export type WorkerRuntimeDeps = {
  worker: Pick<JobWorker, "processOne">;
  jobs: Pick<JobRepository, "recoverStaleRunning">;
  config: WorkerRuntimeConfig;
  logger?: Logger;
  timer?: WorkerRuntimeTimer;
};

export class WorkerRuntime {
  private readonly logger: Logger;
  private readonly timer: WorkerRuntimeTimer;
  private timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private ticking = false;
  private lastRecoveryAt = 0;

  constructor(private readonly deps: WorkerRuntimeDeps) {
    this.logger = deps.logger ?? noopLogger;
    this.timer =
      deps.timer ?? {
        setTimeout,
        clearTimeout,
        now: () => Date.now()
      };
  }

  start(): void {
    if (!this.deps.config.enabled || this.running) return;
    this.running = true;
    this.logger.info({ event: "worker_runtime_started", workerId: this.deps.config.workerId, intervalMs: this.deps.config.intervalMs }, "worker runtime started");
    void this.recoverStale("startup");
    this.schedule(0);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timeoutHandle) {
      this.timer.clearTimeout(this.timeoutHandle);
      this.timeoutHandle = undefined;
    }
    this.logger.info({ event: "worker_runtime_stopped", workerId: this.deps.config.workerId }, "worker runtime stopped");
  }

  async tick(): Promise<ProcessOneResult | undefined> {
    if (!this.running) return undefined;
    if (this.ticking) {
      this.logger.warn({ event: "worker_runtime_tick_skipped", workerId: this.deps.config.workerId }, "worker runtime tick skipped");
      return undefined;
    }

    this.ticking = true;
    try {
      await this.recoverStaleIfDue();
      const result = await this.deps.worker.processOne({ workerId: this.deps.config.workerId });
      this.logger.info({ event: "worker_runtime_tick_completed", workerId: this.deps.config.workerId, processed: result.processed }, "worker runtime tick completed");
      return result;
    } catch (error) {
      this.logger.error({ event: "worker_runtime_tick_failed", workerId: this.deps.config.workerId, errorCode: safeErrorCode(error) }, "worker runtime tick failed");
      return undefined;
    } finally {
      this.ticking = false;
      if (this.running) this.schedule(this.deps.config.intervalMs);
    }
  }

  private schedule(ms: number): void {
    this.timeoutHandle = this.timer.setTimeout(() => {
      void this.tick();
    }, ms);
  }

  private async recoverStaleIfDue(): Promise<void> {
    const now = this.timer.now();
    if (now - this.lastRecoveryAt < this.deps.config.staleMs) return;
    await this.recoverStale("periodic");
  }

  private async recoverStale(reason: "startup" | "periodic"): Promise<void> {
    const now = this.timer.now();
    this.lastRecoveryAt = now;
    try {
      const recovered = await this.deps.jobs.recoverStaleRunning({ staleBefore: new Date(now - this.deps.config.staleMs) });
      this.logger.info({ event: "worker_runtime_stale_recovered", workerId: this.deps.config.workerId, reason, recovered }, "worker stale jobs recovered");
    } catch (error) {
      this.logger.error({ event: "worker_runtime_stale_recovery_failed", workerId: this.deps.config.workerId, reason, errorCode: safeErrorCode(error) }, "worker stale recovery failed");
    }
  }
}

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && error.name) return error.name.slice(0, 80);
  return "WORKER_RUNTIME_ERROR";
}
