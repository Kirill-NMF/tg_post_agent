import { describe, expect, it } from "vitest";
import type { ModelAdapters } from "../src/domain/modelContracts.js";
import type { DraftText, PlanOption, Project } from "../src/domain/types.js";
import { InMemoryJobRepository } from "../src/repositories/inMemoryJobRepository.js";
import { InMemoryProjectRepository } from "../src/repositories/inMemoryProjectRepository.js";
import { createGenerateDraftJobHandler } from "../src/services/generateDraftJobHandler.js";
import { JobWorker } from "../src/services/jobWorker.js";
import type { LogFields, Logger } from "../src/observability/logger.js";
import type { TelegramNotifier, TelegramSendMessageOptions } from "../src/telegram/telegramNotifier.js";

describe("GENERATE_DRAFT job handler", () => {
  it("persists the draft, exposes formatting entry, and does not leak transcript", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const notifier = new CapturingNotifier();
    const project = await seedDraftProject(projects);
    project.sourceTelegramMessageId = "77";
    await projects.save(project);
    await jobs.enqueue({ type: "GENERATE_DRAFT", projectId: project.id, payload: {} });
    const worker = new JobWorker(jobs, {
      GENERATE_DRAFT: createGenerateDraftJobHandler({ projects, drafting: fakeDraftingAdapter({ fullText: "Generated draft text" }), notifier, formattingEnabled: true })
    });

    const processed = await worker.processOne({ workerId: "worker-1" });

    expect(processed).toMatchObject({ processed: true, status: "succeeded" });
    const updated = await projects.findById(project.id);
    expect(updated?.state).toBe("draft_editing");
    expect(updated?.posts[0]?.currentDraft).toBe("Generated draft text");
    expect(updated?.messages.at(-1)).toMatchObject({ kind: "draft", text: "Generated draft text" });
    expect(notifier.messages).toHaveLength(1);
    expect(notifier.messages[0]?.text).toBe("Generated draft text");
    expect(notifier.messages[0]?.text).not.toContain("REAL TRANSCRIPT");
    expect(notifier.messages[0]?.options?.reply_markup?.inline_keyboard.flat().map((button) => button.callback_data)).toEqual(["format:open", "draft:rerun:clean_up:1", "draft:rerun:make_post:1"]);
    expect(notifier.messages[0]?.options?.reply_parameters).toEqual({ message_id: 77 });
  });

  it("preserves saved draft and state when notification fails after persistence", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const notifier = new CapturingNotifier(new Error("telegram failed"));
    const project = await seedDraftProject(projects);
    const job = await jobs.enqueue({ type: "GENERATE_DRAFT", projectId: project.id, payload: {} });
    const worker = new JobWorker(jobs, {
      GENERATE_DRAFT: createGenerateDraftJobHandler({ projects, drafting: fakeDraftingAdapter({ fullText: "Generated draft text" }), notifier })
    });

    await worker.processOne({ workerId: "worker-1" });

    const updated = await projects.findById(project.id);
    const storedJob = await jobs.findById(job.id);
    expect(updated?.state).toBe("draft_editing");
    expect(updated?.posts[0]?.currentDraft).toBe("Generated draft text");
    expect(storedJob?.status).toBe("succeeded");
    expect(storedJob?.result?.notificationStatus).toBe("failed");
  });

  it("recovers a permanent generation failure with a safe retry message", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const notifier = new CapturingNotifier();
    const project = await seedDraftProject(projects);
    const job = await jobs.enqueue({ type: "GENERATE_DRAFT", projectId: project.id, payload: {}, maxAttempts: 1 });
    const worker = new JobWorker(jobs, {
      GENERATE_DRAFT: createGenerateDraftJobHandler({ projects, drafting: failingDraftingAdapter(), notifier })
    });

    await worker.processOne({ workerId: "worker-1" });

    expect(await projects.findById(project.id)).toMatchObject({ state: "rewrite_mode" });
    expect(await jobs.findById(job.id)).toMatchObject({ status: "failed", errorCode: "DRAFT_FAILURE_CONTRACT" });
    expect(notifier.messages[0]?.text).toContain("План и выбранный режим сохранены");
    expect(notifier.messages[0]?.options?.reply_markup?.inline_keyboard.flat().map((button) => button.callback_data)).toEqual(["rewrite:make_post"]);
    expect(notifier.messages[0]?.text).not.toContain("REAL TRANSCRIPT");
  });

  it("turns an exhausted retryable provider failure into one safe recovery", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const notifier = new CapturingNotifier();
    const project = await seedDraftProject(projects);
    const job = await jobs.enqueue({ type: "GENERATE_DRAFT", projectId: project.id, payload: {}, maxAttempts: 1 });
    const worker = new JobWorker(jobs, {
      GENERATE_DRAFT: createGenerateDraftJobHandler({ projects, drafting: retryableFailingDraftingAdapter(), notifier })
    });

    await worker.processOne({ workerId: "worker-1" });

    expect(await jobs.findById(job.id)).toMatchObject({ status: "failed", errorCode: "DRAFT_FAILURE_TIMEOUT" });
    expect(await projects.findById(project.id)).toMatchObject({ state: "rewrite_mode" });
    expect(notifier.messages).toHaveLength(1);
    expect(notifier.messages[0]?.text).not.toContain("REAL TRANSCRIPT");
  });

  it("recovers the project when the adapter throws unexpectedly", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const notifier = new CapturingNotifier();
    const project = await seedDraftProject(projects);
    const job = await jobs.enqueue({ type: "GENERATE_DRAFT", projectId: project.id, payload: {} });
    const worker = new JobWorker(jobs, {
      GENERATE_DRAFT: createGenerateDraftJobHandler({ projects, drafting: { async generateDraft() { throw new Error("timeout"); } }, notifier })
    });

    await worker.processOne({ workerId: "worker-1" });

    expect(await jobs.findById(job.id)).toMatchObject({ status: "failed", errorCode: "DRAFT_FAILURE_PROVIDER" });
    expect(await projects.findById(project.id)).toMatchObject({ state: "rewrite_mode" });
    expect(notifier.messages).toHaveLength(1);
  });

  it.each([
    ["provider", "DRAFT_PROVIDER_RATE_LIMITED", "DRAFT_FAILURE_PROVIDER"],
    ["timeout", "DRAFT_PROVIDER_TIMEOUT", "DRAFT_FAILURE_TIMEOUT"],
    ["contract", "GEMINI_DRAFT_OUTPUT_INVALID", "DRAFT_FAILURE_CONTRACT"],
    ["validation", "GEMINI_DRAFT_OUTPUT_LANGUAGE_INVALID", "DRAFT_FAILURE_VALIDATION"],
    ["internal", "DRAFT_UNKNOWN_FAILURE", "DRAFT_FAILURE_INTERNAL"]
  ])("persists and emits the normalized %s terminal category", async (_family, sourceCode, expectedCode) => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const logger = new CapturingLogger();
    const project = await seedDraftProject(projects);
    const job = await jobs.enqueue({ type: "GENERATE_DRAFT", projectId: project.id, payload: {}, maxAttempts: 1 });
    const worker = new JobWorker(jobs, {
      GENERATE_DRAFT: createGenerateDraftJobHandler({ projects, drafting: fixedFailureAdapter(sourceCode), logger })
    }, logger);

    await worker.processOne({ workerId: "worker-1" });

    expect(await jobs.findById(job.id)).toMatchObject({ status: "failed", errorCode: expectedCode });
    expect(logger.entries).toContainEqual({
      level: "warn",
      fields: { event: "draft_generation_terminal_failure", jobId: job.id, projectId: project.id, failureCategory: expectedCode },
      message: "draft generation reached terminal failure"
    });
  });

  it("does not emit a terminal failure category on successful generation", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const logger = new CapturingLogger();
    const project = await seedDraftProject(projects);
    await jobs.enqueue({ type: "GENERATE_DRAFT", projectId: project.id, payload: {} });
    const worker = new JobWorker(jobs, {
      GENERATE_DRAFT: createGenerateDraftJobHandler({ projects, drafting: fakeDraftingAdapter({ fullText: "Generated draft text" }), logger })
    }, logger);

    await worker.processOne({ workerId: "worker-1" });

    expect(logger.entries.some((entry) => entry.fields.event === "draft_generation_terminal_failure")).toBe(false);
  });

  it("fails safely for inactive projects or missing prerequisites without writing a draft", async () => {
    const missingProjects = new InMemoryProjectRepository();
    const missingJobs = new InMemoryJobRepository();
    const missingProject = await seedDraftProject(missingProjects, { transcript: undefined });
    const missingJob = await missingJobs.enqueue({ type: "GENERATE_DRAFT", projectId: missingProject.id, payload: {} });
    const missingWorker = new JobWorker(missingJobs, {
      GENERATE_DRAFT: createGenerateDraftJobHandler({ projects: missingProjects, drafting: fakeDraftingAdapter({ fullText: "Generated draft text" }) })
    });

    await missingWorker.processOne({ workerId: "worker-1" });
    expect((await missingJobs.findById(missingJob.id))?.errorCode).toBe("DRAFT_TRANSCRIPT_MISSING");
    expect((await missingProjects.findById(missingProject.id))?.posts[0]?.currentDraft).toBeUndefined();

    const inactiveProjects = new InMemoryProjectRepository();
    const inactiveJobs = new InMemoryJobRepository();
    const inactiveProject = await seedDraftProject(inactiveProjects, { isActive: false });
    const inactiveJob = await inactiveJobs.enqueue({ type: "GENERATE_DRAFT", projectId: inactiveProject.id, payload: {} });
    const inactiveWorker = new JobWorker(inactiveJobs, {
      GENERATE_DRAFT: createGenerateDraftJobHandler({ projects: inactiveProjects, drafting: fakeDraftingAdapter({ fullText: "Generated draft text" }) })
    });

    await inactiveWorker.processOne({ workerId: "worker-1" });
    expect((await inactiveJobs.findById(inactiveJob.id))?.errorCode).toBe("PROJECT_NOT_ACTIVE");
    expect((await inactiveProjects.findById(inactiveProject.id))?.posts[0]?.currentDraft).toBeUndefined();
  });
});

