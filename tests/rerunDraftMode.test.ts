import { describe, expect, it } from "vitest";
import type { ModelAdapters } from "../src/domain/modelContracts.js";
import type { PlanOption, Project, RewriteMode } from "../src/domain/types.js";
import { InMemoryJobRepository } from "../src/repositories/inMemoryJobRepository.js";
import { InMemoryProjectRepository } from "../src/repositories/inMemoryProjectRepository.js";
import { createGenerateDraftJobHandler } from "../src/services/generateDraftJobHandler.js";
import { JobWorker } from "../src/services/jobWorker.js";
import { ProjectService } from "../src/services/projectService.js";
import { draftActionButtons } from "../src/services/draftPresentation.js";

describe("mode-specific draft rerun", () => {
  it("renders formatting and both versioned rerun controls without the generic action", () => {
    expect(draftActionButtons(true, 4)).toEqual([
      { label: "Оформить", action: "format:open" },
      { label: "Почистить заново", action: "draft:rerun:clean_up:4" },
      { label: "Сделать пост заново", action: "draft:rerun:make_post:4" }
    ]);
  });

  it.each<RewriteMode>(["clean_up", "make_post"])("queues %s from the confirmed source and blocks a second tap", async (rewriteMode) => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const service = new ProjectService(projects, {} as ModelAdapters, jobs, undefined, true);
    const project = await seed(projects);
    await service.rerunDraft("100", rewriteMode, 1);
    expect((await projects.findById(project.id))?.posts[0]?.currentDraft).toBe("Previous draft");
    expect((await projects.findById(project.id))?.rewriteMode).toBe("make_post");
    expect((await projects.findById(project.id))?.state).toBe("draft_generating");
    expect(await service.rerunDraft("100", rewriteMode, 1)).toMatchObject([{ kind: "message", text: expect.stringContaining("уже") }]);
    expect(await jobs.claimNextDue({ workerId: "worker" })).toMatchObject({
      type: "GENERATE_DRAFT",
      dedupeKey: "project:project-1:post:1:rerun:" + rewriteMode + ":1",
      payload: { postIndex: 1, rewriteMode, generationMode: "rerun", sourceDraftVersion: 1 }
    });
  });

  it("isolates source inputs and atomically swaps draft and rewrite mode only after success", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const project = await seed(projects);
    const service = new ProjectService(projects, {} as ModelAdapters, jobs, undefined, true);
    await service.rerunDraft("100", "clean_up", 1);
    const calls: Array<Parameters<ModelAdapters["generateDraft"]>[0]> = [];
    const worker = new JobWorker(jobs, { GENERATE_DRAFT: createGenerateDraftJobHandler({
      projects,
      drafting: { async generateDraft(input) {
        calls.push(input);
        return { ok: true, value: { draft: { fullText: "Clean replacement" } }, meta: { provider: "mock" } };
      } }
    }) });

    await worker.processOne({ workerId: "worker" });
    expect(calls[0]).toMatchObject({ selectedPlan: project.selectedPlan, transcript: "Stored transcript", rewriteMode: "clean_up", compactContext: [] });
    const saved = await projects.findById(project.id);
    expect(saved?.posts[0]).toMatchObject({ currentDraft: "Clean replacement", draftVersion: 2 });
    expect(saved?.rewriteMode).toBe("clean_up");
    expect(saved?.messages.filter((item) => item.kind === "draft").map((item) => item.text)).toEqual(["Previous draft", "Clean replacement"]);
    expect(saved?.messages.find((item) => item.kind === "draft_edit")?.text).toBe("Prior correction");
  });

  it("retains draft and existing rewrite mode after terminal rerun failure", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const project = await seed(projects);
    const service = new ProjectService(projects, {} as ModelAdapters, jobs, undefined, true);
    await service.rerunDraft("100", "clean_up", 1);
    const worker = new JobWorker(jobs, { GENERATE_DRAFT: createGenerateDraftJobHandler({
      projects,
      drafting: { async generateDraft() { return { ok: false, error: { code: "DRAFT_REJECTED", message: "failed", retryable: false } }; } }
    }) });

    expect(await worker.processOne({ workerId: "worker" })).toMatchObject({ processed: true, status: "failed" });
    expect(await projects.findById(project.id)).toMatchObject({ state: "draft_editing", rewriteMode: "make_post", posts: [{ currentDraft: "Previous draft", draftVersion: 1 }] });
  });

  it("rejects a stale rerun button after a revision version is active", async () => {
    const projects = new InMemoryProjectRepository();
    const service = new ProjectService(projects, {} as ModelAdapters);
    await seed(projects, 2);
    expect(await service.rerunDraft("100", "clean_up", 1)).toMatchObject([{ kind: "message", text: expect.stringContaining("устарела") }]);
  });
});

async function seed(repository: InMemoryProjectRepository, draftVersion = 1): Promise<Project> {
  const selectedPlan: PlanOption = { optionId: "one_post", postCount: 1, title: "Confirmed", angle: "Angle", summary: "Summary", posts: [{ index: 1, topic: "Topic", angle: "Angle", includes: ["Point"] }] };
  const project: Project = {
    id: "project-1", telegramUserId: "100", chatId: "200", state: "draft_editing", isActive: true,
    transcript: "Stored transcript", selectedPlan, rewriteMode: "make_post", currentPostIndex: 1,
    posts: [{ id: "post-1", index: 1, planSlice: selectedPlan.posts[0], currentDraft: "Previous draft", draftVersion }],
    messages: [{ kind: "draft", text: "Previous draft", createdAt: new Date() }, { kind: "draft_edit", text: "Prior correction", createdAt: new Date() }],
    createdAt: new Date(), updatedAt: new Date()
  };
  await repository.save(project);
  return project;
}
