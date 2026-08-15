import type { BotResponse, PlanOptionId, RewriteMode, SourceAudioInput, TelegramChatId, TelegramUserId } from "../domain/types.js";
import { TelegramAuthService } from "../services/authService.js";
import { ProjectService } from "../services/projectService.js";

export type RouterTextEvent = {
  telegramUserId: TelegramUserId;
  chatId: TelegramChatId;
  text: string;
};

export type RouterAudioEvent = {
  telegramUserId: TelegramUserId;
  chatId: TelegramChatId;
  audio: SourceAudioInput;
};

export type RouterCallbackEvent = {
  telegramUserId: TelegramUserId;
  chatId: TelegramChatId;
  action: string;
};

export class BotRouter {
  constructor(
    private readonly auth: TelegramAuthService,
    private readonly projects: ProjectService
  ) {}

  async handleText(event: RouterTextEvent): Promise<BotResponse[]> {
    if (!this.auth.isAllowed(event.telegramUserId)) return unauthorized();
    if (event.text.trim() === "/start") return this.projects.start(event.telegramUserId, event.chatId);

    const activeProject = await this.projects.getActiveProject(event.telegramUserId);
    if (!activeProject) return [{ kind: "message", text: "Отправьте /start, чтобы начать проект." }];

    if (activeProject.state === "planning") return this.projects.revisePlan(event.telegramUserId, event.text);
    if (activeProject.state === "draft_editing") return this.projects.reviseDraft(event.telegramUserId, event.text);
    if (activeProject.state === "formatted_editing") return this.projects.reviseFormatting(event.telegramUserId, event.text);
    return [{ kind: "message", text: "Текстовая правка сейчас не ожидается. Используйте кнопки текущего шага." }];
  }

  async handleAudio(event: RouterAudioEvent): Promise<BotResponse[]> {
    if (!this.auth.isAllowed(event.telegramUserId)) return unauthorized();
    const activeProject = await this.projects.getActiveProject(event.telegramUserId);
    if (!activeProject) return [{ kind: "message", text: "Отправьте /start перед аудио." }];

    if (activeProject.state === "awaiting_audio") {
      return this.projects.submitSourceAudio(event.telegramUserId, event.audio);
    }

    return this.projects.handleEditAudio(event.telegramUserId, event.audio);
  }

  async handleCallback(event: RouterCallbackEvent): Promise<BotResponse[]> {
    if (!this.auth.isAllowed(event.telegramUserId)) return unauthorized();
    const [group, value] = event.action.split(":");

    if (event.action === "plan:show_alternatives") return this.projects.showPlanAlternatives(event.telegramUserId);
    if (group === "plan" && isPlanOption(value)) return this.projects.choosePlan(event.telegramUserId, value);
    if (group === "rewrite" && isRewriteMode(value)) return this.projects.chooseRewriteMode(event.telegramUserId, value);
    if (event.action === "format:open") return this.projects.openFormatChoice(event.telegramUserId);
    const regenerationVersion = parseRegenerationAction(event.action);
    if (regenerationVersion !== undefined) return this.projects.regenerateDraft(event.telegramUserId, regenerationVersion);
    if (event.action === "format:edit") return this.projects.openFormattedCorrection(event.telegramUserId);
    if (group === "format" && (value === "option_1" || value === "option_2")) return this.projects.formatCurrentPost(event.telegramUserId, value);
    if (event.action === "final:accept") return this.projects.finalizeCurrentPost(event.telegramUserId);
    if (event.action === "series:next") return this.projects.startNextPost(event.telegramUserId);
    return [{ kind: "message", text: "Неизвестное действие. Продолжите текущий шаг или отправьте /start." }];
  }
}

function unauthorized(): BotResponse[] {
  return [{ kind: "message", text: "Этот Telegram ID не разрешён для MVP." }];
}

function isPlanOption(value: string | undefined): value is PlanOptionId {
  return value === "recommended" || value === "alternative_2" || value === "alternative_3" || value === "one_post" || value === "two_posts" || value === "three_posts";
}

function isRewriteMode(value: string | undefined): value is RewriteMode {
  return value === "clean_up" || value === "make_post";
}

function parseRegenerationAction(action: string): number | undefined {
  const match = /^draft:regenerate:(\d+)$/.exec(action);
  if (!match) return undefined;
  const version = Number(match[1]);
  return Number.isSafeInteger(version) && version > 0 ? version : undefined;
}
