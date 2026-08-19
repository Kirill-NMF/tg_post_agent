import { describe, expect, it } from "vitest";
import type { ModelAdapters } from "../src/domain/modelContracts.js";
import type { PlanOption, PlanningResult, Project } from "../src/domain/types.js";
import { InMemoryJobRepository } from "../src/repositories/inMemoryJobRepository.js";
import { InMemoryProjectRepository } from "../src/repositories/inMemoryProjectRepository.js";
import { renderPlanRecommendationMessage } from "../src/services/planningPresentation.js";
import { ProjectService } from "../src/services/projectService.js";
import { bindFormat, bindOpenFormat, bindPlan, bindRerun, parseBoundArtifactAction } from "../src/services/artifactCallback.js";

describe("historical artifact branching", () => {
  it("encodes compact stable project/artifact bindings within Telegram callback limits", () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const actions = [bindPlan(projectId, 0), bindOpenFormat(projectId, 1, 42), bindRerun(projectId, 1, 42, "clean_up"), bindFormat(projectId, 1, 42, "option_2")];
    expect(actions.every((action) => Buffer.byteLength(action) <= 64)).toBe(true);
    expect(parseBoundArtifactAction(actions[3]!)).toEqual({ projectId, kind: "format", formattingOption: "option_2", postIndex: 1, draftVersion: 42 });
  });
  it("branches an old plan after /start and keeps callback redelivery idempotent", async () => {
    const projects = new InMemoryProjectRepository();
    const service = new ProjectService(projects, {} as ModelAdapters);
    const source = await seedPlanning(projects);
    await service.start("100", "200");

    const input = callback("callback-plan", "plan:recommended", renderPlanRecommendationMessage(planResult()), "501");
    const response = await service.handleHistoricalCallback(input);

    expect(response).toMatchObject([{ kind: "message", text: expect.stringContaining("режим"), replyToMessageId: "501" }]);
    const active = await projects.findActiveByTelegramUser("100");
    expect(active).toMatchObject({ state: "rewrite_mode", parentProjectId: source.id, rootProjectId: source.id, transcript: "Stored transcript", selectedPlan: { optionId: "recommended" } });
    expect((await projects.findById(source.id))?.selectedPlan).toBeUndefined();
    expect(await service.handleHistoricalCallback(input)).toEqual([]);
    expect((await projects.findAllByTelegramUser("100")).filter((project) => project.parentProjectId === source.id)).toHaveLength(1);
  });

  it("branches old draft rerun after formatting and never mutates the source branch", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const service = new ProjectService(projects, {} as ModelAdapters, jobs, { draftGeneration: 1 }, true);
    const source = await seedDraft(projects, { state: "formatted_editing", draftVersion: 2, formattedText: "Formatted artifact" });
    await service.start("100", "200");
    const before = await projects.findById(source.id);

    const response = await service.handleHistoricalCallback(callback("callback-rerun", "draft:rerun:clean_up:2", "Exact old draft", "502"));

    expect(response).toMatchObject([{ kind: "message", replyToMessageId: "502" }]);
    const active = await projects.findActiveByTelegramUser("100");
    expect(active).toMatchObject({ state: "draft_generating", parentProjectId: source.id, rewriteMode: "clean_up", transcript: "Stored transcript" });
    expect(await jobs.claimNextDue({ workerId: "focused" })).toMatchObject({ type: "GENERATE_DRAFT", projectId: active?.id, maxAttempts: 1 });
    expect(await projects.findById(source.id)).toEqual(before);
  });

  it("formats the exact historical draft while another branch is active", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const service = new ProjectService(projects, {} as ModelAdapters, jobs, { formatting: 1 }, true);
    const source = await seedDraft(projects, { state: "draft_editing", draftVersion: 3 });
    await service.start("100", "200");
    const sourceBefore = await projects.findById(source.id);

    const response = await service.handleHistoricalCallback({ ...callback("callback-format", "format:option_2", "Выберите вариант оформления.", "503"), replyToMessageText: "Exact old draft" });

    expect(response).toMatchObject([{ kind: "message", replyToMessageId: "503" }]);
    const active = await projects.findActiveByTelegramUser("100");
    expect(active).toMatchObject({ state: "formatting", parentProjectId: source.id, posts: [{ currentDraft: "Exact old draft", draftVersion: 3 }] });
    expect(await jobs.claimNextDue({ workerId: "focused" })).toMatchObject({ type: "FORMAT_POST", projectId: active?.id, payload: { formattingOption: "option_2" } });
    expect(await projects.findById(source.id)).toEqual(sourceBefore);
  });

  it("denies cross-owner callbacks and exports the exact historical final without changing active context", async () => {
    const projects = new InMemoryProjectRepository();
    const service = new ProjectService(projects, {} as ModelAdapters, undefined, undefined, true);
    const source = await seedDraft(projects, { state: "done", finalText: "Exact final artifact" });
    await service.start("100", "200");
    const activeBefore = await projects.findActiveByTelegramUser("100");

    expect(await service.handleHistoricalCallback(callback("callback-denied", "final:accept", "Exact final artifact", "504", "999"))).toMatchObject([{ kind: "message", text: expect.stringContaining("недоступ") }]);
    const exported = await service.handleHistoricalCallback(callback("callback-done", "final:accept", "Exact final artifact", "505"));

    expect(exported).toEqual([{ kind: "document", filename: "post-1.txt", content: "Exact final artifact", caption: "Готово.", replyToMessageId: "505" }]);
    expect(await projects.findActiveByTelegramUser("100")).toEqual(activeBefore);
    expect((await projects.findById(source.id))?.posts[0]?.finalText).toBe("Exact final artifact");
  });
});

function callback(callbackQueryId: string, action: string, callbackMessageText: string, callbackMessageId: string, telegramUserId = "100") {
  return { telegramUserId, chatId: "200", callbackQueryId, callbackMessageId, callbackMessageText, action };
}

async function seedPlanning(repository: InMemoryProjectRepository): Promise<Project> {
  const plan = planResult();
  const project: Project = baseProject("planning");
  project.transcript = "Stored transcript";
  project.planOptions = plan.options;
  project.planRecommendation = plan.recommendation;
  await repository.save(project);
  return project;
}

async function seedDraft(repository: InMemoryProjectRepository, options: { state: Project["state"]; draftVersion?: number; formattedText?: string; finalText?: string }): Promise<Project> {
  const selectedPlan = planOption();
  const project: Project = {
    ...baseProject(options.state), transcript: "Stored transcript", selectedPlan, rewriteMode: "make_post", currentPostIndex: 1,
    posts: [{ id: "post-source", index: 1, planSlice: selectedPlan.posts[0]!, currentDraft: "Exact old draft", draftVersion: options.draftVersion ?? 1, formattedText: options.formattedText, finalText: options.finalText }],
    messages: [{ kind: "draft", text: "Exact old draft", createdAt: new Date(1) }]
  };
  await repository.save(project);
  return project;
}

function baseProject(state: Project["state"]): Project {
  return { id: "11111111-1111-4111-8111-111111111111", telegramUserId: "100", chatId: "200", state, isActive: true, posts: [], messages: [], createdAt: new Date(0), updatedAt: new Date(0) };
}
function planOption(): PlanOption { return { optionId: "recommended", postCount: 1, title: "Plan", angle: "Angle", summary: "Summary", posts: [{ index: 1, topic: "Topic", angle: "Angle", includes: ["Point"] }] }; }
function planResult(): PlanningResult { return { options: [planOption()], recommendation: { recommendedOptionId: "recommended", rationale: "Reason", confidence: "high" } }; }
