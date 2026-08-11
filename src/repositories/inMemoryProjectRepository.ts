import type { Project, ProjectId, TelegramUserId } from "../domain/types.js";
import type { ProjectRepository } from "./projectRepository.js";

export class InMemoryProjectRepository implements ProjectRepository {
  private readonly projects = new Map<ProjectId, Project>();

  async save(project: Project): Promise<Project> {
    project.updatedAt = new Date();
    this.projects.set(project.id, cloneProject(project));
    return cloneProject(project);
  }

  async findActiveByTelegramUser(telegramUserId: TelegramUserId): Promise<Project | undefined> {
    for (const project of this.projects.values()) {
      if (project.telegramUserId === telegramUserId && project.isActive) {
        return cloneProject(project);
      }
    }
    return undefined;
  }

  async deactivateActiveForUser(telegramUserId: TelegramUserId): Promise<void> {
    for (const project of this.projects.values()) {
      if (project.telegramUserId === telegramUserId && project.isActive) {
        project.isActive = false;
        project.updatedAt = new Date();
      }
    }
  }

  async findById(projectId: ProjectId): Promise<Project | undefined> {
    const project = this.projects.get(projectId);
    return project ? cloneProject(project) : undefined;
  }
}

function cloneProject(project: Project): Project {
  return {
    ...project,
    createdAt: new Date(project.createdAt),
    updatedAt: new Date(project.updatedAt),
    planOptions: project.planOptions?.map(clonePlanOption),
    selectedPlan: project.selectedPlan ? clonePlanOption(project.selectedPlan) : undefined,
    posts: project.posts.map((post) => ({ ...post, planSlice: clonePlanSlice(post.planSlice) })),
    messages: project.messages.map((message) => ({ ...message, createdAt: new Date(message.createdAt) }))
  };
}

function clonePlanOption<T extends { posts: Array<Parameters<typeof clonePlanSlice>[0]> }>(option: T): T {
  return { ...option, posts: option.posts.map(clonePlanSlice) } as T;
}

function clonePlanSlice<T extends { includes: string[]; excludes?: string[] }>(slice: T): T {
  return { ...slice, includes: [...slice.includes], excludes: slice.excludes ? [...slice.excludes] : undefined };
}
