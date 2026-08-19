import type { Project, ProjectId, TelegramUserId } from "../domain/types.js";
import type { ProjectRepository } from "./projectRepository.js";

export class InMemoryProjectRepository implements ProjectRepository {
  private readonly projects = new Map<ProjectId, Project>();
  private readonly callbacks = new Set<string>();

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

  async deactivateActiveForUser(telegramUserId: TelegramUserId, options?: { preserveState?: boolean }): Promise<void> {
    for (const project of this.projects.values()) {
      if (project.telegramUserId === telegramUserId && project.isActive) {
        project.isActive = false;
        if (!options?.preserveState) project.state = "cancelled";
        project.updatedAt = new Date();
      }
    }
  }

  async activateProjectForUser(projectId: ProjectId, telegramUserId: TelegramUserId): Promise<void> {
    const target = this.projects.get(projectId);
    if (!target || target.telegramUserId !== telegramUserId) throw new Error("PROJECT_ACTIVATION_SCOPE_INVALID");
    for (const project of this.projects.values()) {
      if (project.telegramUserId === telegramUserId) project.isActive = project.id === projectId;
    }
    target.updatedAt = new Date();
  }

  async findById(projectId: ProjectId): Promise<Project | undefined> {
    const project = this.projects.get(projectId);
    return project ? cloneProject(project) : undefined;
  }

  async findAllByTelegramUser(telegramUserId: TelegramUserId): Promise<Project[]> {
    return [...this.projects.values()].filter((project) => project.telegramUserId === telegramUserId).map(cloneProject);
  }

  async findByBranchCallbackQueryId(callbackQueryId: string): Promise<Project | undefined> {
    const project = [...this.projects.values()].find((candidate) => candidate.branchCallbackQueryId === callbackQueryId);
    return project ? cloneProject(project) : undefined;
  }

  async claimCallback(input: { callbackQueryId: string }): Promise<boolean> {
    if (this.callbacks.has(input.callbackQueryId)) return false;
    this.callbacks.add(input.callbackQueryId);
    return true;
  }

  async releaseCallback(callbackQueryId: string): Promise<void> { this.callbacks.delete(callbackQueryId); }
}

function cloneProject(project: Project): Project {
  return {
    ...project,
    createdAt: new Date(project.createdAt),
    updatedAt: new Date(project.updatedAt),
    planOptions: project.planOptions?.map(clonePlanOption),
    planRecommendation: project.planRecommendation ? { ...project.planRecommendation } : undefined,
    selectedPlan: project.selectedPlan ? clonePlanOption(project.selectedPlan) : undefined,
    posts: project.posts.map((post) => ({ ...post, planSlice: clonePlanSlice(post.planSlice) })),
    messages: project.messages.map((message) => ({ ...message, createdAt: new Date(message.createdAt) }))
    ,sourceAudioParts: project.sourceAudioParts?.map((part) => ({ ...part, source: { ...part.source } }))
  };
}

function clonePlanOption<T extends { posts: Array<Parameters<typeof clonePlanSlice>[0]> }>(option: T): T {
  return { ...option, posts: option.posts.map(clonePlanSlice) } as T;
}

function clonePlanSlice<T extends { includes: string[]; excludes?: string[] }>(slice: T): T {
  return { ...slice, includes: [...slice.includes], excludes: slice.excludes ? [...slice.excludes] : undefined };
}
