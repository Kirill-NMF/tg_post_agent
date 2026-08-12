import { FfmpegAudioProcessor } from "../audio/ffmpegAudioProcessor.js";
import { TempAudioStorage } from "../audio/tempAudioStorage.js";
import { createGeminiDraftClient, GeminiDraftAdapter } from "../adapters/geminiDraftAdapter.js";
import { createGeminiPlanningClient, GeminiPlanningAdapter } from "../adapters/geminiPlanningAdapter.js";
import { OpenAITranscriptionAdapter } from "../adapters/openAITranscriptionAdapter.js";
import type { AppConfig } from "../config/env.js";
import type { Logger } from "../observability/logger.js";
import type { JobRepository } from "../repositories/jobRepository.js";
import type { ProjectRepository } from "../repositories/projectRepository.js";
import { TelegramFileClient } from "../telegram/telegramFileClient.js";
import type { TelegramNotifier } from "../telegram/telegramNotifier.js";
import { createGenerateDraftJobHandler } from "./generateDraftJobHandler.js";
import { createPlanSplitJobHandler } from "./planSplitJobHandler.js";
import { createReviseDraftJobHandler } from "./reviseDraftJobHandler.js";
import { createRevisePlanJobHandler } from "./revisePlanJobHandler.js";
import { createTranscribeAudioJobHandler } from "./transcribeAudioJobHandler.js";
import { createTranscribeEditAudioJobHandler } from "./transcribeEditAudioJobHandler.js";

export function createAudioPipelineHandlers(input: { config: AppConfig; projects: ProjectRepository; jobs?: JobRepository; notifier?: TelegramNotifier; logger?: Logger }) {
  if (!input.config.openaiApiKey) throw new Error("OPENAI_API_KEY is required to create the real audio transcription handler.");
  if (!input.config.geminiApiKey) throw new Error("GEMINI_API_KEY is required to create the real planning and draft handlers.");
  const files = new TelegramFileClient({ botToken: input.config.botToken, apiBaseUrl: input.config.telegramApiBaseUrl, maxDownloadBytes: input.config.telegramMaxDownloadBytes });
  const processor = new FfmpegAudioProcessor();
  const transcription = new OpenAITranscriptionAdapter({ apiKey: input.config.openaiApiKey, model: input.config.openaiTranscriptionModel });
  const storage = new TempAudioStorage({ baseDir: input.config.audioTempDir });
  const planning = new GeminiPlanningAdapter({ client: createGeminiPlanningClient(input.config.geminiApiKey), model: input.config.geminiPlanningModel, logger: input.logger });
  const draftAdapter = new GeminiDraftAdapter({ client: createGeminiDraftClient(input.config.geminiApiKey), model: input.config.geminiDraftModel, logger: input.logger });
  return {
    TRANSCRIBE_AUDIO: createTranscribeAudioJobHandler({ projects: input.projects, telegramFiles: files, audioProcessor: processor, transcription, storage, jobs: input.jobs, notifier: input.notifier, logger: input.logger }),
    TRANSCRIBE_EDIT_AUDIO: createTranscribeEditAudioJobHandler({ projects: input.projects, jobs: input.jobs!, telegramFiles: files, audioProcessor: processor, transcription, storage, logger: input.logger }),
    PLAN_SPLIT: createPlanSplitJobHandler({ projects: input.projects, planning, notifier: input.notifier, logger: input.logger }),
    REVISE_PLAN: createRevisePlanJobHandler({ projects: input.projects, planning, notifier: input.notifier, logger: input.logger }),
    GENERATE_DRAFT: createGenerateDraftJobHandler({ projects: input.projects, drafting: draftAdapter, notifier: input.notifier, logger: input.logger }),
    REVISE_DRAFT: createReviseDraftJobHandler({ projects: input.projects, drafting: draftAdapter, notifier: input.notifier, logger: input.logger })
  };
}
