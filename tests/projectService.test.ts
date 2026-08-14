import { describe, expect, it } from "vitest";
import { MockModelAdapters } from "../src/adapters/mockModelAdapters.js";
import type { PlanOption, Project } from "../src/domain/types.js";
import { InMemoryJobRepository } from "../src/repositories/inMemoryJobRepository.js";
import { InMemoryProjectRepository } from "../src/repositories/inMemoryProjectRepository.js";
import { ProjectService } from "../src/services/projectService.js";
import type { BotResponse } from "../src/domain/types.js";

function service() {
  const repository = new InMemoryProjectRepository();
  return {
    repository,
    projects: new ProjectService(repository, new MockModelAdapters())
  };
}

describe("ProjectService mock state machine", () => {
  it("runs the main audio-to-draft path without exposing incomplete Stage 3 UI", async () => {
    const { projects } = service();

    expect(message((await projects.start("100", "200"))[0]).text).toContain("\u041f\u0440\u0438\u0448\u043b\u0438\u0442\u0435");
    const planning = await projects.submitSourceAudio("100", { kind: "voice", telegramFileId: "voice-file-id" });
    expect(message(planning[0]).text).toContain("\u0420\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0443\u044e: 1 \u043f\u043e\u0441\u0442");
    expect((await projects.getActiveProject("100"))?.state).toBe("planning");

    const rewrite = await projects.choosePlan("100", "recommended");
    expect(message(rewrite[0]).buttons?.map((button) => button.action)).toEqual(["rewrite:clean_up", "rewrite:make_post"]);
    expect(message(rewrite[0]).buttons?.map((button) => button.label)).toEqual(["\u041f\u043e\u0447\u0438\u0441\u0442\u0438\u0442\u044c", "\u0421\u0434\u0435\u043b\u0430\u0442\u044c \u043f\u043e\u0441\u0442"]);

    const draft = await projects.chooseRewriteMode("100", "make_post");
    expect(message(draft[0]).text).toContain("Mock draft 1");
    expect(message(draft[0]).buttons).toEqual([]);
    expect((await projects.getActiveProject("100"))?.state).toBe("draft_editing");

    const revised = await projects.reviseDraft("100", "shorten intro");
    expect(message(revised[0]).text).toContain("Applied edit: shorten intro");
    expect(message(revised[0]).buttons).toEqual([]);
  });

  it("does not offer a Stage 3 action for a coherent single-plan draft", async () => {
    const { projects } = service();
    await projects.start("100", "200");
    await projects.submitSourceAudio("100", { kind: "voice", telegramFileId: "voice-file-id" });
    await projects.choosePlan("100", "recommended");
    const draft = await projects.chooseRewriteMode("100", "make_post");

    expect(message(draft[0]).buttons).toEqual([]);
    expect((await projects.getActiveProject("100"))?.state).toBe("draft_editing");
  });

  it("enqueues draft generation instead of running mock draft synchronously when jobs are configured", async () => {
    const repository = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const projects = new ProjectService(repository, new MockModelAdapters(), jobs);
    const project = await seedRewriteProject(repository);

    const response = await projects.chooseRewriteMode("100", "make_post");

    expect(message(response[0]).text).not.toContain("Mock draft");
    const updated = await repository.findById(project.id);
    expect(updated?.state).toBe("draft_generating");
    expect(updated?.rewriteMode).toBe("make_post");
    expect(updated?.posts[0]?.currentDraft).toBeUndefined();
    const job = await jobs.claimNextDue({ workerId: "worker-1" });
    expect(job).toMatchObject({
      type: "GENERATE_DRAFT",
      projectId: project.id,
      postId: "post-1",
      dedupeKey: `project:${project.id}:post:1:draft:make_post`,
      payload: { postIndex: 1, rewriteMode: "make_post" }
    });
  });

  it("enqueues draft revision instead of mutating the draft synchronously when jobs are configured", async () => {
    const repository = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const projects = new ProjectService(repository, new MockModelAdapters(), jobs);
    const project = await seedDraftEditingProject(repository);

    const response = await projects.reviseDraft("100", "shorten intro");

    expect(message(response[0]).text).toContain("обновляю черновик");
    const updated = await repository.findById(project.id);
    expect(updated?.state).toBe("draft_generating");
    expect(updated?.posts[0]?.currentDraft).toBe("Current draft");
    expect(updated?.messages.at(-1)).toMatchObject({ kind: "draft_edit", text: "shorten intro" });

    const staleFormat = await projects.openFormatChoice("100");
    expect(message(staleFormat[0]).buttons).toBeUndefined();
    expect((await repository.findById(project.id))?.state).toBe("draft_generating");

    const job = await jobs.claimNextDue({ workerId: "worker-1" });
    expect(job).toMatchObject({
      type: "REVISE_DRAFT",
      projectId: project.id,
      postId: "post-1",
      dedupeKey: `project:${project.id}:post:1:revise-draft:latest`,
      payload: { postIndex: 1, latestUserEdit: "shorten intro" }
    });
  });

  it("enqueues internal formatting durably without exposing it in draft buttons", async () => {
    const repository = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const projects = new ProjectService(repository, new MockModelAdapters(), jobs);
    const project = await seedDraftEditingProject(repository);
    project.state = "format_choice";
    await repository.save(project);

    const response = await projects.formatCurrentPost("100", "option_1");

    expect(message(response[0]).text).toContain("\u041e\u0444\u043e\u0440\u043c\u043b\u044f\u044e");
    expect((await repository.findById(project.id))?.state).toBe("formatting");
    expect(await jobs.claimNextDue({ workerId: "worker-1" })).toMatchObject({
      type: "FORMAT_POST",
      projectId: project.id,
      postId: "post-1",
      payload: { postIndex: 1, formattingOption: "option_1" }
    });
  });

  it("keeps the no-job mock path revising drafts synchronously", async () => {
    const repository = new InMemoryProjectRepository();
    const projects = new ProjectService(repository, new MockModelAdapters());
    await seedDraftEditingProject(repository);

    const revised = await projects.reviseDraft("100", "shorten intro");

    expect(message(revised[0]).text).toContain("Applied edit: shorten intro");
    expect((await projects.getActiveProject("100"))?.posts[0]?.currentDraft).toContain("Applied edit: shorten intro");
  });

  it("enqueues real edit-audio transcription instead of using mocks in production job mode", async () => {
    const repository = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const projects = new ProjectService(repository, new MockModelAdapters(), jobs);
    const project = await seedDraftEditingProject(repository);

    const response = await projects.handleEditAudio("100", { kind: "voice", telegramFileId: "edit-file-id" });

    expect(message(response[0]).text).toContain("Расшифровываю");
    expect((await repository.findById(project.id))?.posts[0]?.currentDraft).toBe("Current draft");
    expect(await jobs.claimNextDue({ workerId: "worker-1" })).toMatchObject({ type: "TRANSCRIBE_EDIT_AUDIO", projectId: project.id });
  });

  it("applies a bounded source-audio attempt override only when configured", async () => {
    const repository = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const projects = new ProjectService(repository, new MockModelAdapters(), jobs, { sourceAudio: 1 });

    await projects.start("100", "200");
    await projects.submitSourceAudio("100", { kind: "voice", telegramFileId: "voice-file-id" });

    expect(await jobs.claimNextDue({ workerId: "worker-1" })).toMatchObject({ type: "TRANSCRIBE_AUDIO", maxAttempts: 1 });
  });

  it("routes voice edits through the current state stub transcription", async () => {
    const { projects } = service();

    await projects.start("100", "200");
    await projects.submitSourceAudio("100", { kind: "voice", telegramFileId: "voice-file-id" });
    await projects.choosePlan("100", "recommended");
    await projects.chooseRewriteMode("100", "make_post");

    const edited = await projects.handleEditAudio("100", { kind: "voice", telegramFileId: "edit-file-id" });
    expect(message(edited[0]).text).toContain("Mock voice edit");
  });
});

