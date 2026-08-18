import { Bot, InlineKeyboard, InputFile } from "grammy";
import type { BotResponse, SourceAudioInput } from "../domain/types.js";
import type { CustomEmojiSetupService, IncomingTelegramEntity } from "../services/customEmojiSetupService.js";
import type { BotRouter } from "./router.js";

type BotLogger = {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
};

export function createBot(token: string, router: BotRouter, emojiSetup?: CustomEmojiSetupService, logger?: BotLogger): Bot {
  const bot = new Bot(token);

  bot.command("start", async (ctx) => {
    await sendResponses(ctx, await router.handleText({ telegramUserId: telegramUserId(ctx), chatId: chatId(ctx), text: "/start" }));
  });

  bot.command("emoji_setup", async (ctx) => {
    let replyText: string;
    try {
      if (!emojiSetup) {
        replyText = "Настройка custom emoji отключена: владелец не настроен.";
      } else {
        const message = ctx.message;
        if (!message?.text) {
          replyText = "Используйте одну текстовую команду /emoji_setup и шесть custom emoji после неё.";
        } else {
          const result = await emojiSetup.configure(
            {
              telegramUserId: telegramUserId(ctx),
              text: message.text,
              entities: (message.entities ?? []).map((entity) => ({
                type: entity.type,
                offset: entity.offset,
                length: entity.length,
                custom_emoji_id: entity.type === "custom_emoji" ? entity.custom_emoji_id : undefined
              } satisfies IncomingTelegramEntity))
            },
            async (ids) => ctx.api.getCustomEmojiStickers(ids)
          );
          replyText = result.message;
        }
      }
    } catch (error) {
      logger?.warn(
        { event: "emoji_setup_handler_failed", errorCode: error instanceof Error ? error.name : "unknown" },
        "Custom emoji setup handler failed"
      );
      replyText = "Настройку custom emoji не удалось завершить. Набор не изменён; повторите одну команду позже.";
    }
    try {
      await ctx.reply(replyText);
      logger?.info({ event: "emoji_setup_reply_sent" }, "Custom emoji setup reply sent");
    } catch (error) {
      logger?.warn(
        { event: "emoji_setup_reply_failed", errorCode: error instanceof Error ? error.name : "unknown" },
        "Custom emoji setup reply failed"
      );
      throw error;
    }
  });

  bot.on("callback_query:data", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendResponses(ctx, await router.handleCallback({ telegramUserId: telegramUserId(ctx), chatId: chatId(ctx), action: ctx.callbackQuery.data }));
  });

  bot.on("message", async (ctx) => {
    const audio = sourceAudioFromMessage(ctx.message);
    if (audio) {
      await sendResponses(ctx, await router.handleAudio({ telegramUserId: telegramUserId(ctx), chatId: chatId(ctx), audio }));
      return;
    }

    if (ctx.message.text) {
      await sendResponses(ctx, await router.handleText({ telegramUserId: telegramUserId(ctx), chatId: chatId(ctx), text: ctx.message.text }));
      return;
    }

    await ctx.reply("Пришлите текст, voice, audio или audio-файл.");
  });

  return bot;
}

function sourceAudioFromMessage(message: {
  voice?: { file_id: string; duration?: number; file_size?: number };
  audio?: { file_id: string; file_name?: string; mime_type?: string; duration?: number; file_size?: number };
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
}): SourceAudioInput | undefined {
  if (message.voice) return { kind: "voice", telegramFileId: message.voice.file_id, durationSeconds: message.voice.duration, sizeBytes: message.voice.file_size };
  if (message.audio) {
    return {
      kind: "audio",
      telegramFileId: message.audio.file_id,
      fileName: message.audio.file_name,
      mimeType: message.audio.mime_type,
      durationSeconds: message.audio.duration,
      sizeBytes: message.audio.file_size
    };
  }
  if (message.document?.mime_type?.startsWith("audio/")) {
    return {
      kind: "audio_document",
      telegramFileId: message.document.file_id,
      fileName: message.document.file_name,
      mimeType: message.document.mime_type,
      sizeBytes: message.document.file_size
    };
  }
  return undefined;
}

async function sendResponses(ctx: { reply(text: string, options?: object): Promise<unknown>; replyWithDocument(file: InputFile, options?: object): Promise<unknown> }, responses: BotResponse[]) {
  for (const response of responses) {
    if (response.kind === "message") {
      await ctx.reply(response.text, response.buttons ? { reply_markup: keyboard(response.buttons) } : undefined);
    } else {
      await ctx.replyWithDocument(new InputFile(Buffer.from(response.content), response.filename), { caption: response.caption });
    }
  }
}

function keyboard(buttons: Array<{ label: string; action: string }>): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const button of buttons) keyboard.text(button.label, button.action).row();
  return keyboard;
}

function telegramUserId(ctx: { from?: { id: number } }): string {
  if (!ctx.from) throw new Error("Telegram update has no user id.");
  return String(ctx.from.id);
}

function chatId(ctx: { chat?: { id: number } }): string {
  if (!ctx.chat) throw new Error("Telegram update has no chat id.");
  return String(ctx.chat.id);
}
