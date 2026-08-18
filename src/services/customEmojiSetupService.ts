import { customEmojiRoles, isValidCustomEmojiRoleAlt, type CustomEmojiMapping, type CustomEmojiRole } from "../domain/customEmoji.js";
import type { CustomEmojiRepository } from "../repositories/customEmojiRepository.js";

export type IncomingTelegramEntity = {
  type: string;
  offset: number;
  length: number;
  custom_emoji_id?: string;
};

export type ResolvedCustomEmojiSticker = {
  type: string;
  custom_emoji_id?: string;
  emoji?: string;
  set_name?: string;
};

type SetupFailure = { ok: false; code: string; message: string };
type SetupResult = SetupFailure | { ok: true; code: string; message: string };
type ResolveStickers = (ids: string[]) => Promise<ResolvedCustomEmojiSticker[]>;
type SetupLogger = {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
};

export class CustomEmojiSetupService {
  constructor(private readonly input: { ownerTelegramId?: string; repository: CustomEmojiRepository; logger?: SetupLogger }) {}

  async configure(
    message: { telegramUserId: string; text: string; entities: IncomingTelegramEntity[] },
    resolveStickers: ResolveStickers
  ): Promise<SetupResult> {
    const evidence = {
      entityCount: message.entities.length,
      commandEntityCount: message.entities.filter((entity) => entity.type === "bot_command").length,
      customEmojiEntityCount: message.entities.filter((entity) => entity.type === "custom_emoji").length,
      ownerBoundaryConfigured: Boolean(this.input.ownerTelegramId),
      ownerMatched: Boolean(this.input.ownerTelegramId && message.telegramUserId === this.input.ownerTelegramId)
    };
    this.input.logger?.info({ event: "emoji_setup_received", ...evidence }, "Custom emoji setup command received");
    if (!this.input.ownerTelegramId || message.telegramUserId !== this.input.ownerTelegramId) {
      return this.record(failure("EMOJI_SETUP_FORBIDDEN", "Команда настройки эмодзи доступна только владельцу бота."), evidence);
    }
    const parsed = parseEntities(message.text, message.entities);
    if (!parsed.ok) return this.record(parsed, evidence);

    let stickers: ResolvedCustomEmojiSticker[];
    try {
      stickers = await resolveStickers(parsed.items.map((item) => item.customEmojiId));
    } catch {
      return this.record(failure("EMOJI_SETUP_RESOLUTION_FAILED", "Не удалось проверить эмодзи. Повторите одну команду позже."), evidence);
    }
    if (stickers.length !== customEmojiRoles.length || new Set(stickers.map((sticker) => sticker.custom_emoji_id)).size !== customEmojiRoles.length) {
      return this.record(failure("EMOJI_SETUP_RESOLUTION_INCOMPLETE", "Telegram должен подтвердить ровно шесть разных custom emoji."), evidence);
    }
    const byId = new Map(stickers.map((sticker) => [sticker.custom_emoji_id, sticker]));
    const mappings: CustomEmojiMapping[] = [];
    for (let index = 0; index < customEmojiRoles.length; index += 1) {
      const role = customEmojiRoles[index]!;
      const item = parsed.items[index]!;
      const sticker = byId.get(item.customEmojiId);
      if (!sticker || sticker.type !== "custom_emoji" || sticker.custom_emoji_id !== item.customEmojiId || !sticker.set_name || !sticker.emoji) {
        return this.record(failure("EMOJI_SETUP_STICKER_INVALID", `Эмодзи для роли ${roleLabel(role)} не удалось подтвердить как Telegram custom emoji.`), evidence);
      }
      if (sticker.emoji !== item.alt) {
        return this.record(failure("EMOJI_SETUP_ENTITY_ALT_MISMATCH", `Эмодзи для роли ${roleLabel(role)} должно оборачивать свой фактический символ.`), evidence);
      }
      if (!isValidCustomEmojiRoleAlt(role, item.alt)) {
        return this.record(failure("EMOJI_SETUP_ALT_INVALID", `Неверный символ для роли ${roleLabel(role)}. Пришлите шесть эмодзи в указанном порядке.`), evidence);
      }
      mappings.push({ role, customEmojiId: item.customEmojiId, alt: item.alt, setName: sticker.set_name });
    }
    if (new Set(mappings.map((item) => item.customEmojiId)).size !== mappings.length) {
      return this.record(failure("EMOJI_SETUP_DUPLICATE_ENTITY", "Каждая из шести ролей должна содержать отдельный custom emoji."), evidence);
    }
    try {
      await this.input.repository.replaceAll(mappings);
    } catch {
      return this.record(failure("EMOJI_SETUP_PERSISTENCE_FAILED", "Не удалось сохранить полный набор эмодзи; прежняя настройка не изменена."), evidence);
    }
    return this.record({
      ok: true,
      code: "EMOJI_SETUP_SAVED",
      message: ["Custom emoji настроены:", ...mappings.map((item) => `${roleLabel(item.role)}: ${item.alt} — готово`)].join("\n")
    }, evidence);
  }

