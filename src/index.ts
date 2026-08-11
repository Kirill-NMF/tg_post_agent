import { MockModelAdapters } from "./adapters/mockModelAdapters.js";
import { createBot } from "./bot/createBot.js";
import { BotRouter } from "./bot/router.js";
import { loadConfig } from "./config/env.js";
import { InMemoryProjectRepository } from "./repositories/inMemoryProjectRepository.js";
import { TelegramAuthService } from "./services/authService.js";
import { ProjectService } from "./services/projectService.js";

export function buildApplication(env: NodeJS.ProcessEnv) {
  const config = loadConfig(env);
  const repository = new InMemoryProjectRepository();
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
