import { FfmpegAudioProcessor } from "../audio/ffmpegAudioProcessor.js";
import { TempAudioStorage } from "../audio/tempAudioStorage.js";
import { createGeminiDraftClient, GeminiDraftAdapter } from "../adapters/geminiDraftAdapter.js";
import { createGeminiPlanningClient, GeminiPlanningAdapter } from "../adapters/geminiPlanningAdapter.js";
import { OpenAITranscriptionAdapter } from "../adapters/openAITranscriptionAdapter.js";
import { createOpenRouterInteractionClient } from "../adapters/openRouterInteractionClient.js";
import { OpenRouterTranscriptionAdapter } from "../adapters/openRouterTranscriptionAdapter.js";
import { FallbackDraftAdapter, FallbackPlanningAdapter, FallbackTranscriptionAdapter } from "../adapters/providerFallbackAdapters.js";
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
  const transcription = createTranscriptionAdapter(input.config, input.logger);
  const planning = createPlanningAdapter(input.config, input.logger);
  const draftAdapter = createDraftAdapter(input.config, input.logger);
  const files = new TelegramFileClient({ botToken: input.config.botToken, apiBaseUrl: input.config.telegramApiBaseUrl, maxDownloadBytes: input.config.telegramMaxDownloadBytes });
  const processor = new FfmpegAudioProcessor();
  const storage = new TempAudioStorage({ baseDir: input.config.audioTempDir });
  return {
    TRANSCRIBE_AUDIO: createTranscribeAudioJobHandler({ projects: input.projects, telegramFiles: files, audioProcessor: processor, transcription, storage, jobs: input.jobs, notifier: input.notifier, logger: input.logger, planSplitJobMaxAttempts: input.config.planSplitJobMaxAttempts }),
    TRANSCRIBE_EDIT_AUDIO: createTranscribeEditAudioJobHandler({ projects: input.projects, jobs: input.jobs!, telegramFiles: files, audioProcessor: processor, transcription, storage, notifier: input.notifier, logger: input.logger }),
    PLAN_SPLIT: createPlanSplitJobHandler({ projects: input.projects, planning, notifier: input.notifier, logger: input.logger }),
    REVISE_PLAN: createRevisePlanJobHandler({ projects: input.projects, planning, notifier: input.notifier, logger: input.logger }),
    GENERATE_DRAFT: createGenerateDraftJobHandler({ projects: input.projects, drafting: draftAdapter, notifier: input.notifier, logger: input.logger }),
    REVISE_DRAFT: createReviseDraftJobHandler({ projects: input.projects, drafting: draftAdapter, notifier: input.notifier, logger: input.logger })
  };
}

function createTranscriptionAdapter(config: AppConfig, logger?: Logger) {
  const direct = config.openaiApiKey ? new OpenAITranscriptionAdapter({ apiKey: config.openaiApiKey, model: config.openaiTranscriptionModel }) : undefined;

  if (!config.openRouterApiKey) {
    if (!direct) throw new Error("OPENROUTER_API_KEY or OPENAI_API_KEY is required to create real transcription handlers.");
    return direct;
  }
  return new FallbackTranscriptionAdapter({ primary: new OpenRouterTranscriptionAdapter({ apiKey: config.openRouterApiKey, model: config.openRouterTranscriptionModel }), primaryProvider: "openrouter", fallback: config.providerFallbacksEnabled ? direct : undefined, fallbackProvider: config.providerFallbacksEnabled && direct ? "whisper" : undefined, logger });
}

function createPlanningAdapter(config: AppConfig, logger?: Logger) {
  const direct = config.geminiApiKey ? new GeminiPlanningAdapter({ client: createGeminiPlanningClient(config.geminiApiKey), model: config.geminiPlanningModel, logger, provider: "gemini" }) : undefined;

  if (!config.openRouterApiKey) {
    if (!direct) throw new Error("OPENROUTER_API_KEY or GEMINI_API_KEY is required to create real planning handlers.");
    return direct;
  }
  const primary = new GeminiPlanningAdapter({ client: createOpenRouterInteractionClient({ apiKey: config.openRouterApiKey }), model: config.openRouterPlanningModel, logger, provider: "openrouter" });
  return new FallbackPlanningAdapter({ primary, primaryProvider: "openrouter", fallback: config.providerFallbacksEnabled ? direct : undefined, fallbackProvider: config.providerFallbacksEnabled && direct ? "gemini" : undefined, logger });
}

function createDraftAdapter(config: AppConfig, logger?: Logger) {
  const direct = config.geminiApiKey ? new GeminiDraftAdapter({ client: createGeminiDraftClient(config.geminiApiKey), model: config.geminiDraftModel, logger, provider: "gemini" }) : undefined;

  if (!config.openRouterApiKey) {
    if (!direct) throw new Error("OPENROUTER_API_KEY or GEMINI_API_KEY is required to create real draft handlers.");
    return direct;
  }
  const primary = new GeminiDraftAdapter({ client: createOpenRouterInteractionClient({ apiKey: config.openRouterApiKey }), model: config.openRouterDraftModel, logger, provider: "openrouter" });
  return new FallbackDraftAdapter({ primary, primaryProvider: "openrouter", fallback: config.providerFallbacksEnabled ? direct : undefined, fallbackProvider: config.providerFallbacksEnabled && direct ? "gemini" : undefined, logger });
}
