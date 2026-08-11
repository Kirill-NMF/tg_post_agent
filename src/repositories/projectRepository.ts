import type { Project, ProjectId, TelegramUserId } from "../domain/types.js";

export type ProjectRepository = {
  save(project: Project): Promise<Project>;
  findActiveByTelegramUser(telegramUserId: TelegramUserId): Promise<Project | undefined>;
  deactivateActiveForUser(telegramUserId: TelegramUserId): Promise<void>;
  findById(projectId: ProjectId): Promise<Project | undefined>;
};
