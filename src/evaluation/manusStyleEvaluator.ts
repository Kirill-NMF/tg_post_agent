import { createHash } from "node:crypto";
import { containsOrdinaryEmoji, isOrdinaryEmoji } from "../domain/emoji.js";
import { validateCryptusOption2Candidate } from "../domain/cryptusOption2.js";

export const manusAnchorRoles = [
  "main_heading",
  "section_heading",
  "intro",
  "primary_list",
  "nested_list",
  "bold_span",
  "prompt_code",
  "cta",
  "audience_question",
  "hashtag_footer",
  "paragraph_boundary",
  "semantic_accent",
] as const;

export type ManusAnchorRole = (typeof manusAnchorRoles)[number];

export type ManusAnchor = {
  role: ManusAnchorRole;
  startToken: number;
  endToken: number;
  lineIndex: number;
};

export type RemovedFormatting = {
  pass: number;
  plainOffset: number;
  formattedOffset: number;
  value: string;
  category: "markdown" | "emoji_anchor" | "list_marker" | "layout";
};

export type DeformatResult = {
  plainText: string;
  anchorMap: RemovedFormatting[];
  anchors: ManusAnchor[];
  lexicalTokens: string[];
  punctuationSequence: string[];
};

export type RoleMetrics = { precision: number; recall: number; f1: number };

export type ManusEvaluation = {
  pass: boolean;
  hardGates: {
    lexicalSequenceExact: boolean;
    punctuationPreserved: boolean;
    markdownBalanced: boolean;
    forbiddenStylesZero: boolean;
    forbiddenEmojiCategoriesZero: boolean;
    inventedHashtagZero: boolean;
    inventedCtaZero: boolean;
    inventedQuestionZero: boolean;
    explicitProductContract: boolean;
  };
  metrics: {
    heading: RoleMetrics;
    section: RoleMetrics;
    list: RoleMetrics;
    bold: RoleMetrics;
    paragraph: RoleMetrics;
    emojiRole: RoleMetrics;
    emojiDensityDeviationPer100Words: number;
    semanticAccentCount: number;
    semanticAccentBudgetExceeded: boolean;
    headingCaseAccuracy: number;
    roles: Record<ManusAnchorRole, RoleMetrics>;
    weightedContributions: {
      heading: number;
      section: number;
      list: number;
      bold: number;
      paragraph: number;
      emojiRole: number;
      emojiDensity: number;
      semanticAccent: number;
      headingCase: number;
    };
  };
  weightedStyleScore: number;
  diagnostics: {
    exactByteEquality: boolean;
    sourceTokenCount: number;
    candidateTokenCount: number;
    goldFingerprint: string;
    candidateFingerprint: string;
    productContractCode?: string;
  };
  categories: string[];
};

export type ManusStyleProfile = {
  wordCount: number;
  roleDensity: Record<ManusAnchorRole, number>;
  emojiDensityPer100Words: number;
  paragraphDensityPer100Words: number;
};

const knownAnchors = new Map<string, ManusAnchorRole>([
  ["⏸", "section_heading"],
  ["⏸️", "section_heading"],
  ["🟠", "primary_list"],
  ["🔅", "prompt_code"],
  ["🔥", "cta"],
  ["➡", "audience_question"],
  ["➡️", "audience_question"],
]);

const roleGroups = {
  heading: new Set<ManusAnchorRole>(["main_heading"]),
  section: new Set<ManusAnchorRole>(["section_heading"]),
  list: new Set<ManusAnchorRole>(["primary_list", "nested_list"]),
  bold: new Set<ManusAnchorRole>(["bold_span"]),
  paragraph: new Set<ManusAnchorRole>(["paragraph_boundary"]),
  emoji: new Set<ManusAnchorRole>(["section_heading", "intro", "primary_list", "prompt_code", "cta", "audience_question", "semantic_accent"]),
};

export function tokenizeLexical(value: string): string[] {
  return [...value.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)].map((match) => match[0]);
}

