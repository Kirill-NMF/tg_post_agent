import { describe, expect, it } from "vitest";
import { loadConfig, parseTelegramIdAllowlist } from "../src/config/env.js";

describe("env config", () => {
  it("parses a comma-separated Telegram ID allowlist as strings", () => {
    expect(parseTelegramIdAllowlist("123, 456").has("123")).toBe(true);
    expect(parseTelegramIdAllowlist("123, 456").has("456")).toBe(true);
  });

  it("rejects missing bot token and malformed Telegram ids", () => {
    expect(() => loadConfig({ ALLOWED_TELEGRAM_IDS: "123" })).toThrow("BOT_TOKEN");
    expect(() => loadConfig({ BOT_TOKEN: "token", ALLOWED_TELEGRAM_IDS: "123,abc" })).toThrow("numeric Telegram ids");
  });
});
