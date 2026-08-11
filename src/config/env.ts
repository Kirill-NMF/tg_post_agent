import { resolveDatabaseUrl } from "../db/connection.js";
import { telegramCloudMaxDownloadBytes } from "../telegram/telegramFileClient.js";

export type AppConfig = {
  botToken: string;
  allowedTelegramIds: Set<string>;
  databaseUrl?: string;
  audioTempDir: string;
  telegramApiBaseUrl: string;
  telegramMaxDownloadBytes: number;
  openaiApiKey?: string;
  openaiTranscriptionModel: string;
};

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const botToken = readRequired(env, "BOT_TOKEN");
  const allowedTelegramIds = parseTelegramIdAllowlist(readRequired(env, "ALLOWED_TELEGRAM_IDS"));
  const databaseUrl = resolveDatabaseUrl(env);
  return {
    botToken,
    allowedTelegramIds,
    databaseUrl,
    audioTempDir: readOptional(env, "AUDIO_TEMP_DIR") ?? ".runtime/audio",
    telegramApiBaseUrl: readOptional(env, "TELEGRAM_API_BASE_URL") ?? "https://api.telegram.org",
    telegramMaxDownloadBytes: readOptionalInteger(env, "TELEGRAM_MAX_DOWNLOAD_BYTES") ?? telegramCloudMaxDownloadBytes,
    openaiApiKey: readOptional(env, "OPENAI_API_KEY"),
    openaiTranscriptionModel: readOptional(env, "OPENAI_TRANSCRIPTION_MODEL") ?? "whisper-1"
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
