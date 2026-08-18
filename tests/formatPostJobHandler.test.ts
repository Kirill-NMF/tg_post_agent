import { describe, expect, it } from "vitest";
import type { ModelAdapters } from "../src/domain/modelContracts.js";
import type { Job } from "../src/domain/jobTypes.js";
import type { Project } from "../src/domain/types.js";
import { InMemoryJobRepository } from "../src/repositories/inMemoryJobRepository.js";
import { InMemoryProjectRepository } from "../src/repositories/inMemoryProjectRepository.js";
import { createFormatPostJobHandler } from "../src/services/formatPostJobHandler.js";
import { JobWorker } from "../src/services/jobWorker.js";
import type { TelegramEntitySendOptions, TelegramNotifier, TelegramSendMessageOptions } from "../src/telegram/telegramNotifier.js";
import type { Logger, LogFields } from "../src/observability/logger.js";

describe("FORMAT_POST job handler", () => {
  it("persists a validated formatted result, then notifies exactly once", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const notifier = new CapturingNotifier();
    const project = await seedFormattingProject(projects);
    const job = await jobs.enqueue({
      type: "FORMAT_POST",
      projectId: project.id,
      postId: "post-1",
      payload: { postIndex: 1, formattingOption: "option_1" }
    });
    const worker = new JobWorker(jobs, {
      FORMAT_POST: createFormatPostJobHandler({ projects, formatting: successAdapter(), notifier })
    });

    await expect(worker.processOne({ workerId: "worker-1" })).resolves.toMatchObject({ status: "succeeded" });
    const updated = await projects.findById(project.id);
    expect(updated?.state).toBe("formatted_editing");
    expect(updated?.posts[0]?.formattedText).toBe("*Canonical* draft.");
    expect(updated?.messages.at(-1)).toMatchObject({ kind: "formatted_text", text: "*Canonical* draft." });
    expect(notifier.messages).toHaveLength(1);
    expect(notifier.messages[0]).toMatchObject({ chatId: "200", text: "*Canonical* draft." });
    expect(notifier.messages[0]?.options?.reply_markup?.inline_keyboard.flat().map((button) => button.callback_data)).toEqual(["format:edit", "final:accept"]);
    expect((await jobs.findById(job.id))?.result).toMatchObject({ notificationStatus: "sent" });
  });

  it("uses validated Option 2 final text to persist a formatted final", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const notifier = new CapturingNotifier();
    const project = await seedFormattingProject(projects);
    let legacyCalls = 0;
    let finalTextCalls = 0;
    await jobs.enqueue({ type: "FORMAT_POST", projectId: project.id, payload: { postIndex: 1, formattingOption: "option_2" } });
    const worker = new JobWorker(jobs, {
      FORMAT_POST: createFormatPostJobHandler({
        projects,
        formatting: {
          async formatPost() { legacyCalls += 1; throw new Error("legacy path must not be used"); },
          async formatOption2FinalText(input: { draftText: string }) {
            finalTextCalls += 1;
            expect(input.draftText).toBe("Canonical draft.");
            return { ok: true as const, value: { formattedText: "📜 **Canonical draft.**" }, meta: { provider: "openrouter", modelLabel: "fake-final-text-model" } };
          }
        },
        notifier
      })
    });

    await expect(worker.processOne({ workerId: "worker-1" })).resolves.toMatchObject({ status: "succeeded" });
    expect(finalTextCalls).toBe(1);
    expect(legacyCalls).toBe(0);
    expect((await projects.findById(project.id))?.posts[0]?.formattedText).toBe("📜 **Canonical draft.**");
    expect(notifier.messages).toHaveLength(1);
    expect(notifier.cryptusMessages).toEqual([{ chatId: "200", canonicalText: "📜 **Canonical draft.**" }]);
  });

  it("calls the Option 2 final-text adapter with its bound receiver", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const project = await seedFormattingProject(projects);
    const adapter = {
      marker: "bound",
      async formatPost() { throw new Error("legacy path must not be used"); },
      async formatOption2FinalText() {
        if (this.marker !== "bound") throw new Error("final_text_adapter_receiver_lost");
        return { ok: true as const, value: { formattedText: "📜 **Canonical draft.**" }, meta: { provider: "openrouter" as const, modelLabel: "bound-final-text-model" } };
      }
    };
    await jobs.enqueue({ type: "FORMAT_POST", projectId: project.id, payload: { postIndex: 1, formattingOption: "option_2" } });
    const worker = new JobWorker(jobs, {
      FORMAT_POST: createFormatPostJobHandler({ projects, formatting: adapter })
    });

    await expect(worker.processOne({ workerId: "worker-1" })).resolves.toMatchObject({ status: "succeeded" });
    expect((await projects.findById(project.id))?.posts[0]?.formattedText).toBe("📜 **Canonical draft.**");
  });

  it("recovers an Option 2 contract-invalid final text without mutating the active draft", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const notifier = new CapturingNotifier();
    const project = await seedFormattingProject(projects);
    let legacyCalls = 0;
    let finalTextCalls = 0;
    const job = await jobs.enqueue({ type: "FORMAT_POST", projectId: project.id, payload: { postIndex: 1, formattingOption: "option_2" } });
    const worker = new JobWorker(jobs, {
      FORMAT_POST: createFormatPostJobHandler({
        projects,
        formatting: {
          async formatPost() { legacyCalls += 1; throw new Error("legacy path must not be used"); },
          async formatOption2FinalText() {
            finalTextCalls += 1;
            return { ok: true as const, value: { formattedText: "✨### *Canonical draft.*" }, meta: { provider: "openrouter", modelLabel: "fake-final-text-model" } };
          }
        },
        notifier
      })
    });

    await worker.processOne({ workerId: "worker-1" });
    const restored = await projects.findById(project.id);
    expect((await jobs.findById(job.id))?.status).toBe("failed");
    expect(finalTextCalls).toBe(1);
    expect(legacyCalls).toBe(0);
    expect(restored?.state).toBe("draft_editing");
    expect(restored?.posts[0]?.currentDraft).toBe("Canonical draft.");
    expect(restored?.posts[0]?.formattedText).toBeUndefined();
    expect(notifier.messages).toHaveLength(1);
  });

  it("keeps Option 1 on the legacy formatting adapter path", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const project = await seedFormattingProject(projects);
    let legacyCalls = 0;
    let segmentCalls = 0;
    await jobs.enqueue({ type: "FORMAT_POST", projectId: project.id, payload: { postIndex: 1, formattingOption: "option_1" } });
    const worker = new JobWorker(jobs, {
      FORMAT_POST: createFormatPostJobHandler({
        projects,
        formatting: {
          async formatPost() {
            legacyCalls += 1;
            return { ok: true as const, value: { decorationPlan: { option: "option_1" as const, operations: [] } }, meta: { provider: "openrouter", modelLabel: "legacy-model" } };
          },
          async formatOption2FinalText() { segmentCalls += 1; throw new Error("Option 2 only"); }
        }
      })
    });

    await expect(worker.processOne({ workerId: "worker-1" })).resolves.toMatchObject({ status: "succeeded" });
    expect(legacyCalls).toBe(1);
    expect(segmentCalls).toBe(0);
  });

  it("emits redacted Stage 3 timing for a successful formatting job", async () => {
    const projects = new InMemoryProjectRepository();
    const notifier = new CapturingNotifier();
    const logger = new CapturingLogger();
    const project = await seedFormattingProject(projects);
    const job: Job = { id: "job-timing", type: "FORMAT_POST", projectId: project.id, payload: { postIndex: 1, formattingOption: "option_1" }, status: "running", attempts: 1, maxAttempts: 1, runAfter: new Date(100), createdAt: new Date(100), updatedAt: new Date(100) };
    const values = [500, 510, 530, 540, 550, 560, 570, 580];
    const handler = createFormatPostJobHandler({ projects, formatting: successAdapter(), notifier, logger, now: () => values.shift() ?? 580 });

    await handler(job);

    expect(logger.entries.at(-1)?.fields).toMatchObject({ event: "formatting_job_timing", jobId: "job-timing", type: "FORMAT_POST", terminalCategory: "success", queueWaitMs: 400, providerDurationMs: 20, validationApplicationDurationMs: 10, notifierDurationMs: 10, totalDurationMs: 80 });
    expect(JSON.stringify(logger.entries)).not.toContain("Canonical draft");
  });

  it("restores draft_editing and sends one recovery after permanent malformed output", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const notifier = new CapturingNotifier();
    const project = await seedFormattingProject(projects);
    const job = await jobs.enqueue({ type: "FORMAT_POST", projectId: project.id, payload: { postIndex: 1, formattingOption: "option_1" } });
    const worker = new JobWorker(jobs, {
      FORMAT_POST: createFormatPostJobHandler({
        projects,
        formatting: { async formatPost() { return { ok: false, error: { code: "FORMAT_PLAN_OUTPUT_INVALID", message: "invalid", retryable: false } }; } },
        notifier
      })
    });

    await worker.processOne({ workerId: "worker-1" });

    expect((await jobs.findById(job.id))?.status).toBe("failed");
    expect((await projects.findById(project.id))?.state).toBe("draft_editing");
    expect((await projects.findById(project.id))?.posts[0]?.formattedText).toBeUndefined();
    expect(notifier.messages).toHaveLength(1);
    expect(notifier.messages[0]?.text).not.toContain("Canonical draft");
  });

  it("keeps the active Option 2 draft editable after a rejected decoration plan", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const notifier = new CapturingNotifier();
    const logger = new CapturingLogger();
    const project = await seedFormattingProject(projects);
    const job = await jobs.enqueue({ type: "FORMAT_POST", projectId: project.id, payload: { postIndex: 1, formattingOption: "option_2" } });
    const worker = new JobWorker(jobs, {
      FORMAT_POST: createFormatPostJobHandler({
        projects,
        formatting: { async formatPost() { return { ok: false, error: { code: "FORMAT_INSERTION_CONFLICT", message: "plan rejected", retryable: false } }; } },
        notifier,
        logger
      })
    });

    await worker.processOne({ workerId: "worker-1" });

    const restored = await projects.findById(project.id);
    expect((await jobs.findById(job.id))?.status).toBe("failed");
    expect(restored?.state).toBe("draft_editing");
    expect(restored?.posts[0]?.currentDraft).toBe("Canonical draft.");
    expect(restored?.posts[0]?.formattedText).toBeUndefined();
    expect(restored?.posts[0]?.formattingOption).toBeUndefined();
    expect(notifier.messages).toHaveLength(1);
    expect(notifier.messages[0]?.text).not.toContain("Canonical draft.");
    expect(logger.entries.find((entry) => entry.fields.event === "formatting_job_timing")?.fields).toMatchObject({ terminalCategory: "provider_or_plan_failure" });
  });

  it("does not let a timing logger failure prevent Option 2 recovery", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const notifier = new CapturingNotifier();
    const project = await seedFormattingProject(projects);
    const job = await jobs.enqueue({ type: "FORMAT_POST", projectId: project.id, payload: { postIndex: 1, formattingOption: "option_2" } });
    const logger = new TimingThrowingLogger();
    const worker = new JobWorker(jobs, {
      FORMAT_POST: createFormatPostJobHandler({
        projects,
        formatting: { async formatPost() { return { ok: false, error: { code: "FORMAT_INSERTION_CONFLICT", message: "plan rejected", retryable: false } }; } },
        notifier,
        logger
      })
    });

    await worker.processOne({ workerId: "worker-1" });

    expect((await jobs.findById(job.id))?.status).toBe("failed");
    expect((await projects.findById(project.id))?.state).toBe("draft_editing");
    expect(notifier.messages).toHaveLength(1);
  });

  it("turns an exhausted retryable timeout into one safe recovery", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const notifier = new CapturingNotifier();
    const project = await seedFormattingProject(projects);
    const job = await jobs.enqueue({ type: "FORMAT_POST", projectId: project.id, payload: { postIndex: 1, formattingOption: "option_1" }, maxAttempts: 1 });
    const worker = new JobWorker(jobs, {
      FORMAT_POST: createFormatPostJobHandler({
        projects,
        formatting: { async formatPost() { return { ok: false, error: { code: "FORMAT_PROVIDER_TIMEOUT", message: "timeout", retryable: true } }; } },
        notifier
      })
    });

    await worker.processOne({ workerId: "worker-1" });

    expect((await jobs.findById(job.id))?.status).toBe("failed");
    expect((await projects.findById(project.id))?.state).toBe("draft_editing");
    expect(notifier.messages).toHaveLength(1);
  });

  it("restores the draft after delivery failure and rejects a stale duplicate", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const project = await seedFormattingProject(projects);
    const first = await jobs.enqueue({ type: "FORMAT_POST", projectId: project.id, payload: { postIndex: 1, formattingOption: "option_1" } });
    const worker = new JobWorker(jobs, {
      FORMAT_POST: createFormatPostJobHandler({ projects, formatting: successAdapter(), notifier: new CapturingNotifier(new Error("delivery failed")) })
    });

    await worker.processOne({ workerId: "worker-1" });
    expect((await jobs.findById(first.id))?.result).toMatchObject({ notificationStatus: "failed" });
    const duplicate = await jobs.enqueue({ type: "FORMAT_POST", projectId: project.id, payload: { postIndex: 1, formattingOption: "option_1" } });
    await worker.processOne({ workerId: "worker-1" });

    expect((await jobs.findById(duplicate.id))?.errorCode).toBe("FORMAT_POST_STALE");
    expect((await projects.findById(project.id))?.state).toBe("draft_editing");
    expect((await projects.findById(project.id))?.posts[0]?.formattedText).toBeUndefined();
  });
});

