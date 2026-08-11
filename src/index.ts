import { MockModelAdapters } from "./adapters/mockModelAdapters.js";
import { createBot } from "./bot/createBot.js";
import { BotRouter } from "./bot/router.js";
import { loadConfig } from "./config/env.js";
import { createDb, createDbPool } from "./db/connection.js";
import { InMemoryProjectRepository } from "./repositories/inMemoryProjectRepository.js";
import { PgProjectRepository } from "./repositories/pgProjectRepository.js";
import { TelegramAuthService } from "./services/authService.js";
import { ProjectService } from "./services/projectService.js";

export function buildApplication(env: NodeJS.ProcessEnv) {
  const config = loadConfig(env);
  const repository = config.databaseUrl
    ? new PgProjectRepository(createDb(createDbPool({ databaseUrl: config.databaseUrl })))
    : new InMemoryProjectRepository();
  const modelAdapters = new MockModelAdapters();
  const projectService = new ProjectService(repository, modelAdapters);
  const authService = new TelegramAuthService(config.allowedTelegramIds);
  const router = new BotRouter(authService, projectService);
  return { config, router, bot: createBot(config.botToken, router) };
}

if (process.argv.includes("--smoke")) {
  buildApplication({ BOT_TOKEN: "0000000000:mock-token-for-smoke", ALLOWED_TELEGRAM_IDS: "12345" });
  console.log("smoke ok");
} else {
  const { bot } = buildApplication(process.env);
  void bot.start();
}
