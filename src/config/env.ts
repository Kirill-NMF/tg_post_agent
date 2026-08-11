export type AppConfig = {
  botToken: string;
  allowedTelegramIds: Set<string>;
};

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const botToken = readRequired(env, "BOT_TOKEN");
  const allowedTelegramIds = parseTelegramIdAllowlist(readRequired(env, "ALLOWED_TELEGRAM_IDS"));
  return { botToken, allowedTelegramIds };
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