async function seedFormattingProject(projects: InMemoryProjectRepository): Promise<Project> {
  const project: Project = {
    id: "project-1",
    telegramUserId: "100",
    chatId: "200",
    state: "formatting",
    isActive: true,
    posts: [{
      id: "post-1",
      index: 1,
      planSlice: { index: 1, topic: "topic", angle: "angle", includes: ["point"] },
      currentDraft: "Canonical draft."
    }],
    currentPostIndex: 1,
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };
  await projects.save(project);
  return project;
}

function successAdapter(): Pick<ModelAdapters, "formatPost"> {
  return {
    async formatPost() {
      return {
        ok: true,
        value: {
          decorationPlan: {
            option: "option_1",
            operations: [{ kind: "markdown_span", anchor: { text: "Canonical", occurrence: 0 }, style: "bold" }]
          }
        },
        meta: { provider: "openrouter", modelLabel: "owner-selected-format-model" }
      };
    }
  };
}

class CapturingLogger implements Logger {
  readonly entries: Array<{ level: string; fields: LogFields; message: string }> = [];
  info(fields: LogFields, message: string): void { this.entries.push({ level: "info", fields, message }); }
  warn(fields: LogFields, message: string): void { this.entries.push({ level: "warn", fields, message }); }
  error(fields: LogFields, message: string): void { this.entries.push({ level: "error", fields, message }); }
}

class TimingThrowingLogger extends CapturingLogger {
  override info(fields: LogFields, message: string): void {
    if (fields.event === "formatting_job_timing") throw new Error("timing sink unavailable");
    super.info(fields, message);
  }
}

class CapturingNotifier implements TelegramNotifier {
  readonly messages: Array<{ chatId: string; text: string; options?: TelegramSendMessageOptions }> = [];
  readonly cryptusMessages: Array<{ chatId: string; canonicalText: string }> = [];
  constructor(private readonly error?: Error) {}
  async sendMessage(chatId: string, text: string, options?: TelegramSendMessageOptions): Promise<void> {
    this.messages.push({ chatId, text, options });
    if (this.error) throw this.error;
  }
  async sendCryptusOption2(chatId: string, canonicalText: string, options?: TelegramEntitySendOptions): Promise<void> {
    this.cryptusMessages.push({ chatId, canonicalText });
    await this.sendMessage(chatId, canonicalText, options);
  }
}
