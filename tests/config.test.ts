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
    expect(config.openRouterTranscriptionModel).toBe("openai/whisper-large-v3");
    expect(config.openRouterPlanningModel).toBe("google/gemini-2.5-pro");
    expect(config.openRouterDraftModel).toBe("google/gemini-2.5-pro");
    expect(config.openRouterFormattingModel).toBeUndefined();
    expect(config.openaiTranscriptionModel).toBe("whisper-1");
    expect(config.geminiPlanningModel).toBe("gemini-2.5-pro");
    expect(config.geminiDraftModel).toBe("gemini-2.5-pro");
    expect(config.providerFallbacksEnabled).toBe(true);
    expect(config.providerRequestTimeoutMs).toBe(60_000);
    expect(config.jobWorkerEnabled).toBe(false);
    expect(config.jobWorkerIntervalMs).toBe(1000);
    expect(config.jobWorkerStaleMs).toBe(15 * 60 * 1000);
    expect(config.jobWorkerId).toContain("tg-post-agent-");
    expect(config.sourceAudioJobMaxAttempts).toBe(3);
    expect(config.planSplitJobMaxAttempts).toBe(3);
    expect(config.draftGenerationJobMaxAttempts).toBe(3);
    expect(config.formattingJobMaxAttempts).toBe(3);

    expect(() => loadConfig({ BOT_TOKEN: "token", ALLOWED_TELEGRAM_IDS: "123", TELEGRAM_MAX_DOWNLOAD_BYTES: "0" })).toThrow("positive integer");
  });

  it("parses worker runtime flags", () => {
    const config = loadConfig({
      BOT_TOKEN: "token",
      ALLOWED_TELEGRAM_IDS: "123",
      JOB_WORKER_ENABLED: "true",
      JOB_WORKER_INTERVAL_MS: "250",
      JOB_WORKER_STALE_MS: "5000",
      JOB_WORKER_ID: "worker-a",
      SOURCE_AUDIO_JOB_MAX_ATTEMPTS: "1",
      PLAN_SPLIT_JOB_MAX_ATTEMPTS: "1",
      DRAFT_GENERATION_JOB_MAX_ATTEMPTS: "1",
      FORMATTING_JOB_MAX_ATTEMPTS: "1",
      PROVIDER_REQUEST_TIMEOUT_MS: "45000",
      PROVIDER_FALLBACKS_ENABLED: "false"
    });

    expect(config.jobWorkerEnabled).toBe(true);
    expect(config.jobWorkerIntervalMs).toBe(250);
    expect(config.jobWorkerStaleMs).toBe(5000);
    expect(config.jobWorkerId).toBe("worker-a");
    expect(config.sourceAudioJobMaxAttempts).toBe(1);
    expect(config.planSplitJobMaxAttempts).toBe(1);
    expect(config.providerFallbacksEnabled).toBe(false);
    expect(config.draftGenerationJobMaxAttempts).toBe(1);
    expect(config.formattingJobMaxAttempts).toBe(1);
    expect(config.providerRequestTimeoutMs).toBe(45_000);
    expect(() => loadConfig({ BOT_TOKEN: "token", ALLOWED_TELEGRAM_IDS: "123", JOB_WORKER_ENABLED: "yes" })).toThrow("true or false");
  });

  it("parses Gemini planning and draft config", () => {
    const config = loadConfig({
      BOT_TOKEN: "token",
      ALLOWED_TELEGRAM_IDS: "123",
      GEMINI_API_KEY: "test-gemini-key",
      GEMINI_PLANNING_MODEL: "gemini-2.5-flash",
      GEMINI_DRAFT_MODEL: "gemini-2.5-pro"
    });

    expect(config.geminiApiKey).toBe("test-gemini-key");
    expect(config.geminiPlanningModel).toBe("gemini-2.5-flash");
    expect(config.geminiDraftModel).toBe("gemini-2.5-pro");
  });

  it("keeps the formatting model explicitly unset unless the owner configures it", () => {
    const config = loadConfig({ BOT_TOKEN: "token", ALLOWED_TELEGRAM_IDS: "123", OPENROUTER_FORMATTING_MODEL: "provider/model" });
    expect(config.openRouterFormattingModel).toBe("provider/model");
  });
});

describe("OpenRouter config priority", () => {
  it("uses OpenRouter defaults while retaining optional direct provider values", () => {
    const config = loadConfig({
      BOT_TOKEN: "token",
      ALLOWED_TELEGRAM_IDS: "123",
      OPENROUTER_API_KEY: "router-key",
      OPENAI_API_KEY: "openai-key",
      GEMINI_API_KEY: "gemini-key"
    });
    expect(config.openRouterApiKey).toBe("router-key");
    expect(config.openRouterTranscriptionModel).toBe("openai/whisper-large-v3");
    expect(config.openRouterPlanningModel).toBe("google/gemini-2.5-pro");
    expect(config.openRouterDraftModel).toBe("google/gemini-2.5-pro");
    expect(config.openaiApiKey).toBe("openai-key");
    expect(config.geminiApiKey).toBe("gemini-key");
    expect(config.openRouterFormattingModel).toBeUndefined();
  });
});
