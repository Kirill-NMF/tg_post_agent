import { describe, expect, it, vi } from "vitest";
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
});