function message(response: BotResponse | undefined) {
  if (!response || response.kind !== "message") throw new Error("Expected message response.");
  return response;
}

async function seedRewriteProject(repository: InMemoryProjectRepository): Promise<Project> {
  const selectedPlan = planOption();
  const project: Project = {
    id: "project-1",
    telegramUserId: "100",
    chatId: "200",
    state: "rewrite_mode",
    isActive: true,
    transcript: "REAL TRANSCRIPT",
    planOptions: [selectedPlan],
    selectedPlan,
    posts: [{ id: "post-1", index: 1, planSlice: selectedPlan.posts[0] }],
    currentPostIndex: 1,
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };
  await repository.save(project);
  return project;
}

async function seedDraftEditingProject(repository: InMemoryProjectRepository): Promise<Project> {
  const selectedPlan = planOption();
  const project: Project = {
    id: "project-1",
    telegramUserId: "100",
    chatId: "200",
    state: "draft_editing",
    isActive: true,
    transcript: "REAL TRANSCRIPT",
    selectedPlan,
    rewriteMode: "make_post",
    posts: [{ id: "post-1", index: 1, planSlice: selectedPlan.posts[0], currentDraft: "Current draft" }],
    currentPostIndex: 1,
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };
  await repository.save(project);
  return project;
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
