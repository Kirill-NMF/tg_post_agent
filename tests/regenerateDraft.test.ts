import { describe, expect, it } from "vitest";
import type { ModelAdapters } from "../src/domain/modelContracts.js";
import type { PlanOption, Project } from "../src/domain/types.js";
import { InMemoryJobRepository } from "../src/repositories/inMemoryJobRepository.js";
import { InMemoryProjectRepository } from "../src/repositories/inMemoryProjectRepository.js";
import { createGenerateDraftJobHandler } from "../src/services/generateDraftJobHandler.js";
import { JobWorker } from "../src/services/jobWorker.js";
import { ProjectService } from "../src/services/projectService.js";
import { draftActionButtons } from "../src/services/draftPresentation.js";

describe("draft regeneration", () => {
  it("renders a versioned callback beside formatting", () => {
    expect(draftActionButtons(true, 4)).toEqual([
      { label: "Оформить", action: "format:open" },
      { label: "Сгенерировать заново", action: "draft:regenerate:4" }
    ]);
  });

  it("queues one regeneration without replacing the active draft or accepting a double click", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const service = new ProjectService(projects, {} as ModelAdapters, jobs, undefined, true);
    const project = await seed(projects);
    expect(await service.regenerateDraft("100", 1)).toMatchObject([{ kind: "message", text: expect.stringContaining("Генерирую новый") }]);
    expect((await projects.findById(project.id))?.posts[0]?.currentDraft).toBe("Previous generated draft");
    expect((await projects.findById(project.id))?.state).toBe("draft_generating");
    expect(await service.regenerateDraft("100", 1)).toMatchObject([{ kind: "message", text: expect.stringContaining("уже") }]);
    expect(await jobs.claimNextDue({ workerId: "worker" })).toMatchObject({
      type: "GENERATE_DRAFT",
      dedupeKey: "project:project-1:post:1:regenerate:1",
      payload: { postIndex: 1, rewriteMode: "make_post", generationMode: "regenerate", sourceDraftVersion: 1 }
    });
  });

  it("uses only confirmed plan and transcript, preserves history, then swaps the active draft", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const project = await seed(projects);
    const service = new ProjectService(projects, {} as ModelAdapters, jobs, undefined, true);
    await service.regenerateDraft("100", 1);
    const calls: Array<Parameters<ModelAdapters["generateDraft"]>[0]> = [];
    const worker = new JobWorker(jobs, { GENERATE_DRAFT: createGenerateDraftJobHandler({
      projects,
      drafting: { async generateDraft(input) {
        calls.push(input);
        return { ok: true, value: { draft: { fullText: "Fresh initial draft" } }, meta: { provider: "mock" } };
      } }
    }) });

    await worker.processOne({ workerId: "worker" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ selectedPlan: project.selectedPlan, transcript: "Stored source transcript", rewriteMode: "make_post", postIndex: 1, compactContext: [] });
    const saved = await projects.findById(project.id);
    expect(saved?.state).toBe("draft_editing");
    expect(saved?.posts[0]).toMatchObject({ currentDraft: "Fresh initial draft", draftVersion: 2 });
    expect(saved?.messages.filter((item) => item.kind === "draft").map((item) => item.text)).toEqual(["Previous generated draft", "Fresh initial draft"]);
    expect(saved?.messages.find((item) => item.kind === "draft_edit")?.text).toBe("Prior correction must stay audit-only");
  });

  it("retains the previous active draft and sends one recovery after terminal failure", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const notifications: string[] = [];
    const project = await seed(projects);
    const service = new ProjectService(projects, {} as ModelAdapters, jobs, undefined, true);
    await service.regenerateDraft("100", 1);
    const worker = new JobWorker(jobs, { GENERATE_DRAFT: createGenerateDraftJobHandler({
      projects,
      drafting: { async generateDraft() { return { ok: false, error: { code: "DRAFT_REJECTED", message: "rejected", retryable: false } }; } },
      notifier: { async sendMessage(_chatId, text) { notifications.push(text); } }
    }) });

    const result = await worker.processOne({ workerId: "worker" });
    expect(result).toMatchObject({ processed: true, status: "failed" });
    const saved = await projects.findById(project.id);
    expect(saved?.state).toBe("draft_editing");
    expect(saved?.posts[0]).toMatchObject({ currentDraft: "Previous generated draft", draftVersion: 1 });
    expect(saved?.messages.filter((item) => item.kind === "draft").map((item) => item.text)).toEqual(["Previous generated draft"]);
    expect(notifications).toEqual([expect.stringContaining("Текущий черновик сохранён")]);
  });

  it("rejects a stale callback after the draft version changes", async () => {
    const projects = new InMemoryProjectRepository();
    const service = new ProjectService(projects, {} as ModelAdapters);
    await seed(projects, 2);
    expect(await service.regenerateDraft("100", 1)).toMatchObject([{ kind: "message", text: expect.stringContaining("устарела") }]);
  });
});

async function seed(repository: InMemoryProjectRepository, draftVersion = 1): Promise<Project> {
  const selectedPlan: PlanOption = { optionId: "one_post", postCount: 1, title: "Confirmed plan", angle: "Angle", summary: "Summary", posts: [{ index: 1, topic: "Topic", angle: "Angle", includes: ["Point"] }] };
  const project: Project = {
    id: "project-1", telegramUserId: "100", chatId: "200", state: "draft_editing", isActive: true,
    transcript: "Stored source transcript", selectedPlan, rewriteMode: "make_post", currentPostIndex: 1,
    posts: [{ id: "post-1", index: 1, planSlice: selectedPlan.posts[0], currentDraft: "Previous generated draft", draftVersion }],
    messages: [
      { kind: "draft", text: "Previous generated draft", createdAt: new Date() },
      { kind: "draft_edit", text: "Prior correction must stay audit-only", createdAt: new Date() }
    ],
    createdAt: new Date(), updatedAt: new Date()
  };
  await repository.save(project);
  return project;
}
