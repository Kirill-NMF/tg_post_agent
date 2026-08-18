import { customEmojiRoles, validateCompleteCustomEmojiMappings, type CustomEmojiConfiguration, type CustomEmojiRole } from "../domain/customEmoji.js";
import type { TelegramMessageEntity } from "./telegramNotifier.js";

export type CryptusTelegramRender = {
  text: string;
  entities: TelegramMessageEntity[];
  usedCustomEmoji: boolean;
};

const canonicalMarkers: Record<CustomEmojiRole, readonly string[]> = {
  post_title: ["📜"],
  section_title: ["⏸️", "⏸"],
  list_item: ["🟠"],
  copy_block: ["🔅"],
  cta: ["🔥"],
  audience_question: ["➡️", "➡"]
};

export function renderCryptusTelegramText(canonical: string, configuration?: CustomEmojiConfiguration): CryptusTelegramRender {
  const mappings = configuration ? validateCompleteCustomEmojiMappings(configuration.mappings) : undefined;
  const mappingByRole = new Map(mappings?.map((item) => [item.role, item]));
  const entities: TelegramMessageEntity[] = [];
  let text = "";
  const lines = canonical.split("\n");

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (lineIndex > 0) text += "\n";
    const baseOffset = text.length;
    const parsed = parseStrictLine(lines[lineIndex]!, baseOffset);
    text += parsed.text;
    entities.push(...parsed.entities);
    entities.push(...customEmojiEntities(parsed.text, parsed.entities, baseOffset, mappingByRole));
  }

  assertEntityRanges(text, entities);
  return { text, entities, usedCustomEmoji: entities.some((entity) => entity.type === "custom_emoji") };
}

function customEmojiEntities(
  text: string,
  parsedEntities: TelegramMessageEntity[],
  baseOffset: number,
  mappingByRole: ReadonlyMap<CustomEmojiRole, { customEmojiId: string }>
): TelegramMessageEntity[] {
  const markers = customEmojiRoles.flatMap((role) => canonicalMarkers[role].map((marker) => ({ role, marker })))
    .sort((left, right) => right.marker.length - left.marker.length);
  const entities: TelegramMessageEntity[] = [];
  for (let index = 0; index < text.length;) {
    const match = markers.find(({ marker }) => text.startsWith(marker, index));
    if (!match) {
      index += 1;
      continue;
    }
    const mapping = mappingByRole.get(match.role);
    const offset = baseOffset + index;
    const insideCode = parsedEntities.some((entity) => entity.type === "code" && offset >= entity.offset && offset < entity.offset + entity.length);
    if (mapping && !insideCode) {
      entities.push({ type: "custom_emoji", offset, length: match.marker.length, custom_emoji_id: mapping.customEmojiId });
    }
    index += match.marker.length;
  }
  return entities;
}

function parseStrictLine(line: string, baseOffset: number): { text: string; entities: TelegramMessageEntity[] } {
  let output = "";
  let active: "bold" | "code" | undefined;
  let activeOffset = 0;
  const entities: TelegramMessageEntity[] = [];
  for (let index = 0; index < line.length;) {
    if (line.startsWith("**", index)) {
      if (active === "code") invalidMarkup();
      if (active === "bold") {
        if (output.length === activeOffset) invalidMarkup();
        entities.push({ type: "bold", offset: baseOffset + activeOffset, length: output.length - activeOffset });
        active = undefined;
      } else {
        active = "bold";
        activeOffset = output.length;
      }
      index += 2;
      continue;
    }
    if (line[index] === "`") {
      if (active === "bold") invalidMarkup();
      if (active === "code") {
        if (output.length === activeOffset) invalidMarkup();
        entities.push({ type: "code", offset: baseOffset + activeOffset, length: output.length - activeOffset });
        active = undefined;
      } else {
        active = "code";
        activeOffset = output.length;
      }
      index += 1;
      continue;
    }
    if (line[index] === "*") invalidMarkup();
    output += line[index]!;
    index += 1;
  }
  if (active) invalidMarkup();
  return { text: output, entities };
}

function assertEntityRanges(text: string, entities: TelegramMessageEntity[]): void {
  const customRanges = new Set<string>();
  for (const entity of entities) {
    if (entity.offset < 0 || entity.length <= 0 || entity.offset + entity.length > text.length) invalidMarkup();
    if (entity.type === "custom_emoji") {
      const key = `${entity.offset}:${entity.length}`;
      if (customRanges.has(key)) invalidMarkup();
      customRanges.add(key);
      if (entities.some((other) => other.type === "code" && overlaps(entity, other))) invalidMarkup();
    }
  }
}

function overlaps(left: TelegramMessageEntity, right: TelegramMessageEntity): boolean {
  return left.offset < right.offset + right.length && right.offset < left.offset + left.length;
}

function invalidMarkup(): never {
  throw new Error("CRYPTUS_TELEGRAM_MARKUP_INVALID");
}
