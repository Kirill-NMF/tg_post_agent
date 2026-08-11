import { describe, expect, it } from "vitest";
import { buildApplication } from "../src/index.js";

describe("application wiring", () => {
  it("does not create a worker runtime unless explicitly enabled", () => {
    const app = buildApplication({ BOT_TOKEN: "0000000000:mock-token-for-smoke", ALLOWED_TELEGRAM_IDS: "12345" });

    expect(app.workerRuntime).toBeUndefined();
  });

  it("fails fast when worker runtime is enabled without database config", () => {
    expect(() =>
      buildApplication({
        BOT_TOKEN: "0000000000:mock-token-for-smoke",
        ALLOWED_TELEGRAM_IDS: "12345",
        JOB_WORKER_ENABLED: "true",
        OPENAI_API_KEY: "test-key"
      })
    ).toThrow("DATABASE_URL");
  });

  it("fails fast when worker runtime is enabled without OpenAI transcription config", () => {
    expect(() =>
      buildApplication({
        BOT_TOKEN: "0000000000:mock-token-for-smoke",
        ALLOWED_TELEGRAM_IDS: "12345",
        JOB_WORKER_ENABLED: "true",
        DATABASE_URL: "postgresql://example.invalid/test"
      })
    ).toThrow("OPENAI_API_KEY");
  });
});
