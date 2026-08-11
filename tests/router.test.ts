import { describe, expect, it } from "vitest";
import { MockModelAdapters } from "../src/adapters/mockModelAdapters.js";
import { BotRouter } from "../src/bot/router.js";
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
    expect(message(responses[0]).text).toContain("not allowed");
  });

  it("routes /start and source audio to the service", async () => {
    const botRouter = router();
    expect(message((await botRouter.handleText({ telegramUserId: "100", chatId: "200", text: "/start" }))[0]).text).toContain("Send a voice");

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

    expect(message((await botRouter.handleCallback({ telegramUserId: "100", chatId: "200", action: "plan:one_post" }))[0]).text).toContain("rewrite mode");
    expect(message((await botRouter.handleCallback({ telegramUserId: "100", chatId: "200", action: "rewrite:clean_up" }))[0]).text).toContain("Mock draft");
  });
});

function message(response: BotResponse | undefined) {
  if (!response || response.kind !== "message") throw new Error("Expected message response.");
  return response;
}
