import { describe, expect, it, vi } from "vitest";
import type { BotRouter } from "../src/bot/router.js";
import { createBot } from "../src/bot/createBot.js";
import { InMemoryCustomEmojiRepository } from "../src/repositories/inMemoryCustomEmojiRepository.js";
import { CustomEmojiSetupService } from "../src/services/customEmojiSetupService.js";

describe("/emoji_setup bot command", () => {
  it("routes one owner command through getCustomEmojiStickers and replies without exposing ids", async () => {
    const repository = new InMemoryCustomEmojiRepository();
    const setup = new CustomEmojiSetupService({ ownerTelegramId: "100", repository });
    const bot = createBot("0000000000:test-token", unusedRouter(), setup);
    const methods: string[] = [];
    bot.api.config.use((async (_previous: unknown, method: string) => {
      methods.push(method);
      if (method === "getMe") return { ok: true, result: { id: 1, is_bot: true, first_name: "bot", username: "fixture_bot" } };
      if (method === "getCustomEmojiStickers") return { ok: true, result: stickers() };
      if (method === "sendMessage") return { ok: true, result: { message_id: 2, date: 0, chat: { id: 100, type: "private" }, text: "saved" } };
      throw new Error(`unexpected method ${method}`);
    }) as never);
    await bot.init();

    await bot.handleUpdate(update(100) as never);

    expect(methods.filter((method) => method === "getCustomEmojiStickers")).toHaveLength(1);
    expect(methods.filter((method) => method === "sendMessage")).toHaveLength(1);
    expect(await repository.get()).toBeDefined();
  });

  it("does not resolve stickers for an allowlisted but non-owner command sender", async () => {
    const repository = new InMemoryCustomEmojiRepository();
    const setup = new CustomEmojiSetupService({ ownerTelegramId: "100", repository });
    const bot = createBot("0000000000:test-token", unusedRouter(), setup);
    const customResolver = vi.fn();
    bot.api.config.use((async (_previous: unknown, method: string) => {
      if (method === "getMe") return { ok: true, result: { id: 1, is_bot: true, first_name: "bot", username: "fixture_bot" } };
      if (method === "getCustomEmojiStickers") { customResolver(); return { ok: true, result: stickers() }; }
      if (method === "sendMessage") return { ok: true, result: { message_id: 2, date: 0, chat: { id: 101, type: "private" }, text: "forbidden" } };
      throw new Error(`unexpected method ${method}`);
    }) as never);
    await bot.init();

    await bot.handleUpdate(update(101) as never);

    expect(customResolver).not.toHaveBeenCalled();
    expect(await repository.get()).toBeUndefined();
  });

  it("sends one actionable response when the setup handler throws unexpectedly", async () => {
    const setup = { configure: vi.fn().mockRejectedValue(new Error("fixture failure")) };
    const logger = { info: vi.fn(), warn: vi.fn() };
    const bot = createBot("0000000000:test-token", unusedRouter(), setup as never, logger);
    const sentMessages: unknown[] = [];
    bot.api.config.use((async (_previous: unknown, method: string, payload: unknown) => {
      if (method === "getMe") return { ok: true, result: { id: 1, is_bot: true, first_name: "bot", username: "fixture_bot" } };
      if (method === "sendMessage") {
        sentMessages.push(payload);
        return { ok: true, result: { message_id: 2, date: 0, chat: { id: 100, type: "private" }, text: "recovery" } };
      }
      throw new Error(`unexpected method ${method}`);
    }) as never);
    await bot.init();

    await bot.handleUpdate(update(100) as never);

    expect(setup.configure).toHaveBeenCalledTimes(1);
    expect(sentMessages).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "emoji_setup_handler_failed", errorCode: "Error" }),
      expect.any(String)
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "emoji_setup_reply_sent" }),
      expect.any(String)
    );
  });
});

function update(userId: number) {
  const text = "/emoji_setup 📜 ⏸️ 🟠 🔅 🔥 🟰";
  const values = ["📜", "⏸️", "🟠", "🔅", "🔥", "🟰"];
  const entities: Array<Record<string, unknown>> = [{ type: "bot_command", offset: 0, length: 12 }];
  let offset = 13;
  values.forEach((value, index) => {
    entities.push({ type: "custom_emoji", offset, length: value.length, custom_emoji_id: String(1001 + index) });
    offset += value.length + (index === values.length - 1 ? 0 : 1);
  });
  return {
    update_id: 1,
    message: { message_id: 1, date: 0, from: { id: userId, is_bot: false, first_name: "owner" }, chat: { id: userId, type: "private" as const }, text, entities }
  };
}

function stickers() {
  return ["📜", "⏸️", "🟠", "🔅", "🔥", "🟰"].map((emoji, index) => ({
    file_id: `file-${index}`,
    file_unique_id: `unique-${index}`,
    type: "custom_emoji" as const,
    width: 100,
    height: 100,
    is_animated: true,
    is_video: false,
    custom_emoji_id: String(1001 + index),
    emoji,
    set_name: index === 4 ? "owner_cta_pack" : "CRYPTUSinstrument"
  }));
}

function unusedRouter(): BotRouter {
  return {
    handleText: vi.fn().mockRejectedValue(new Error("generic text route must not run")),
    handleCallback: vi.fn(),
    handleAudio: vi.fn()
  } as unknown as BotRouter;
}
