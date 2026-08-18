import { describe, expect, it, vi } from "vitest";
import { InMemoryCustomEmojiRepository } from "../src/repositories/inMemoryCustomEmojiRepository.js";
import { GrammyTelegramNotifier, telegramSendMessageMaxChars } from "../src/telegram/telegramNotifier.js";

describe("GrammyTelegramNotifier", () => {
  it("sends a message through the Telegram API boundary", async () => {
    const api = { sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }) };
    const notifier = new GrammyTelegramNotifier(api);

    await notifier.sendMessage("200", "Готово");

    expect(api.sendMessage).toHaveBeenCalledWith("200", "Готово", undefined);
  });

  it("rejects messages outside Telegram sendMessage length limits", async () => {
    const api = { sendMessage: vi.fn() };
    const notifier = new GrammyTelegramNotifier(api);

    await expect(notifier.sendMessage("200", "")).rejects.toThrow("between 1 and 4096");
    await expect(notifier.sendMessage("200", "x".repeat(telegramSendMessageMaxChars + 1))).rejects.toThrow("between 1 and 4096");
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("refuses to mix parse_mode with explicit entities", async () => {
    const api = { sendMessage: vi.fn() };
    const notifier = new GrammyTelegramNotifier(api);

    await expect(notifier.sendMessage("200", "Text", { parse_mode: "HTML", entities: [{ type: "bold", offset: 0, length: 4 }] }))
      .rejects.toThrow("TELEGRAM_PARSE_MODE_ENTITIES_CONFLICT");
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("sends custom entities without parse_mode and audits the accepted response without resending", async () => {
    const api = { sendMessage: vi.fn().mockResolvedValue({ entities: [{ type: "custom_emoji", offset: 0, length: 2, custom_emoji_id: "1001" }] }) };
    const repository = await configuredRepository();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const notifier = new GrammyTelegramNotifier(api, logger, repository);

    await notifier.sendCryptusOption2("200", "📜 **Заголовок**", { reply_markup: { inline_keyboard: [] } });

    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    const options = api.sendMessage.mock.calls[0]![2];
    expect(options).not.toHaveProperty("parse_mode");
    expect(options.entities).toContainEqual({ type: "custom_emoji", offset: 0, length: 2, custom_emoji_id: "1001" });
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ event: "telegram_custom_emoji_audit", requestedCustomCount: 1, returnedCustomCount: 1 }), expect.any(String));
  });

  it("falls back exactly once to Unicode/base entities after a definite custom-entity rejection", async () => {
    const api = { sendMessage: vi.fn()
      .mockRejectedValueOnce({ name: "GrammyError", error_code: 400, description: "Bad Request: custom emoji entity invalid" })
      .mockResolvedValueOnce({ entities: [] }) };
    const notifier = new GrammyTelegramNotifier(api, undefined, await configuredRepository());

    await notifier.sendCryptusOption2("200", "📜 **Заголовок**");

    expect(api.sendMessage).toHaveBeenCalledTimes(2);
    expect(api.sendMessage.mock.calls[0]![2].entities.some((entity: { type: string }) => entity.type === "custom_emoji")).toBe(true);
    expect(api.sendMessage.mock.calls[1]![2].entities.some((entity: { type: string }) => entity.type === "custom_emoji")).toBe(false);
  });

  it("does not auto-send a duplicate after an ambiguous timeout", async () => {
    const timeout = Object.assign(new Error("request timed out"), { name: "HttpError" });
    const api = { sendMessage: vi.fn().mockRejectedValue(timeout) };
    const notifier = new GrammyTelegramNotifier(api, undefined, await configuredRepository());

    await expect(notifier.sendCryptusOption2("200", "📜 **Заголовок**")).rejects.toMatchObject({ name: "HttpError" });
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("uses Unicode/base entities when a complete persisted mapping is unavailable", async () => {
    const api = { sendMessage: vi.fn().mockResolvedValue({ entities: [] }) };
    const notifier = new GrammyTelegramNotifier(api, undefined, new InMemoryCustomEmojiRepository());

    await notifier.sendCryptusOption2("200", "📜 **Заголовок**");

    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(api.sendMessage.mock.calls[0]![2].entities).toEqual([{ type: "bold", offset: 3, length: 9 }]);
  });
});

async function configuredRepository(): Promise<InMemoryCustomEmojiRepository> {
  const repository = new InMemoryCustomEmojiRepository();
  await repository.replaceAll([
    ["post_title", "📜"], ["section_title", "⏸️"], ["list_item", "🟠"],
    ["copy_block", "🔅"], ["cta", "🔥"], ["audience_question", "🟰"]
  ].map(([role, alt], index) => ({ role: role as never, alt, customEmojiId: String(1001 + index), setName: `set_${index + 1}` })));
  return repository;
}