export function deformatGold(formattedText: string): DeformatResult {
  if (!formattedText) return { plainText: "", anchorMap: [], anchors: [], lexicalTokens: [], punctuationSequence: [] };
  const anchorMap: RemovedFormatting[] = [];
  let plainText = formattedText;
  for (let pass = 0; pass < 8; pass += 1) {
    const removals = collectRemovals(plainText);
    if (!removals.length) break;
    const before = plainText;
    let next = "";
    let cursor = 0;
    for (const removal of removals) {
      next += before.slice(cursor, removal.start);
      anchorMap.push({ pass, plainOffset: next.length, formattedOffset: removal.start, value: before.slice(removal.start, removal.end), category: removal.category });
      cursor = removal.end;
    }
    next += before.slice(cursor);
    plainText = next;
  }
  return {
    plainText,
    anchorMap,
    anchors: annotateGold(formattedText),
    lexicalTokens: tokenizeLexical(plainText),
    punctuationSequence: punctuationSequence(plainText),
  };
}

export function restoreGoldFormatting(plainText: string, anchorMap: RemovedFormatting[]): string {
  let restored = plainText;
  const maximumPass = Math.max(-1, ...anchorMap.map((item) => item.pass));
  for (let pass = maximumPass; pass >= 0; pass -= 1) {
    const grouped = new Map<number, RemovedFormatting[]>();
    for (const item of anchorMap.filter((candidate) => candidate.pass === pass)) grouped.set(item.plainOffset, [...(grouped.get(item.plainOffset) ?? []), item]);
    for (const [offset, items] of [...grouped.entries()].sort((left, right) => right[0] - left[0])) {
      const insertion = [...items].sort((left, right) => left.formattedOffset - right.formattedOffset).map((item) => item.value).join("");
      restored = restored.slice(0, offset) + insertion + restored.slice(offset);
    }
  }
  return restored;
}

export function annotateGold(formattedText: string): ManusAnchor[] {
  const anchors: ManusAnchor[] = [];
  let tokenCursor = 0;
  let mainHeadingAssigned = false;
  const lines = formattedText.split("\n");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const plainLine = deformatLine(line);
    const count = tokenizeLexical(plainLine).length;
    const startToken = tokenCursor;
    const endToken = count ? tokenCursor + count - 1 : tokenCursor;
    const trimmed = line.trim();
    const prefix = leadingGrapheme(trimmed);
    const knownRole = knownAnchors.get(prefix);
    if (knownRole) anchors.push({ role: knownRole, startToken, endToken, lineIndex });
    else if (prefix && prefix !== "📜" && isOrdinaryEmoji(prefix)) anchors.push({ role: "semantic_accent", startToken, endToken, lineIndex });
    if (/^(?:—|–|-)\s/u.test(trimmed)) anchors.push({ role: "nested_list", startToken, endToken, lineIndex });
    if (/^#\p{L}/u.test(trimmed)) anchors.push({ role: "hashtag_footer", startToken, endToken, lineIndex });
    const withoutLeadingEmoji = trimmed.replace(/^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u200D|\uFE0F)+\s*/u, "");
    const fullBold = /^(?:\*\*[^*]+\*\*|\*[^*\n]+\*)$/u.test(withoutLeadingEmoji);
    if (fullBold && !mainHeadingAssigned && lineIndex <= 2) {
      anchors.push({ role: "main_heading", startToken, endToken, lineIndex });
      mainHeadingAssigned = true;
    } else if (fullBold && knownRole === "section_heading") {
      // The section role was already recorded by the semantic marker.
    } else if (fullBold && count > 0 && upperCaseRatio(plainLine) >= 0.7) {
      anchors.push({ role: "section_heading", startToken, endToken, lineIndex });
    }
    for (const match of markdownBoldSpans(line)) {
      const before = tokenizeLexical(deformatLine(line.slice(0, match.index))).length;
      const inside = tokenizeLexical(match.text).length;
      anchors.push({ role: "bold_span", startToken: startToken + before, endToken: startToken + before + Math.max(0, inside - 1), lineIndex });
    }
    if (!knownRole && /`[^`]+`|```/u.test(line)) anchors.push({ role: "prompt_code", startToken, endToken, lineIndex });
    tokenCursor += count;
    if (lineIndex < lines.length - 1 && !line.trim() && lines[lineIndex + 1]?.trim()) {
      anchors.push({ role: "paragraph_boundary", startToken: Math.max(0, tokenCursor - 1), endToken: tokenCursor, lineIndex });
    }
  }
  return uniqueAnchors(anchors);
}

