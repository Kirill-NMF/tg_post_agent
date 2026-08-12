import { describe, expect, it } from "vitest";
import type { ModelAdapters } from "../src/domain/modelContracts.js";
import type { DraftText, PlanOption, Project } from "../src/domain/types.js";
import { InMemoryJobRepository } from "../src/repositories/inMemoryJobRepository.js";
import { InMemoryProjectRepository } from "../src/repositories/inMemoryProjectRepository.js";
import { JobWorker } from "../src/services/jobWorker.js";
import { createReviseDraftJobHandler } from "../src/services/reviseDraftJobHandler.js";
import type { TelegramNotifier, TelegramSendMessageOptions } from "../src/telegram/telegramNotifier.js";

describe("REVISE_DRAFT job handler", () => {
  it("persists the updated draft and sends the format button", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const notifier = new CapturingNotifier();
    const project = await seedDraftEditingProject(projects);
    await jobs.enqueue({ type: "REVISE_DRAFT", projectId: project.id, payload: { latestUserEdit: "Make intro sharper" } });
    const worker = new JobWorker(jobs, {
      REVISE_DRAFT: createReviseDraftJobHandler({ projects, drafting: fakeRevisionAdapter({ fullText: "Updated draft text" }), notifier })
    });

    const processed = await worker.processOne({ workerId: "worker-1" });

    expect(processed).toMatchObject({ processed: true, status: "succeeded" });
    const updated = await projects.findById(project.id);
    expect(updated?.state).toBe("draft_editing");
    expect(updated?.posts[0]?.currentDraft).toBe("Updated draft text");
    expect(updated?.messages.at(-1)).toMatchObject({ kind: "draft", text: "Updated draft text" });
    expect(notifier.messages).toHaveLength(1);
    expect(notifier.messages[0]?.text).toBe("Updated draft text");
    expect(notifier.messages[0]?.options?.reply_markup?.inline_keyboard.flat().map((button) => button.callback_data)).toEqual(["format:open"]);
  });

  it("preserves saved revision and state when notification fails", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const notifier = new CapturingNotifier(new Error("telegram failed"));
    const project = await seedDraftEditingProject(projects);
    const job = await jobs.enqueue({ type: "REVISE_DRAFT", projectId: project.id, payload: { latestUserEdit: "Make intro sharper" } });
    const worker = new JobWorker(jobs, {
      REVISE_DRAFT: createReviseDraftJobHandler({ projects, drafting: fakeRevisionAdapter({ fullText: "Updated draft text" }), notifier })
    });

    await worker.processOne({ workerId: "worker-1" });

    const updated = await projects.findById(project.id);
    const storedJob = await jobs.findById(job.id);
    expect(updated?.state).toBe("draft_editing");
    expect(updated?.posts[0]?.currentDraft).toBe("Updated draft text");
    expect(storedJob?.status).toBe("succeeded");
    expect(storedJob?.result?.notificationStatus).toBe("failed");
  });

  it("recovers a permanent revision failure and preserves the current draft", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const notifier = new CapturingNotifier();
    const project = await seedDraftEditingProject(projects);
    const job = await jobs.enqueue({ type: "REVISE_DRAFT", projectId: project.id, payload: { latestUserEdit: "Edit" } });
    const worker = new JobWorker(jobs, {
      REVISE_DRAFT: createReviseDraftJobHandler({ projects, drafting: failingRevisionAdapter(), notifier })
    });

    await worker.processOne({ workerId: "worker-1" });

    const updated = await projects.findById(project.id);
    expect(updated?.state).toBe("draft_editing");
    expect(updated?.posts[0]?.currentDraft).toBe("Current draft");
    expect(await jobs.findById(job.id)).toMatchObject({ status: "failed", errorCode: "GEMINI_DRAFT_OUTPUT_INVALID" });
    expect(notifier.messages[0]?.text).toContain("Не удалось обновить черновик");
    expect(notifier.messages[0]?.text).not.toContain("Current draft");
  });

  it("fails safely for inactive, missing prerequisites, or invalid edit without overwriting current draft", async () => {
    const inactive = await runFailure({ isActive: false }, { latestUserEdit: "Edit" });
    expect(inactive.job?.errorCode).toBe("PROJECT_NOT_ACTIVE");
    expect(inactive.project?.posts[0]?.currentDraft).toBe("Current draft");

    const missingDraft = await runFailure({ posts: [{ id: "post-1", index: 1, planSlice: planOption().posts[0] }] }, { latestUserEdit: "Edit" });
    expect(missingDraft.job?.errorCode).toBe("DRAFT_CURRENT_DRAFT_MISSING");
    expect(missingDraft.project?.posts[0]?.currentDraft).toBeUndefined();

    const invalidEdit = await runFailure({}, { latestUserEdit: "   " });
    expect(invalidEdit.job?.errorCode).toBe("DRAFT_EDIT_MISSING");
    expect(invalidEdit.project?.posts[0]?.currentDraft).toBe("Current draft");
  });
});

async function runFailure(projectOverrides: Partial<Project>, payload: Record<string, unknown>) {
  const projects = new InMemoryProjectRepository();
  const jobs = new InMemoryJobRepository();
  const project = await seedDraftEditingProject(projects, projectOverrides);
  const job = await jobs.enqueue({ type: "REVISE_DRAFT", projectId: project.id, payload });
  const worker = new JobWorker(jobs, {
    REVISE_DRAFT: createReviseDraftJobHandler({ projects, drafting: fakeRevisionAdapter({ fullText: "Should not be written" }) })
  });

  await worker.processOne({ workerId: "worker-1" });
  return { project: await projects.findById(project.id), job: await jobs.findById(job.id) };
}

async function seedDraftEditingProject(projects: InMemoryProjectRepository, overrides: Partial<Project> = {}) {
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
    posts: [{ id: "post-1", index: 1, planSlice: selectedPlan.posts[0], currentDraft: "Current draft" }],
    currentPostIndex: 1,
    messages: [{ kind: "draft_edit", text: "Previous edit", createdAt: new Date() }],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
  await projects.save(project);
  return project;
}

function fakeRevisionAdapter(updatedDraft: DraftText): Pick<ModelAdapters, "reviseDraft"> {
  return {
    async reviseDraft() {
      return { ok: true, value: { updatedDraft }, meta: { provider: "gemini", modelLabel: "gemini-2.5-pro" } };
    }
  };
}

function failingRevisionAdapter(): Pick<ModelAdapters, "reviseDraft"> {
  return {
    async reviseDraft() {
      return {
        ok: false,
        error: { code: "GEMINI_DRAFT_OUTPUT_INVALID", message: "Provider request failed: HTTP_400.", retryable: false }
      };
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
