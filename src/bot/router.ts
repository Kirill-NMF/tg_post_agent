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
    if (event.action === "format:open" || group === "format" || event.action === "final:accept") {
      return [{ kind: "message", text: "\u041e\u0444\u043e\u0440\u043c\u043b\u0435\u043d\u0438\u0435 \u043f\u043e\u044f\u0432\u0438\u0442\u0441\u044f \u043f\u043e\u0441\u043b\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u0438\u044f \u043e\u0442\u0434\u0435\u043b\u044c\u043d\u043e\u0433\u043e \u044d\u0442\u0430\u043f\u0430 Stage 3." }];
    }
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