export function evaluateManusStyle(sourcePlain: string, goldText: string, candidateText: string, threshold = 0.78): ManusEvaluation {
  const gold = deformatGold(goldText);
  const candidate = deformatGold(candidateText);
  const sourceTokens = tokenizeLexical(sourcePlain);
  const candidateTokens = candidate.lexicalTokens;
  const lower = (tokens: string[]) => tokens.map((token) => token.toLocaleLowerCase("ru"));
  const lexicalSequenceExact = equalArrays(lower(sourceTokens), lower(candidateTokens));
  const punctuationPreserved = equalArrays(punctuationSequence(sourcePlain), candidate.punctuationSequence);
  const markdown = validateMarkdown(candidateText);
  const emojiValidity = leadingEmojiTokens(candidateText).every((token) => isOrdinaryEmoji(token));
  const productContract = validateCryptusOption2Candidate(sourcePlain, candidateText);
  const hardGates = {
    lexicalSequenceExact,
    punctuationPreserved,
    markdownBalanced: markdown.balanced,
    forbiddenStylesZero: markdown.forbiddenStyles.length === 0,
    forbiddenEmojiCategoriesZero: emojiValidity,
    inventedHashtagZero: noExtraRoleAnchors(gold.anchors, candidate.anchors, "hashtag_footer"),
    inventedCtaZero: noExtraRoleAnchors(gold.anchors, candidate.anchors, "cta"),
    inventedQuestionZero: noExtraRoleAnchors(gold.anchors, candidate.anchors, "audience_question"),
    explicitProductContract: productContract.ok,
  };
  const heading = groupMetrics(gold.anchors, candidate.anchors, roleGroups.heading);
  const section = groupMetrics(gold.anchors, candidate.anchors, roleGroups.section);
  const list = groupMetrics(gold.anchors, candidate.anchors, roleGroups.list);
  const bold = groupMetrics(gold.anchors, candidate.anchors, roleGroups.bold);
  const paragraph = groupMetrics(gold.anchors, candidate.anchors, roleGroups.paragraph);
  const emojiRole = groupMetrics(gold.anchors, candidate.anchors, roleGroups.emoji);
  const sourceWordCount = Math.max(1, sourceTokens.length);
  const goldEmojiDensity = (leadingEmojiTokens(goldText).length / sourceWordCount) * 100;
  const candidateEmojiDensity = (leadingEmojiTokens(candidateText).length / sourceWordCount) * 100;
  const emojiDensityDeviationPer100Words = round(Math.abs(candidateEmojiDensity - goldEmojiDensity));
  const semanticAccentCount = candidate.anchors.filter((anchor) => anchor.role === "semantic_accent").length;
  const semanticAccentBudget = Math.max(1, Math.ceil(sourceWordCount / 150));
  const headingCaseAccuracy = caseAccuracy(goldText, candidateText, gold.anchors.filter((anchor) => roleGroups.heading.has(anchor.role) || roleGroups.section.has(anchor.role)));
  const densityScore = clamp(1 - emojiDensityDeviationPer100Words / Math.max(1, goldEmojiDensity * 2));
  const accentScore = semanticAccentCount <= semanticAccentBudget ? 1 : clamp(1 - (semanticAccentCount - semanticAccentBudget) / semanticAccentBudget);
  const roles = Object.fromEntries(manusAnchorRoles.map((role) => [role, groupMetrics(gold.anchors, candidate.anchors, new Set([role]))])) as Record<ManusAnchorRole, RoleMetrics>;
  const weightedContributions = {
    heading: round(heading.f1 * 0.12),
    section: round(section.f1 * 0.13),
    list: round(list.f1 * 0.15),
    bold: round(bold.f1 * 0.14),
    paragraph: round(paragraph.f1 * 0.14),
    emojiRole: round(emojiRole.f1 * 0.16),
    emojiDensity: round(densityScore * 0.08),
    semanticAccent: round(accentScore * 0.04),
    headingCase: round(headingCaseAccuracy * 0.04),
  };
  const weightedStyleScore = round(Object.values(weightedContributions).reduce((sum, value) => sum + value, 0));
  const categories = Object.entries(hardGates).filter(([, value]) => !value).map(([key]) => `MANUS_GATE_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`);
  if (weightedStyleScore < threshold) categories.push("MANUS_STYLE_SCORE_BELOW_THRESHOLD");
  return {
    pass: Object.values(hardGates).every(Boolean) && weightedStyleScore >= threshold,
    hardGates,
    metrics: { heading, section, list, bold, paragraph, emojiRole, emojiDensityDeviationPer100Words, semanticAccentCount, semanticAccentBudgetExceeded: semanticAccentCount > semanticAccentBudget, headingCaseAccuracy, roles, weightedContributions },
    weightedStyleScore,
    diagnostics: {
      exactByteEquality: goldText === candidateText,
      sourceTokenCount: sourceTokens.length,
      candidateTokenCount: candidateTokens.length,
      goldFingerprint: fingerprint(goldText),
      candidateFingerprint: fingerprint(candidateText),
      ...(!productContract.ok ? { productContractCode: productContract.code } : {}),
    },
    categories,
  };
}

