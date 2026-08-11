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

  it("accepts database url from DATABASE_URL or TEST_DATABASE_URL", () => {
    expect(loadConfig({ BOT_TOKEN: "token", ALLOWED_TELEGRAM_IDS: "123", DATABASE_URL: "postgres://db" }).databaseUrl).toBe("postgres://db");
    expect(loadConfig({ BOT_TOKEN: "token", ALLOWED_TELEGRAM_IDS: "123", TEST_DATABASE_URL: "postgres://test-db" }).databaseUrl).toBe("postgres://test-db");
  });

  it("uses safe audio/transcription defaults and validates download byte limit", () => {
    const config = loadConfig({ BOT_TOKEN: "token", ALLOWED_TELEGRAM_IDS: "123" });
    expect(config.audioTempDir).toBe(".runtime/audio");
    expect(config.telegramApiBaseUrl).toBe("https://api.telegram.org");
    expect(config.telegramMaxDownloadBytes).toBe(20 * 1024 * 1024);
    expect(config.openaiTranscriptionModel).toBe("whisper-1");

    expect(() => loadConfig({ BOT_TOKEN: "token", ALLOWED_TELEGRAM_IDS: "123", TELEGRAM_MAX_DOWNLOAD_BYTES: "0" })).toThrow("positive integer");
  });
});
