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
    let line = lines[lineIndex]!;
    const role = roleAtLineStart(line);
    if (role) {
      const canonicalMarker = canonicalMarkers[role].find((marker) => line === marker || line.startsWith(`${marker} `))!;
      const mapping = mappingByRole.get(role);
      const outputMarker = mapping?.alt ?? canonicalMarker;
      const offset = text.length;
      text += outputMarker;
      line = line.slice(canonicalMarker.length);
      if (mapping) entities.push({ type: "custom_emoji", offset, length: outputMarker.length, custom_emoji_id: mapping.customEmojiId });
    }
    const parsed = parseStrictLine(line, text.length);
    text += parsed.text;
    entities.push(...parsed.entities);
  }

  assertEntityRanges(text, entities);
  return { text, entities, usedCustomEmoji: entities.some((entity) => entity.type === "custom_emoji") };
}

function roleAtLineStart(line: string): CustomEmojiRole | undefined {
  for (const role of customEmojiRoles) {
    if (canonicalMarkers[role].some((marker) => line === marker || line.startsWith(`${marker} `))) return role;
  }
  return undefined;
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