export function buildStyleProfile(formattedText: string): ManusStyleProfile {
  const result = deformatGold(formattedText);
  const wordCount = Math.max(1, result.lexicalTokens.length);
  const roleDensity = Object.fromEntries(manusAnchorRoles.map((role) => [role, round((result.anchors.filter((anchor) => anchor.role === role).length / wordCount) * 100)])) as Record<ManusAnchorRole, number>;
  return {
    wordCount,
    roleDensity,
    emojiDensityPer100Words: round((leadingEmojiTokens(formattedText).length / wordCount) * 100),
    paragraphDensityPer100Words: roleDensity.paragraph_boundary,
  };
}

export function calibrateStyleThreshold(training: ManusStyleProfile[], holdoutId: string): { trainingCount: number; holdoutId: string; leaveOneOutScores: number[]; threshold: number } {
  if (training.length < 2) throw new Error("MANUS_CALIBRATION_REQUIRES_MULTIPLE_GOLD_REFERENCES");
  const leaveOneOutScores = training.map((profile, index) => profileSimilarity(profile, meanProfile(training.filter((_, candidate) => candidate !== index))));
  const threshold = round(Math.min(0.95, Math.max(0.65, Math.min(...leaveOneOutScores) - 0.05)));
  return { trainingCount: training.length, holdoutId, leaveOneOutScores, threshold };
}