  private record(result: SetupResult, evidence: Record<string, unknown>): SetupResult {
    const fields = { event: "emoji_setup_completed", outcomeCode: result.code, success: result.ok, ...evidence };
    if (result.ok) this.input.logger?.info(fields, "Custom emoji setup completed");
    else this.input.logger?.warn(fields, "Custom emoji setup rejected");
    return result;
  }
}

type ParsedItem = { customEmojiId: string; alt: string };

function parseEntities(text: string, entities: IncomingTelegramEntity[]): { ok: true; items: ParsedItem[] } | SetupFailure {
  const commandEntities = entities.filter((entity) => entity.type === "bot_command");
  const customEntities = entities
    .filter((entity) => entity.type === "custom_emoji")
    .sort((left, right) => left.offset - right.offset);
  if (customEntities.length !== customEmojiRoles.length) {
    return failure("EMOJI_SETUP_ENTITY_COUNT_INVALID", "Нужно отправить ровно шесть actual custom emoji после /emoji_setup.");
  }
  if (commandEntities.length !== 1 || commandEntities[0]!.offset !== 0 || text.slice(0, commandEntities[0]!.length).split("@")[0] !== "/emoji_setup") {
    return failure("EMOJI_SETUP_COMMAND_INVALID", "Используйте одну команду /emoji_setup и шесть custom emoji после неё.");
  }
  if (entities.some((entity) => entity.type !== "bot_command" && entity.type !== "custom_emoji")) {
    return failure("EMOJI_SETUP_ENTITIES_AMBIGUOUS", "В сообщении допустимы только команда и шесть custom emoji без дополнительной разметки.");
  }
  const occupied = new Array<boolean>(text.length).fill(false);
  for (const entity of entities) {
    if (!Number.isSafeInteger(entity.offset) || !Number.isSafeInteger(entity.length) || entity.offset < 0 || entity.length <= 0 || entity.offset + entity.length > text.length) {
      return failure("EMOJI_SETUP_ENTITY_RANGE_INVALID", "Telegram entity имеет некорректную границу; отправьте команду заново.");
    }
    for (let index = entity.offset; index < entity.offset + entity.length; index += 1) {
      if (occupied[index]) return failure("EMOJI_SETUP_ENTITIES_AMBIGUOUS", "Telegram entities перекрываются; отправьте команду заново.");
      occupied[index] = true;
    }
  }
  for (let index = 0; index < text.length; index += 1) {
    if (!occupied[index] && !/\s/u.test(text[index]!)) {
      return failure("EMOJI_SETUP_ENTITIES_AMBIGUOUS", "После команды допустимы только пробелы и шесть custom emoji.");
    }
  }
  let previousOffset = -1;
  const items: ParsedItem[] = [];
  for (const entity of customEntities) {
    if (entity.offset <= previousOffset || !entity.custom_emoji_id) {
      return failure("EMOJI_SETUP_ENTITY_ORDER_INVALID", "Custom emoji должны идти в сообщении ровно в порядке шести ролей.");
    }
    previousOffset = entity.offset;
    items.push({ customEmojiId: entity.custom_emoji_id, alt: text.slice(entity.offset, entity.offset + entity.length) });
  }
  return { ok: true, items };
}

function failure(code: string, message: string): SetupFailure {
  return { ok: false, code, message };
}

function roleLabel(role: CustomEmojiRole): string {
  return ({ post_title: "заголовок поста", section_title: "заголовок секции", list_item: "пункт списка", copy_block: "копируемый блок", cta: "CTA", audience_question: "вопрос аудитории" })[role];
}
