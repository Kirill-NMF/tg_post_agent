import { deriveCanonicalSegments } from "./formatting.js";
import { isOrdinaryEmoji } from "./emoji.js";

export const CRYPTUS_OPTION2_PROMPT_VERSION = "cryptus_media_option2_v1";

const backtick = String.fromCharCode(96);
const fixedPrompt = [
  "Правила форматирования (Опция 2: CRYPTUS_MEDIA)",
  "",
  "Цель: Отформатировать предоставленный русский текст для публикации в Telegram, используя только нативное форматирование Telegram (жирный **, моноширинный " + backtick + ") и строго следуя стилю CRYPTUS_MEDIA (Опция 2).",
  "",
  "Инструкции:",
  "1. Начало поста: добавить эмодзи 📜 и выделить заголовок поста жирным шрифтом.",
  "2. Заголовки секций: начинать каждый заголовок секции с эмодзи ⏸️ и выделять его жирным шрифтом, используя КАПСЛОК.",
  "3. Списки: заменить маркеры списков (-, *, нумерацию) на эмодзи 🟠. Первое слово или фразу в пункте выделить жирным.",
  "4. Копируемый контент: примеры фраз, код, URL и промпты, предназначенные для копирования, заключать в моноширинный шрифт и предварять эмодзи 🔅.",
  "5. Ключевые слова: выделять только жирным шрифтом.",
  "6. Курсив запрещён.",
  "7. Финальный CTA: добавить 🔥 и выделить CTA жирным.",
  "8. Прямой вопрос к аудитории в конце: добавить ➡️ и выделить вопрос жирным.",
  "9. Обычный текст оставлять обычным.",
  "10. Оригинальный текст сохранить без изменений и перефразирования. Разрешено только добавить Telegram-разметку, разрешённые эмодзи и изменить разбиение на абзацы; КАПСЛОК допустим только для заголовков секций.",
  "11. Не добавлять другие эмодзи, Markdown-заголовки (#/##/###), комментарии или пояснения.",
  "12. Вернуть только готовый пост.",
].join("\n");

const allowedEmoji = new Set(["📜", "⏸", "⏸️", "🟠", "🔅", "🔥", "➡", "➡️"]);
const graphemeSegmenter = new Intl.Segmenter("ru", { granularity: "grapheme" });

export type CryptusOption2Validation =
  | {
      ok: true;
      lexicalSequenceExact: true;
      punctuationPreserved: true;
      titleValid: true;
      finalQuestionValid: true;
      comparisonListValid: true;
      allowedEmojiOnly: true;
      markdownValid: true;
    }
  | { ok: false; code: string };

export function buildCryptusOption2Prompt(draft: string): string {
  if (!draft.trim()) throw new Error("CRYPTUS_OPTION2_DRAFT_EMPTY");
  return fixedPrompt + '\n\nPOST:\n"""\n' + draft + '\n"""';
}

export function validateCryptusOption2Candidate(draft: string, candidate: string): CryptusOption2Validation {
  if (!draft.trim() || !candidate.trim()) return invalid("FORMAT_OPTION2_OUTPUT_EMPTY");
  const lines = candidate.split(/\r?\n/u);
  const nonEmpty = lines.map((line) => line.trim()).filter(Boolean);
  const first = nonEmpty[0] ?? "";
  if (!/^📜\s+\*\*\S[\s\S]*\S\*\*$/u.test(first)) return invalid("FORMAT_OPTION2_TITLE_INVALID");
  if (/#{2,6}|(^|\n)\s*#\s+/mu.test(candidate)) return invalid("FORMAT_OPTION2_MARKDOWN_HEADING_FORBIDDEN");
  if (candidate.includes(backtick.repeat(3))) return invalid("FORMAT_OPTION2_OUTPUT_WRAPPER_FORBIDDEN");
  if (containsForbiddenItalic(candidate)) return invalid("FORMAT_OPTION2_ITALIC_FORBIDDEN");
  if (/~~|\|\|/u.test(candidate) || !hasBalancedPairs(candidate, "**") || !hasBalancedPairs(candidate, backtick)) {
    return invalid("FORMAT_OPTION2_MARKDOWN_INVALID");
  }
  if (emojiTokens(candidate).some((emoji) => !allowedEmoji.has(emoji))) return invalid("FORMAT_OPTION2_EMOJI_FORBIDDEN");
  if (!validateEmojiRoles(lines)) return invalid("FORMAT_OPTION2_EMOJI_ROLE_INVALID");
  if (!validateLexicalSurface(draft, candidate)) return invalid("FORMAT_OPTION2_LEXICAL_PRESERVATION_FAILED");
  if (!validateComparisonList(draft, lines)) return invalid("FORMAT_OPTION2_COMPARISON_LIST_INVALID");
  if (!validateFinalQuestion(draft, nonEmpty)) return invalid("FORMAT_OPTION2_FINAL_QUESTION_INVALID");
  if (!validateSectionHeadings(draft, lines)) return invalid("FORMAT_OPTION2_SECTION_HEADING_INVALID");
  return {
    ok: true,
    lexicalSequenceExact: true,
    punctuationPreserved: true,
    titleValid: true,
    finalQuestionValid: true,
    comparisonListValid: true,
    allowedEmojiOnly: true,
    markdownValid: true,
  };
}

export function deformatCryptusOption2(value: string, source = false): string {
  const withoutSourceAnchors = source
    ? value
        .replace(/^\s*#{1,6}\s+/gmu, "")
        .replace(/^\s*(?:[-*]|\d+[.)])\s+/gmu, "")
    : value;
  const withoutEmoji = [...graphemeSegmenter.segment(withoutSourceAnchors)]
    .map(({ segment }) => allowedEmoji.has(segment) ? "" : segment)
    .join("");
  return withoutEmoji
    .replace(/\*\*/gu, "")
    .replaceAll(backtick, "")
    .replace(/[ \t]+/gu, " ")
    .replace(/\s*\n\s*/gu, "\n")
    .replace(/\n+/gu, "\n")
    .trim();
}

function validateLexicalSurface(draft: string, candidate: string): boolean {
  const sourcePlain = deformatCryptusOption2(draft, true);
  const candidatePlain = deformatCryptusOption2(candidate);
  const sourceSegments = deriveCanonicalSegments(sourcePlain);
  const sourceTokens = sourceSegments.flatMap((segment) =>
    surfaceTokens(segment.text).map((value) => ({ value, caseChangeAllowed: segment.role === "section_heading" }))
  );
  const candidateTokens = surfaceTokens(candidatePlain);
  if (sourceTokens.length !== candidateTokens.length) return false;
  return sourceTokens.every((token, index) => token.caseChangeAllowed
    ? token.value.toLocaleLowerCase("ru") === candidateTokens[index]!.toLocaleLowerCase("ru")
    : token.value === candidateTokens[index]);
}

function surfaceTokens(value: string): string[] {
  return [...value.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\p{L}\p{N}\s]/gu)].map((match) => match[0]);
}