function collectRemovals(text: string): Array<{ start: number; end: number; category: RemovedFormatting["category"] }> {
  const removals: Array<{ start: number; end: number; category: RemovedFormatting["category"] }> = [];
  for (const match of text.matchAll(/\*\*([^*]+)\*\*/gu)) {
    const start = match.index ?? 0;
    removals.push({ start, end: start + 2, category: "markdown" }, { start: start + match[0].length - 2, end: start + match[0].length, category: "markdown" });
  }
  for (const match of text.matchAll(/(?<!\*)\*([^*\n]+)\*(?!\*)/gu)) {
    const start = match.index ?? 0;
    removals.push({ start, end: start + 1, category: "markdown" }, { start: start + match[0].length - 1, end: start + match[0].length, category: "markdown" });
  }
  for (const expression of [/\|\|([^|]+)\|\|/gu, /~~([^~]+)~~/gu]) {
    for (const match of text.matchAll(expression)) {
      const start = match.index ?? 0;
      removals.push({ start, end: start + 2, category: "markdown" }, { start: start + match[0].length - 2, end: start + match[0].length, category: "markdown" });
    }
  }
  for (const match of text.matchAll(/`([^`\n]+)`/gu)) {
    const start = match.index ?? 0;
    removals.push({ start, end: start + 1, category: "markdown" }, { start: start + match[0].length - 1, end: start + match[0].length, category: "markdown" });
  }
  for (const match of text.matchAll(/(^|\n)(_)([^_\n]+)(_)(?=$|\n)/gu)) {
    const start = (match.index ?? 0) + match[1].length;
    removals.push({ start, end: start + 1, category: "markdown" }, { start: start + match[0].length - match[1].length - 1, end: start + match[0].length - match[1].length, category: "markdown" });
  }
  let lineOffset = 0;
  for (const line of text.split("\n")) {
    const leading = line.match(/^\s*/u)?.[0].length ?? 0;
    const body = line.slice(leading);
    const emojiPrefixLength = formattingEmojiPrefixLength(body);
    if (emojiPrefixLength > 0) removals.push({ start: lineOffset + leading, end: lineOffset + leading + emojiPrefixLength, category: "emoji_anchor" });
    const afterEmoji = body.slice(emojiPrefixLength);
    const list = afterEmoji.match(/^(?:—|–|-)\s+/u)?.[0];
    if (list) removals.push({ start: lineOffset + leading + emojiPrefixLength, end: lineOffset + leading + emojiPrefixLength + list.length, category: "list_marker" });
    lineOffset += line.length + 1;
  }
  for (const match of text.matchAll(/\n{3,}/gu)) {
    const start = (match.index ?? 0) + 2;
    removals.push({ start, end: (match.index ?? 0) + match[0].length, category: "layout" });
  }
  return removals.sort((left, right) => left.start - right.start || left.end - right.end).filter((entry, index, all) => entry.start < entry.end && (index === 0 || entry.start >= all[index - 1].end));
}

function deformatLine(line: string): string {
  const result = deformatGoldWithoutAnnotations(line);
  return result;
}

function deformatGoldWithoutAnnotations(text: string): string {
  let plain = text;
  for (let pass = 0; pass < 8; pass += 1) {
    const removals = collectRemovals(plain);
    if (!removals.length) break;
    let next = "";
    let cursor = 0;
    for (const removal of removals) { next += plain.slice(cursor, removal.start); cursor = removal.end; }
    plain = next + plain.slice(cursor);
  }
  return plain;
}

function punctuationSequence(text: string): string[] {
  const withoutWords = text.replace(/[\p{L}\p{N}\s]/gu, "");
  return [...withoutWords].filter((character) => !containsOrdinaryEmoji(character));
}

function leadingGrapheme(value: string): string {
  if (!value) return "";
  const segmenter = new Intl.Segmenter("ru", { granularity: "grapheme" });
  return segmenter.segment(value)[Symbol.iterator]().next().value?.segment ?? "";
}

function leadingEmojiTokens(text: string): string[] {
  return text.split("\n").flatMap((line) => {
    const tokens: string[] = [];
    const segmenter = new Intl.Segmenter("ru", { granularity: "grapheme" });
    for (const item of segmenter.segment(line.trim())) {
      if (item.segment && (knownAnchors.has(item.segment) || isEmojiLikeGrapheme(item.segment))) tokens.push(item.segment);
      else if (tokens.length && /^\s+$/u.test(item.segment)) continue;
      else break;
    }
    return tokens;
  });
}

function isEmojiLikeGrapheme(value: string): boolean {
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3/u.test(value);
}

function formattingEmojiPrefixLength(value: string): number {
  const segmenter = new Intl.Segmenter("ru", { granularity: "grapheme" });
  let end = 0;
  let sawEmoji = false;
  for (const item of segmenter.segment(value)) {
    if (knownAnchors.has(item.segment) || isEmojiLikeGrapheme(item.segment)) {
      sawEmoji = true;
      end = item.index + item.segment.length;
      continue;
    }
    if (sawEmoji && /^\s+$/u.test(item.segment)) {
      end = item.index + item.segment.length;
      continue;
    }
    break;
  }
  return sawEmoji ? end : 0;
}

function validateMarkdown(text: string): { balanced: boolean; forbiddenStyles: string[] } {
  const forbiddenStyles: string[] = [];
  if (/\|\|[^|]+\|\|/u.test(text)) forbiddenStyles.push("spoiler");
  if (/~~[^~]+~~/u.test(text)) forbiddenStyles.push("strike");
  if (/(^|\s)_[^_\n]+_(?=\s|$)/u.test(text)) forbiddenStyles.push("italic");
  const withoutValidBold = text
    .replace(/\*\*[^*\n]+\*\*/gu, "")
    .replace(/(?<!\*)\*[^*\n]+\*(?!\*)/gu, "");
  const balanced = !/(?<!\\)\*/u.test(withoutValidBold) && (text.match(/\|\|/gu)?.length ?? 0) % 2 === 0 && (text.match(/~~/gu)?.length ?? 0) % 2 === 0 && (text.match(/`/gu)?.length ?? 0) % 2 === 0;
  return { balanced, forbiddenStyles };
}

