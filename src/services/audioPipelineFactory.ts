import { FfmpegAudioProcessor } from "../audio/ffmpegAudioProcessor.js";
import { TempAudioStorage } from "../audio/tempAudioStorage.js";
import { OpenAITranscriptionAdapter } from "../adapters/openAITranscriptionAdapter.js";
import type { AppConfig } from "../config/env.js";
import type { Logger } from "../observability/logger.js";
import type { ProjectRepository } from "../repositories/projectRepository.js";
import { TelegramFileClient } from "../telegram/telegramFileClient.js";
import type { TelegramNotifier } from "../telegram/telegramNotifier.js";
import { createTranscribeAudioJobHandler } from "./transcribeAudioJobHandler.js";

export function createAudioPipelineHandlers(input: { config: AppConfig; projects: ProjectRepository; notifier?: TelegramNotifier; logger?: Logger }) {
  if (!input.config.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is required to create the real audio transcription handler.");
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
      notifier: input.notifier,
      logger: input.logger
    })
  };
}
