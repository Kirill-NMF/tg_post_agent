import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { InMemoryProjectRepository } from "../src/repositories/inMemoryProjectRepository.js";
import { createAudioPipelineHandlers } from "../src/services/audioPipelineFactory.js";

describe("audio pipeline factory", () => {
  it("requires OpenAI API key when creating real worker handlers", () => {
    const config = loadConfig({ BOT_TOKEN: "token", ALLOWED_TELEGRAM_IDS: "123" });

    expect(() => createAudioPipelineHandlers({ config, projects: new InMemoryProjectRepository() })).toThrow("OPENAI_API_KEY");
  });

  it("requires Gemini API key when creating real worker handlers", () => {
    const config = loadConfig({
      BOT_TOKEN: "token",
      ALLOWED_TELEGRAM_IDS: "123",
      OPENAI_API_KEY: "test-key"
    });

    expect(() => createAudioPipelineHandlers({ config, projects: new InMemoryProjectRepository() })).toThrow("GEMINI_API_KEY");
  });

  it("creates TRANSCRIBE_AUDIO, PLAN_SPLIT, GENERATE_DRAFT, and REVISE_DRAFT handlers from env-backed config", () => {
    const config = loadConfig({
      BOT_TOKEN: "token",
      ALLOWED_TELEGRAM_IDS: "123",
      OPENAI_API_KEY: "test-key",
      OPENAI_TRANSCRIPTION_MODEL: "whisper-1",
      GEMINI_API_KEY: "test-gemini-key"
    });

    expect(createAudioPipelineHandlers({ config, projects: new InMemoryProjectRepository() })).toHaveProperty("TRANSCRIBE_AUDIO");
    expect(createAudioPipelineHandlers({ config, projects: new InMemoryProjectRepository() })).toHaveProperty("PLAN_SPLIT");
    expect(createAudioPipelineHandlers({ config, projects: new InMemoryProjectRepository() })).toHaveProperty("GENERATE_DRAFT");
    expect(createAudioPipelineHandlers({ config, projects: new InMemoryProjectRepository() })).toHaveProperty("REVISE_DRAFT");
    expect(createAudioPipelineHandlers({ config, projects: new InMemoryProjectRepository() })).not.toHaveProperty("FORMAT_POST");
  });

  it("adds FORMAT_POST only for an explicit OpenRouter formatting model", () => {
    const config = loadConfig({
      BOT_TOKEN: "token",
      ALLOWED_TELEGRAM_IDS: "123",
      OPENROUTER_API_KEY: "test-key",
      OPENROUTER_FORMATTING_MODEL: "owner-selected-model"
    });
    expect(createAudioPipelineHandlers({ config, projects: new InMemoryProjectRepository() })).toHaveProperty("FORMAT_POST");
  });

  it("refuses a formatting model without the OpenRouter credential", () => {
    const config = loadConfig({
      BOT_TOKEN: "token",
      ALLOWED_TELEGRAM_IDS: "123",
      OPENAI_API_KEY: "test-openai-key",
      GEMINI_API_KEY: "test-gemini-key",
      OPENROUTER_FORMATTING_MODEL: "owner-selected-model"
    });
    expect(() => createAudioPipelineHandlers({ config, projects: new InMemoryProjectRepository() })).toThrow("OPENROUTER_API_KEY");
  });
});
