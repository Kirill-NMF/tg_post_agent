import { describe, expect, it, vi, afterEach } from "vitest";
import type { LogFields, Logger } from "../src/observability/logger.js";
import type { ProcessOneResult } from "../src/services/jobWorker.js";
import { WorkerRuntime } from "../src/services/workerRuntime.js";

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

describe("WorkerRuntime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts, recovers stale jobs, processes one tick, and stops cleanly", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const logger = new CapturingLogger();
    const worker = { processOne: vi.fn().mockResolvedValue({ processed: false, reason: "no_job" } satisfies ProcessOneResult) };
    const jobs = { recoverStaleRunning: vi.fn().mockResolvedValue(2) };
    const runtime = new WorkerRuntime({ worker, jobs, config: config(), logger });

    runtime.start();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    runtime.stop();

    expect(jobs.recoverStaleRunning).toHaveBeenCalledWith({ staleBefore: new Date("2025-12-31T23:45:00Z") });
    expect(worker.processOne).toHaveBeenCalledWith({ workerId: "worker-test" });
    expect(logger.entries.map((entry) => entry.fields.event)).toContain("worker_runtime_started");
    expect(logger.entries.map((entry) => entry.fields.event)).toContain("worker_runtime_tick_completed");
    expect(logger.entries.map((entry) => entry.fields.event)).toContain("worker_runtime_stopped");
  });

  it("does not overlap ticks", async () => {
    vi.useFakeTimers();
    const logger = new CapturingLogger();
    let resolveProcess!: (value: ProcessOneResult) => void;
    const worker = {
      processOne: vi.fn(
        () =>
          new Promise<ProcessOneResult>((resolve) => {
            resolveProcess = resolve;
          })
      )
    };
    const runtime = new WorkerRuntime({ worker, jobs: { recoverStaleRunning: vi.fn().mockResolvedValue(0) }, config: config(), logger });

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    await runtime.tick();
    resolveProcess({ processed: false, reason: "no_job" });
    await Promise.resolve();
    runtime.stop();

    expect(worker.processOne).toHaveBeenCalledTimes(1);
    expect(logger.entries.some((entry) => entry.fields.event === "worker_runtime_tick_skipped")).toBe(true);
  });

  it("logs thrown processOne errors and keeps the loop alive", async () => {
    vi.useFakeTimers();
    const logger = new CapturingLogger();
    const worker = { processOne: vi.fn().mockRejectedValue(new Error("boom")) };
    const runtime = new WorkerRuntime({ worker, jobs: { recoverStaleRunning: vi.fn().mockResolvedValue(0) }, config: config(), logger });

    runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(logger.entries.some((entry) => entry.level === "error" && entry.fields.event === "worker_runtime_tick_failed")).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(worker.processOne).toHaveBeenCalledTimes(2);
    runtime.stop();
  });
});

function config() {
  return {
    enabled: true,
    intervalMs: 1000,
    staleMs: 15 * 60 * 1000,
    workerId: "worker-test"
  };
}
