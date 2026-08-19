import type { BotResponse, PlanOptionId, RewriteMode, SourceAudioInput, TelegramChatId, TelegramUserId } from "../domain/types.js";
import { TelegramAuthService } from "../services/authService.js";
import { ProjectService } from "../services/projectService.js";
import { parseSourceProcessAction } from "../services/artifactCallback.js";

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
  callbackQueryId?: string;
  callbackMessageId?: string;
  callbackMessageText?: string;
  replyToMessageText?: string;
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

    if (activeProject.state === "awaiting_audio" || (activeProject.state === "transcribing" && activeProject.sourcePoolSealed)) {
      return this.projects.submitSourceAudio(event.telegramUserId, event.audio);
    }

    return this.projects.handleEditAudio(event.telegramUserId, event.audio);
  }

  async handleCallback(event: RouterCallbackEvent): Promise<BotResponse[]> {
    if (!this.auth.isAllowed(event.telegramUserId)) return unauthorized();
    const sourceProjectId = parseSourceProcessAction(event.action);
    if (sourceProjectId && event.callbackQueryId && event.callbackMessageId) {
      return this.projects.startSourceProcessing({ telegramUserId: event.telegramUserId, chatId: event.chatId, projectId: sourceProjectId, callbackQueryId: event.callbackQueryId, callbackMessageId: event.callbackMessageId });
    }
    if (event.callbackQueryId && event.callbackMessageId) {
      const historical = await this.projects.handleHistoricalCallback({
        telegramUserId: event.telegramUserId, chatId: event.chatId, action: event.action,
        callbackQueryId: event.callbackQueryId, callbackMessageId: event.callbackMessageId,
        callbackMessageText: event.callbackMessageText, replyToMessageText: event.replyToMessageText
      });
      if (historical) return historical;
    }
    const [group, value] = event.action.split(":");

    if (event.action === "plan:show_alternatives") return this.projects.showPlanAlternatives(event.telegramUserId);
    if (group === "plan" && isPlanOption(value)) return this.projects.choosePlan(event.telegramUserId, value);
    if (group === "rewrite" && isRewriteMode(value)) return this.projects.chooseRewriteMode(event.telegramUserId, value);
    if (event.action === "format:open") return this.projects.openFormatChoice(event.telegramUserId);
    const rerun = parseRerunAction(event.action);
    if (rerun) return this.projects.rerunDraft(event.telegramUserId, rerun.rewriteMode, rerun.sourceDraftVersion);
    if (event.action === "format:edit") return this.projects.openFormattedCorrection(event.telegramUserId);
    if (group === "format" && (value === "option_1" || value === "option_2")) return this.projects.formatCurrentPost(event.telegramUserId, value);
    if (event.action === "final:accept") return this.projects.finalizeCurrentPost(event.telegramUserId);
    if (event.action === "series:next") return this.projects.startNextPost(event.telegramUserId);
    return [{ kind: "message", text: "Неизвестное действие. Продолжите текущий шаг или отправьте /start." }];
  }

  async recordSourceCollectorMessage(telegramUserId: TelegramUserId, chatId: TelegramChatId, projectId: string, telegramMessageId: string): Promise<void> {
    if (!this.auth.isAllowed(telegramUserId)) return;
    await this.projects.recordSourceCollectorMessage(telegramUserId, chatId, projectId, telegramMessageId);
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

function parseRerunAction(action: string): { rewriteMode: RewriteMode; sourceDraftVersion: number } | undefined {
  const match = /^draft:rerun:(clean_up|make_post):(\d+)$/.exec(action);
  if (!match) return undefined;
  const sourceDraftVersion = Number(match[2]);
  return Number.isSafeInteger(sourceDraftVersion) && sourceDraftVersion > 0 ? { rewriteMode: match[1] as RewriteMode, sourceDraftVersion } : undefined;
}
