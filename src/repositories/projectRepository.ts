import type { Project, ProjectId, TelegramUserId } from "../domain/types.js";

export type ProjectRepository = {
  save(project: Project): Promise<Project>;
  findActiveByTelegramUser(telegramUserId: TelegramUserId): Promise<Project | undefined>;
  deactivateActiveForUser(telegramUserId: TelegramUserId, options?: { preserveState?: boolean }): Promise<void>;
  activateProjectForUser(projectId: ProjectId, telegramUserId: TelegramUserId): Promise<void>;
  findById(projectId: ProjectId): Promise<Project | undefined>;
  findAllByTelegramUser(telegramUserId: TelegramUserId): Promise<Project[]>;
  findByBranchCallbackQueryId(callbackQueryId: string): Promise<Project | undefined>;
  claimCallback(input: { callbackQueryId: string; telegramUserId: TelegramUserId; chatId: string }): Promise<boolean>;
  releaseCallback(callbackQueryId: string): Promise<void>;
};
