import { resolveDatabaseUrl } from "../db/connection.js";
import { telegramCloudMaxDownloadBytes } from "../telegram/telegramFileClient.js";

export type AppConfig = {
  botToken: string;
  allowedTelegramIds: Set<string>;
  databaseUrl?: string;
  audioTempDir: string;
  telegramApiBaseUrl: string;
  telegramMaxDownloadBytes: number;
  openRouterApiKey?: string;
  openRouterTranscriptionModel: string;
  openRouterPlanningModel: string;
  openRouterDraftModel: string;
  openaiApiKey?: string;
  openaiTranscriptionModel: string;
  geminiApiKey?: string;
  geminiPlanningModel: string;
  geminiDraftModel: string;
  providerFallbacksEnabled: boolean;
  jobWorkerEnabled: boolean;
  jobWorkerIntervalMs: number;
  jobWorkerStaleMs: number;
  jobWorkerId: string;
  sourceAudioJobMaxAttempts: number;
  planSplitJobMaxAttempts: number;
  editAudioJobMaxAttempts: number;
  planRevisionJobMaxAttempts: number;
};

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const botToken = readRequired(env, "BOT_TOKEN");
  const allowedTelegramIds = parseTelegramIdAllowlist(readRequired(env, "ALLOWED_TELEGRAM_IDS"));
  const databaseUrl = resolveDatabaseUrl(env);
  const geminiPlanningModel = readOptional(env, "GEMINI_PLANNING_MODEL") ?? "gemini-2.5-pro";
  const openRouterPlanningModel = readOptional(env, "OPENROUTER_PLANNING_MODEL") ?? "google/gemini-2.5-pro";

  return {
    botToken,
    allowedTelegramIds,
    databaseUrl,
    audioTempDir: readOptional(env, "AUDIO_TEMP_DIR") ?? ".runtime/audio",
    telegramApiBaseUrl: readOptional(env, "TELEGRAM_API_BASE_URL") ?? "https://api.telegram.org",
    telegramMaxDownloadBytes: readOptionalInteger(env, "TELEGRAM_MAX_DOWNLOAD_BYTES") ?? telegramCloudMaxDownloadBytes,
    openRouterApiKey: readOptional(env, "OPENROUTER_API_KEY"),
    openRouterTranscriptionModel: readOptional(env, "OPENROUTER_TRANSCRIPTION_MODEL") ?? "openai/whisper-large-v3",
    openRouterPlanningModel,
    openRouterDraftModel: readOptional(env, "OPENROUTER_DRAFT_MODEL") ?? openRouterPlanningModel,
    openaiApiKey: readOptional(env, "OPENAI_API_KEY"),
    openaiTranscriptionModel: readOptional(env, "OPENAI_TRANSCRIPTION_MODEL") ?? "whisper-1",
    geminiApiKey: readOptional(env, "GEMINI_API_KEY"),
    geminiPlanningModel,
    geminiDraftModel: readOptional(env, "GEMINI_DRAFT_MODEL") ?? geminiPlanningModel,
    providerFallbacksEnabled: readOptionalBoolean(env, "PROVIDER_FALLBACKS_ENABLED") ?? true,
    jobWorkerEnabled: readOptionalBoolean(env, "JOB_WORKER_ENABLED") ?? false,
    jobWorkerIntervalMs: readOptionalInteger(env, "JOB_WORKER_INTERVAL_MS") ?? 1000,
    jobWorkerStaleMs: readOptionalInteger(env, "JOB_WORKER_STALE_MS") ?? 15 * 60 * 1000,
    jobWorkerId: readOptional(env, "JOB_WORKER_ID") ?? `tg-post-agent-${process.pid}`,
    sourceAudioJobMaxAttempts: readOptionalInteger(env, "SOURCE_AUDIO_JOB_MAX_ATTEMPTS") ?? 3,
    planSplitJobMaxAttempts: readOptionalInteger(env, "PLAN_SPLIT_JOB_MAX_ATTEMPTS") ?? 3,
    editAudioJobMaxAttempts: readOptionalInteger(env, "EDIT_AUDIO_JOB_MAX_ATTEMPTS") ?? 3,
    planRevisionJobMaxAttempts: readOptionalInteger(env, "PLAN_REVISION_JOB_MAX_ATTEMPTS") ?? 3
  };
}

export function parseTelegramIdAllowlist(raw: string): Set<string> {
  const ids = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    throw new Error("ALLOWED_TELEGRAM_IDS must contain at least one Telegram id.");
  }

  for (const id of ids) {
    if (!/^\d{1,20}$/.test(id)) {
      throw new Error("ALLOWED_TELEGRAM_IDS must be a comma-separated list of numeric Telegram ids.");
    }
  }

  return new Set(ids);
}

function readRequired(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function readOptional(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}

function readOptionalInteger(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const raw = readOptional(env, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function readOptionalBoolean(env: NodeJS.ProcessEnv, name: string): boolean | undefined {
  const raw = readOptional(env, name);
  if (raw === undefined) return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be true or false.`);
}