async function seedDraftProject(projects: InMemoryProjectRepository, overrides: Partial<Project> = {}) {
  const selectedPlan = planOption();
  const project: Project = {
    id: "project-1",
    telegramUserId: "100",
    chatId: "200",
    state: "draft_generating",
    isActive: true,
    transcript: "REAL TRANSCRIPT",
    selectedPlan,
    rewriteMode: "make_post",
    posts: [{ id: "post-1", index: 1, planSlice: selectedPlan.posts[0] }],
    currentPostIndex: 1,
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
  await projects.save(project);
  return project;
}

function fakeDraftingAdapter(draft: DraftText): Pick<ModelAdapters, "generateDraft"> {
  return {
    async generateDraft() {
      return { ok: true, value: { draft }, meta: { provider: "gemini", modelLabel: "gemini-2.5-pro" } };
    }
  };
}

function failingDraftingAdapter(): Pick<ModelAdapters, "generateDraft"> {
  return {
    async generateDraft() {
      return {
        ok: false,
        error: { code: "GEMINI_DRAFT_OUTPUT_INVALID", message: "Provider request failed: HTTP_400.", retryable: false }
      };
    }
  };
}

function retryableFailingDraftingAdapter(): Pick<ModelAdapters, "generateDraft"> {
  return {
    async generateDraft() {
      return { ok: false, error: { code: "DRAFT_PROVIDER_TIMEOUT", message: "Timed out.", retryable: true } };
    }
  };
}

function fixedFailureAdapter(code: string): Pick<ModelAdapters, "generateDraft"> {
  return {
    async generateDraft() {
      return { ok: false, error: { code, message: "safe test failure", retryable: false } };
    }
  };
}

function planOption(): PlanOption {
  return {
    optionId: "one_post",
    postCount: 1,
    title: "Plan",
    angle: "Angle",
    summary: "Summary",
    posts: [{ index: 1, topic: "Topic", angle: "Angle", includes: ["Point"] }]
  };
}

class CapturingNotifier implements TelegramNotifier {
  readonly messages: Array<{ chatId: string; text: string; options?: TelegramSendMessageOptions }> = [];

  constructor(private readonly error?: Error) {}

  async sendMessage(chatId: string, text: string, options?: TelegramSendMessageOptions): Promise<void> {
    this.messages.push({ chatId, text, options });
    if (this.error) throw this.error;
  }
}

class CapturingLogger implements Logger {
  readonly entries: Array<{ level: "info" | "warn" | "error"; fields: LogFields; message: string }> = [];

  info(fields: LogFields, message: string): void { this.entries.push({ level: "info", fields, message }); }
  warn(fields: LogFields, message: string): void { this.entries.push({ level: "warn", fields, message }); }
  error(fields: LogFields, message: string): void { this.entries.push({ level: "error", fields, message }); }
}
