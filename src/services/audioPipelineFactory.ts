import { FfmpegAudioProcessor } from "../audio/ffmpegAudioProcessor.js";
import { TempAudioStorage } from "../audio/tempAudioStorage.js";
import { createGeminiPlanningClient, GeminiPlanningAdapter } from "../adapters/geminiPlanningAdapter.js";
import { OpenAITranscriptionAdapter } from "../adapters/openAITranscriptionAdapter.js";
import type { AppConfig } from "../config/env.js";
import type { Logger } from "../observability/logger.js";
import type { JobRepository } from "../repositories/jobRepository.js";
import type { ProjectRepository } from "../repositories/projectRepository.js";
import { TelegramFileClient } from "../telegram/telegramFileClient.js";
import type { TelegramNotifier } from "../telegram/telegramNotifier.js";
import { createPlanSplitJobHandler } from "./planSplitJobHandler.js";
import { createTranscribeAudioJobHandler } from "./transcribeAudioJobHandler.js";

export function createAudioPipelineHandlers(input: { config: AppConfig; projects: ProjectRepository; jobs?: JobRepository; notifier?: TelegramNotifier; logger?: Logger }) {
  if (!input.config.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is required to create the real audio transcription handler.");
  }
  if (!input.config.geminiApiKey) {
    throw new Error("GEMINI_API_KEY is required to create the real planning handler.");
  }

  return {
    TRANSCRIBE_AUDIO: createTranscribeAudioJobHandler({
      projects: input.projects,
      telegramFiles: new TelegramFileClient({
        botToken: input.config.botToken,
        apiBaseUrl: input.config.telegramApiBaseUrl,
        maxDownloadBytes: input.config.telegramMaxDownloadBytes
      }),
      audioProcessor: new FfmpegAudioProcessor(),
      transcription: new OpenAITranscriptionAdapter({
        apiKey: input.config.openaiApiKey,
        model: input.config.openaiTranscriptionModel
      }),
      storage: new TempAudioStorage({ baseDir: input.config.audioTempDir }),
      jobs: input.jobs,
      notifier: input.notifier,
      logger: input.logger
    }),
    PLAN_SPLIT: createPlanSplitJobHandler({
      projects: input.projects,
      planning: new GeminiPlanningAdapter({
        client: createGeminiPlanningClient(input.config.geminiApiKey),
        model: input.config.geminiPlanningModel,
        logger: input.logger
      }),
      notifier: input.notifier,
      logger: input.logger
    })
  };
}
