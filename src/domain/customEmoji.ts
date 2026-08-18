export const customEmojiRoles = [
  "post_title",
  "section_title",
  "list_item",
  "copy_block",
  "cta",
  "audience_question"
] as const;

export type CustomEmojiRole = (typeof customEmojiRoles)[number];

export type CustomEmojiMapping = {
  role: CustomEmojiRole;
  customEmojiId: string;
  alt: string;
  setName: string;
};

export type CustomEmojiConfiguration = {
  mappings: CustomEmojiMapping[];
  updatedAt: Date;
};

const fixedRoleAlts: Partial<Record<CustomEmojiRole, readonly string[]>> = {
  post_title: ["📜"],
  section_title: ["⏸", "⏸️"],
  list_item: ["🟠"],
  copy_block: ["🔅"],
  cta: ["🔥"]
};

export function isValidCustomEmojiRoleAlt(role: CustomEmojiRole, alt: string): boolean {
  const fixed = fixedRoleAlts[role];
  return fixed ? fixed.includes(alt) : role === "audience_question" && isOrdinaryEmoji(alt);
}

export function validateCompleteCustomEmojiMappings(value: unknown): CustomEmojiMapping[] | undefined {
  if (!Array.isArray(value) || value.length !== customEmojiRoles.length) return undefined;
  const mappings: CustomEmojiMapping[] = [];
  for (let index = 0; index < customEmojiRoles.length; index += 1) {
    const item = value[index];
    if (!item || typeof item !== "object") return undefined;
    const record = item as Record<string, unknown>;
    const role = customEmojiRoles[index];
    if (
      record.role !== role ||
      typeof record.customEmojiId !== "string" || !/^\d{1,30}$/.test(record.customEmojiId) ||
      typeof record.alt !== "string" || !record.alt || record.alt.length > 16 ||
      !isValidCustomEmojiRoleAlt(role, record.alt) ||
      typeof record.setName !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(record.setName)
    ) return undefined;
    mappings.push({ role, customEmojiId: record.customEmojiId, alt: record.alt, setName: record.setName });
  }
  if (new Set(mappings.map((item) => item.customEmojiId)).size !== mappings.length) return undefined;
  return mappings;
}
import { isOrdinaryEmoji } from "./emoji.js";
