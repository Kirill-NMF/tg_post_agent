import { pathToFileURL } from "node:url";
import { MockModelAdapters } from "./adapters/mockModelAdapters.js";
import { createBot } from "./bot/createBot.js";
import { BotRouter } from "./bot/router.js";
import { loadConfig } from "./config/env.js";
import { createDb, createDbPool } from "./db/connection.js";
import { consoleLogger } from "./observability/logger.js";
import { PgJobRepository } from "./repositories/pgJobRepository.js";
import { InMemoryProjectRepository } from "./repositories/inMemoryProjectRepository.js";
import { PgProjectRepository } from "./repositories/pgProjectRepository.js";
import type { ProjectRepository } from "./repositories/projectRepository.js";
import { TelegramAuthService } from "./services/authService.js";
import { createAudioPipelineHandlers } from "./services/audioPipelineFactory.js";
import { JobWorker } from "./services/jobWorker.js";
import { ProjectService } from "./services/projectService.js";
import { WorkerRuntime } from "./services/workerRuntime.js";
import { GrammyTelegramNotifier } from "./telegram/telegramNotifier.js";

export function buildApplication(env: NodeJS.ProcessEnv) {
  const config = loadConfig(env);
  const db = config.databaseUrl ? createDb(createDbPool({ databaseUrl: config.databaseUrl })) : undefined;
  const repository = db ? new PgProjectRepository(db) : new InMemoryProjectRepository();
  const jobRepository = db ? new PgJobRepository(db) : undefined;
  const modelAdapters = new MockModelAdapters();
  const projectService = new ProjectService(repository, modelAdapters, jobRepository);
  const authService = new TelegramAuthService(config.allowedTelegramIds);
  const router = new BotRouter(authService, projectService);
  const bot = createBot(config.botToken, router);
  const workerRuntime = config.jobWorkerEnabled ? createWorkerRuntime({ config, repository, jobRepository, bot }) : undefined;
  return { config, router, bot, workerRuntime };
}

export function startApplication(env: NodeJS.ProcessEnv) {
  const app = buildApplication(env);
  app.workerRuntime?.start();
  void app.bot.start();
  return app;
}

if (isMainModule()) {
  if (process.argv.includes("--smoke")) {
    buildApplication({ BOT_TOKEN: "0000000000:mock-token-for-smoke", ALLOWED_TELEGRAM_IDS: "12345" });
    console.log("smoke ok");
  } else {
    startApplication(process.env);
  }
}

function createWorkerRuntime(input: {
  config: ReturnType<typeof loadConfig>;
  repository: ProjectRepository;
  jobRepository: PgJobRepository | undefined;
  bot: ReturnType<typeof createBot>;
}): WorkerRuntime {
  if (!input.jobRepository) {
    throw new Error("DATABASE_URL is required when JOB_WORKER_ENABLED=true.");
  }
  if (!input.config.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is required when JOB_WORKER_ENABLED=true.");
  }

  const notifier = new GrammyTelegramNotifier(input.bot.api, consoleLogger);
  const handlers = createAudioPipelineHandlers({
    config: input.config,
    projects: input.repository,
    notifier,
    logger: consoleLogger
  });
  const worker = new JobWorker(input.jobRepository, handlers, consoleLogger);
  return new WorkerRuntime({
    worker,
    jobs: input.jobRepository,
    config: {
      enabled: input.config.jobWorkerEnabled,
      intervalMs: input.config.jobWorkerIntervalMs,
      staleMs: input.config.jobWorkerStaleMs,
      workerId: input.config.jobWorkerId
    },
    logger: consoleLogger
  });
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && import.meta.url === pathToFileURL(entry).href);
}