function markdownBoldSpans(line: string): Array<{ index: number; text: string }> {
  const spans: Array<{ index: number; text: string }> = [];
  for (const match of line.matchAll(/\*\*([^*]+)\*\*/gu)) spans.push({ index: match.index ?? 0, text: match[1] });
  for (const match of line.matchAll(/(?<!\*)\*([^*\n]+)\*(?!\*)/gu)) spans.push({ index: match.index ?? 0, text: match[1] });
  return spans.sort((left, right) => left.index - right.index);
}

function groupMetrics(gold: ManusAnchor[], candidate: ManusAnchor[], roles: Set<ManusAnchorRole>): RoleMetrics {
  const expected = new Set(gold.filter((anchor) => roles.has(anchor.role)).map(anchorKey));
  const actual = new Set(candidate.filter((anchor) => roles.has(anchor.role)).map(anchorKey));
  const matches = [...actual].filter((key) => expected.has(key)).length;
  const precision = actual.size ? matches / actual.size : expected.size ? 0 : 1;
  const recall = expected.size ? matches / expected.size : actual.size ? 0 : 1;
  return { precision: round(precision), recall: round(recall), f1: round(precision + recall ? (2 * precision * recall) / (precision + recall) : 0) };
}

function anchorKey(anchor: ManusAnchor): string { return `${anchor.role}:${anchor.startToken}:${anchor.endToken}`; }
function noExtraRoleAnchors(gold: ManusAnchor[], candidate: ManusAnchor[], role: ManusAnchorRole): boolean { const expected = new Set(gold.filter((anchor) => anchor.role === role).map(anchorKey)); return candidate.filter((anchor) => anchor.role === role).every((anchor) => expected.has(anchorKey(anchor))); }
function uniqueAnchors(anchors: ManusAnchor[]): ManusAnchor[] { return [...new Map(anchors.map((anchor) => [anchorKey(anchor), anchor])).values()]; }
function upperCaseRatio(value: string): number { const letters = [...value].filter((character) => /\p{L}/u.test(character)); return letters.length ? letters.filter((character) => character === character.toLocaleUpperCase("ru") && character !== character.toLocaleLowerCase("ru")).length / letters.length : 0; }
function caseAccuracy(goldText: string, candidateText: string, anchors: ManusAnchor[]): number { if (!anchors.length) return 1; const goldTokens = tokenizeLexical(deformatGold(goldText).plainText); const candidateTokens = tokenizeLexical(deformatGold(candidateText).plainText); return round(anchors.filter((anchor) => { const expected = goldTokens.slice(anchor.startToken, anchor.endToken + 1); const actual = candidateTokens.slice(anchor.startToken, anchor.endToken + 1); return equalArrays(expected, actual); }).length / anchors.length); }
function meanProfile(profiles: ManusStyleProfile[]): ManusStyleProfile { const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length; return { wordCount: mean(profiles.map((profile) => profile.wordCount)), roleDensity: Object.fromEntries(manusAnchorRoles.map((role) => [role, mean(profiles.map((profile) => profile.roleDensity[role]))])) as Record<ManusAnchorRole, number>, emojiDensityPer100Words: mean(profiles.map((profile) => profile.emojiDensityPer100Words)), paragraphDensityPer100Words: mean(profiles.map((profile) => profile.paragraphDensityPer100Words)) }; }
function profileSimilarity(left: ManusStyleProfile, right: ManusStyleProfile): number { const dimensions = [...manusAnchorRoles.map((role) => [left.roleDensity[role], right.roleDensity[role]] as const), [left.emojiDensityPer100Words, right.emojiDensityPer100Words] as const, [left.paragraphDensityPer100Words, right.paragraphDensityPer100Words] as const]; return round(dimensions.reduce((sum, [a, b]) => sum + (1 - Math.abs(a - b) / Math.max(1, a, b)), 0) / dimensions.length); }
function equalArrays(left: string[], right: string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
function fingerprint(value: string): string { return createHash("sha256").update(value).digest("hex").slice(0, 16); }
function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }
function round(value: number): number { return Math.round(value * 10000) / 10000; }
