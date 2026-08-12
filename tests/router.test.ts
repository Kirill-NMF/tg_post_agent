import { describe, expect, it } from "vitest";
import { MockModelAdapters } from "../src/adapters/mockModelAdapters.js";
import { BotRouter } from "../src/bot/router.js";
import type { PlanOption, Project } from "../src/domain/types.js";
import { InMemoryJobRepository } from "../src/repositories/inMemoryJobRepository.js";
import { InMemoryProjectRepository } from "../src/repositories/inMemoryProjectRepository.js";
import { TelegramAuthService } from "../src/services/authService.js";
import { ProjectService } from "../src/services/projectService.js";
import type { BotResponse } from "../src/domain/types.js";

function router() {
  const repository = new InMemoryProjectRepository();
  const projectService = new ProjectService(repository, new MockModelAdapters());
  return new BotRouter(new TelegramAuthService(new Set(["100"])), projectService);
}

describe("BotRouter", () => {
  it("enforces Telegram ID allowlist before state handling", async () => {
    const responses = await router().handleText({ telegramUserId: "999", chatId: "200", text: "/start" });
    expect(message(responses[0]).text).toContain("не разрешён");
  });

  it("routes /start and source audio to the service", async () => {
    const botRouter = router();
    expect(message((await botRouter.handleText({ telegramUserId: "100", chatId: "200", text: "/start" }))[0]).text).toContain("Пришлите");

    const planning = await botRouter.handleAudio({
      telegramUserId: "100",
      chatId: "200",
      audio: { kind: "audio_document", telegramFileId: "doc-id", mimeType: "audio/mpeg" }
    });
    expect(message(planning[0]).buttons?.map((button) => button.action)).toEqual(["plan:one_post", "plan:two_posts", "plan:three_posts"]);
  });

  it("routes callback actions without Telegram network", async () => {
    const botRouter = router();
    await botRouter.handleText({ telegramUserId: "100", chatId: "200", text: "/start" });
    await botRouter.handleAudio({ telegramUserId: "100", chatId: "200", audio: { kind: "voice", telegramFileId: "voice-id" } });

    expect(message((await botRouter.handleCallback({ telegramUserId: "100", chatId: "200", action: "plan:one_post" }))[0]).text).toContain("режим");
    expect(message((await botRouter.handleCallback({ telegramUserId: "100", chatId: "200", action: "rewrite:clean_up" }))[0]).text).toContain("Mock draft");
  });

  it("routes rewrite callback to draft job enqueue path when jobs are configured", async () => {
    const repository = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const projectService = new ProjectService(repository, new MockModelAdapters(), jobs);
    const botRouter = new BotRouter(new TelegramAuthService(new Set(["100"])), projectService);
    await seedRewriteProject(repository);

    const response = await botRouter.handleCallback({ telegramUserId: "100", chatId: "200", action: "rewrite:make_post" });

    expect(message(response[0]).text).not.toContain("Mock draft");
    expect((await repository.findActiveByTelegramUser("100"))?.state).toBe("draft_generating");
    expect((await jobs.claimNextDue({ workerId: "worker-1" }))?.type).toBe("GENERATE_DRAFT");
  });

  it("routes draft text edits to revision job enqueue path when jobs are configured", async () => {
    const repository = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const projectService = new ProjectService(repository, new MockModelAdapters(), jobs);
    const botRouter = new BotRouter(new TelegramAuthService(new Set(["100"])), projectService);
    await seedDraftEditingProject(repository);

    const response = await botRouter.handleText({ telegramUserId: "100", chatId: "200", text: "shorten intro" });

    expect(message(response[0]).text).toContain("обновляю черновик");
    const job = await jobs.claimNextDue({ workerId: "worker-1" });
    expect(job).toMatchObject({ type: "REVISE_DRAFT", payload: { latestUserEdit: "shorten intro" } });
    expect((await repository.findActiveByTelegramUser("100"))?.posts[0]?.currentDraft).toBe("Current draft");
  });

  it("routes production draft voice edits to text-edit guidance without mock transcription", async () => {
    const repository = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const projectService = new ProjectService(repository, new MockModelAdapters(), jobs);
    const botRouter = new BotRouter(new TelegramAuthService(new Set(["100"])), projectService);
    await seedDraftEditingProject(repository);

    const response = await botRouter.handleAudio({ telegramUserId: "100", chatId: "200", audio: { kind: "voice", telegramFileId: "edit-voice-id" } });

    expect(message(response[0]).text).toContain("Напишите правку текстом");
    expect(await jobs.claimNextDue({ workerId: "worker-1" })).toBeUndefined();
  });

  it("returns fallback router text without mojibake", async () => {
    const botRouter = router();
    const response = message((await botRouter.handleCallback({ telegramUserId: "100", chatId: "200", action: "unknown:action" }))[0]);

    expect(response.text).toContain("Неизвестное действие");
    expect(response.text).not.toMatch(/\?{3,}|�|Гђ|Г‘|Р [РЂ-Уї]/);
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
