import type { TelegramChatId } from "../domain/types.js";
import { noopLogger, type Logger } from "../observability/logger.js";
import type { CustomEmojiRepository } from "../repositories/customEmojiRepository.js";
import { renderCryptusTelegramText } from "./cryptusTelegramRenderer.js";

export const telegramSendMessageMaxChars = 4096;

export type TelegramSendMessageOptions = {
  parse_mode?: "MarkdownV2" | "HTML";
  entities?: TelegramMessageEntity[];
  disable_web_page_preview?: boolean;
  reply_parameters?: { message_id: number };
  reply_markup?: {
    inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
  };
};

type TelegramTextStyleEntity = {
  type: "bold" | "code";
  offset: number;
  length: number;
};

type TelegramCustomEmojiEntity = {
  type: "custom_emoji";
  offset: number;
  length: number;
  custom_emoji_id: string;
};

export type TelegramMessageEntity = TelegramTextStyleEntity | TelegramCustomEmojiEntity;

export type TelegramEntitySendOptions = Omit<TelegramSendMessageOptions, "parse_mode" | "entities">;

export type TelegramNotifier = {
  sendMessage(chatId: TelegramChatId, text: string, options?: TelegramSendMessageOptions): Promise<void>;
  sendCryptusOption2?(chatId: TelegramChatId, canonicalText: string, options?: TelegramEntitySendOptions): Promise<void>;
};

export type TelegramApiSender = {
  sendMessage(chatId: string | number, text: string, options?: TelegramSendMessageOptions): Promise<unknown>;
};

export class GrammyTelegramNotifier implements TelegramNotifier {
  constructor(
    private readonly api: TelegramApiSender,
    private readonly logger: Logger = noopLogger,
    private readonly customEmojiRepository?: CustomEmojiRepository
  ) {}

  async sendMessage(chatId: TelegramChatId, text: string, options?: TelegramSendMessageOptions): Promise<void> {
    validateSendMessageText(text);
    if (options?.parse_mode && options.entities) throw new Error("TELEGRAM_PARSE_MODE_ENTITIES_CONFLICT");
    try {
      await this.api.sendMessage(chatId, text, options);
      this.logger.info({ event: "telegram_notification_sent", chatId }, "telegram notification sent");
    } catch (error) {
      this.logger.warn({ event: "telegram_notification_failed", chatId, errorCode: safeErrorCode(error) }, "telegram notification failed");
      throw error;
    }
  }

  async sendCryptusOption2(chatId: TelegramChatId, canonicalText: string, options?: TelegramEntitySendOptions): Promise<void> {
    const configuration = await this.loadConfigurationFailClosed();
    const custom = renderCryptusTelegramText(canonicalText, configuration);
    validateSendMessageText(custom.text);
    try {
      const response = await this.api.sendMessage(chatId, custom.text, { ...options, entities: custom.entities });
      this.auditCustomEntities(response, custom.entities);
      return;
    } catch (error) {
      if (!custom.usedCustomEmoji || !isDefiniteCustomEntityRejection(error)) {
        this.logger.warn(
          { event: "telegram_custom_emoji_delivery_failed", deliveryCategory: isAmbiguousTransportFailure(error) ? "ambiguous_transport" : "definite_non_custom_error" },
          "Telegram custom emoji delivery failed without automatic resend"
        );
        throw error;
      }
      const fallback = renderCryptusTelegramText(canonicalText);
      validateSendMessageText(fallback.text);
      const response = await this.api.sendMessage(chatId, fallback.text, { ...options, entities: fallback.entities });
      this.logger.warn(
        { event: "telegram_custom_emoji_fallback_sent", deliveryCategory: "definite_custom_entity_rejection" },
        "Telegram base-entity fallback sent once"
      );
      this.auditCustomEntities(response, []);
    }
  }

  private async loadConfigurationFailClosed() {
    if (!this.customEmojiRepository) return undefined;
    try {
      return await this.customEmojiRepository.get();
    } catch {
      this.logger.warn({ event: "telegram_custom_emoji_mapping_unavailable" }, "Custom emoji mapping unavailable; using base entities");
      return undefined;
    }
  }

  private auditCustomEntities(response: unknown, requested: TelegramMessageEntity[]): void {
    const requestedCustomCount = requested.filter((entity) => entity.type === "custom_emoji").length;
    const returnedCustomCount = returnedEntities(response).filter((entity) => entity.type === "custom_emoji").length;
    this.logger.info(
      { event: "telegram_custom_emoji_audit", requestedCustomCount, returnedCustomCount, renderingConfirmed: requestedCustomCount === returnedCustomCount },
      "Telegram custom emoji response audited"
    );
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

function isDefiniteCustomEntityRejection(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const code = record.error_code;
  const description = typeof record.description === "string" ? record.description.toLowerCase() : "";
  return code === 400 && (description.includes("custom emoji") || description.includes("entity"));
}

function isAmbiguousTransportFailure(error: unknown): boolean {
  return error instanceof Error && (error.name === "HttpError" || error.name === "AbortError" || /timeout/i.test(error.message));
}

function returnedEntities(response: unknown): Array<{ type?: unknown }> {
  if (!response || typeof response !== "object") return [];
  const entities = (response as Record<string, unknown>).entities;
  return Array.isArray(entities) ? entities.filter((item): item is { type?: unknown } => Boolean(item && typeof item === "object")) : [];
}
