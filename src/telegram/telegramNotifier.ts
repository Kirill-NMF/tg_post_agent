import type { TelegramChatId } from "../domain/types.js";
import { noopLogger, type Logger } from "../observability/logger.js";

export const telegramSendMessageMaxChars = 4096;

export type TelegramSendMessageOptions = {
  parse_mode?: "MarkdownV2" | "HTML";
  disable_web_page_preview?: boolean;
  reply_markup?: {
    inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
  };
};

export type TelegramNotifier = {
  sendMessage(chatId: TelegramChatId, text: string, options?: TelegramSendMessageOptions): Promise<void>;
};

export type TelegramApiSender = {
  sendMessage(chatId: string | number, text: string, options?: TelegramSendMessageOptions): Promise<unknown>;
};

export class GrammyTelegramNotifier implements TelegramNotifier {
  constructor(
    private readonly api: TelegramApiSender,
    private readonly logger: Logger = noopLogger
  ) {}

  async sendMessage(chatId: TelegramChatId, text: string, options?: TelegramSendMessageOptions): Promise<void> {
    validateSendMessageText(text);
    try {
      await this.api.sendMessage(chatId, text, options);
      this.logger.info({ event: "telegram_notification_sent", chatId }, "telegram notification sent");
    } catch (error) {
      this.logger.warn({ event: "telegram_notification_failed", chatId, errorCode: safeErrorCode(error) }, "telegram notification failed");
      throw error;
    }
  }
}

export function validateSendMessageText(text: string): void {
  if (text.length < 1 || text.length > telegramSendMessageMaxChars) {
    throw new Error(`Telegram sendMessage text must be between 1 and ${telegramSendMessageMaxChars} characters.`);
  }
}

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && error.name) return error.name.slice(0, 80);
  return "TELEGRAM_SEND_FAILED";
}
