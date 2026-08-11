import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { InMemoryProjectRepository } from "../src/repositories/inMemoryProjectRepository.js";
import { createAudioPipelineHandlers } from "../src/services/audioPipelineFactory.js";

describe("audio pipeline factory", () => {
  it("requires OpenAI API key only when creating the real transcription handler", () => {
    const config = loadConfig({ BOT_TOKEN: "token", ALLOWED_TELEGRAM_IDS: "123" });

    expect(() => createAudioPipelineHandlers({ config, projects: new InMemoryProjectRepository() })).toThrow("OPENAI_API_KEY");
  });

  it("creates a TRANSCRIBE_AUDIO handler from env-backed config", () => {
    const config = loadConfig({
      BOT_TOKEN: "token",
      ALLOWED_TELEGRAM_IDS: "123",
      OPENAI_API_KEY: "test-key",
      OPENAI_TRANSCRIPTION_MODEL: "whisper-1"
    });

    expect(createAudioPipelineHandlers({ config, projects: new InMemoryProjectRepository() })).toHaveProperty("TRANSCRIBE_AUDIO");
  });
});