function containsForbiddenItalic(value: string): boolean {
  const withoutBold = value.replace(/\*\*/gu, "");
  return /(^|[^*])\*(?=\S)[^*\n]+(?<=\S)\*(?!\*)/mu.test(withoutBold)
    || /(^|[^_])_(?=\S)[^_\n]+(?<=\S)_(?!_)/mu.test(value);
}

function hasBalancedPairs(value: string, marker: string): boolean {
  return value.split(marker).length % 2 === 1;
}

function emojiTokens(value: string): string[] {
  return [...graphemeSegmenter.segment(value)]
    .map(({ segment }) => segment)
    .filter((segment) => isOrdinaryEmoji(segment));
}

function validateEmojiRoles(lines: readonly string[]): boolean {
  let scrollCount = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const leading = leadingAllowedEmoji(trimmed);
    if (leading === "📜") scrollCount += 1;
    const remainder = leading ? trimmed.slice(leading.length).trimStart() : trimmed;
    if (emojiTokens(remainder).some((emoji) => allowedEmoji.has(emoji))) return false;
    if ((leading === "⏸" || leading === "⏸️") && !isBoldUppercaseLine(remainder)) return false;
    if (leading === "🟠" && !/^\*\*\S.+?\*\*/u.test(remainder)) return false;
    if (leading === "🔅" && !remainder.includes(backtick)) return false;
    if (leading === "🔥" && !/^\*\*\S[\s\S]*\S\*\*$/u.test(remainder)) return false;
    if ((leading === "➡" || leading === "➡️") && !/^\*\*\S[\s\S]*\?\*\*$/u.test(remainder)) return false;
  }
  return scrollCount === 1;
}

function leadingAllowedEmoji(value: string): string | undefined {
  return [...graphemeSegmenter.segment(value)].map(({ segment }) => segment).find((segment, index) => index === 0 && allowedEmoji.has(segment));
}

function isBoldUppercaseLine(value: string): boolean {
  const match = /^\*\*(.+)\*\*$/u.exec(value);
  if (!match) return false;
  const letters = [...match[1]!].filter((character) => /\p{L}/u.test(character)).join("");
  return Boolean(letters) && letters === letters.toLocaleUpperCase("ru");
}

function validateComparisonList(draft: string, lines: readonly string[]): boolean {
  if (!/Раньше:/u.test(draft) || !/Сейчас:/u.test(draft)) return true;
  return ["Раньше:", "Сейчас:"].every((label) =>
    lines.some((line) => new RegExp("^\\s*🟠\\s+\\*\\*" + label + "\\*\\*", "u").test(line))
  );
}

function validateFinalQuestion(draft: string, candidateNonEmptyLines: readonly string[]): boolean {
  const sourceLast = draft.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).at(-1) ?? "";
  if (!sourceLast.endsWith("?")) return true;
  return /^➡️?\s+\*\*\S[\s\S]*\?\*\*$/u.test(candidateNonEmptyLines.at(-1) ?? "");
}

function validateSectionHeadings(draft: string, candidateLines: readonly string[]): boolean {
  const sourcePlain = deformatCryptusOption2(draft, true);
  const headings = deriveCanonicalSegments(sourcePlain).filter((segment) => segment.role === "section_heading");
  return headings.every((heading) => {
    const expected = surfaceTokens(heading.text).map((token) => token.toLocaleLowerCase("ru"));
    return candidateLines.some((line) => {
      const trimmed = line.trim();
      const leading = leadingAllowedEmoji(trimmed);
      if (leading !== "⏸" && leading !== "⏸️") return false;
      const candidate = deformatCryptusOption2(trimmed);
      return equalTokens(surfaceTokens(candidate).map((token) => token.toLocaleLowerCase("ru")), expected)
        && isBoldUppercaseLine(trimmed.slice(leading.length).trimStart());
    });
  });
}

function equalTokens(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function invalid(code: string): CryptusOption2Validation {
  return { ok: false, code };
}
