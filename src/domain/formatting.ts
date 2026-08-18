import type { FormattingOption } from "./types.js";
import { isOrdinaryEmoji } from "./emoji.js";

export type FormattingAnchor = {
  text: string;
  occurrence: number;
};

export type FormattingOperation =
  | { kind: "paragraph_break"; anchor: FormattingAnchor; position: "before" | "after" }
  | { kind: "markdown_span"; anchor: FormattingAnchor; style: "bold" | "italic" | "code" }
  | { kind: "emoji_insertion"; anchor: FormattingAnchor; position: "before" | "after"; emoji: string };

export type FormattingDecorationPlan = {
  option: FormattingOption;
  operations: FormattingOperation[];
};

export type RenderedInsertion = {
  renderedStart: number;
  text: string;
};

export type RenderedCaseTransform = {
  sourceStart: number;
  renderedStart?: number;
  originalText: string;
  transformedText: string;
};

export type FormattingApplyResult =
  | { ok: true; text: string; insertions: RenderedInsertion[]; caseTransforms: RenderedCaseTransform[] }
  | { ok: false; code: string; message: string; text: string };

type ResolvedOperation =
  | { kind: "paragraph_break" | "emoji_insertion"; sourceIndex: number; text: string; position: "before" | "after" }
  | { kind: "markdown_span"; start: number; end: number; marker: string };

type PendingInsertion = {
  sourceIndex: number;
  text: string;
  category: "paragraph_break" | "emoji_insertion" | "list_marker" | "markdown_open" | "markdown_close";
  position?: "before" | "after";
};

type Invalid = { ok: false; code: string; message: string };

export function applyFormattingPlan(originalText: string, plan: FormattingDecorationPlan): FormattingApplyResult {
  if (!originalText.trim()) return fallback(originalText, "FORMAT_SOURCE_EMPTY", "Canonical draft is required.");
  if (!isRecord(plan) || (plan.option !== "option_1" && plan.option !== "option_2") || !Array.isArray(plan.operations)) {
    return fallback(originalText, "FORMAT_PLAN_INVALID", "Formatting plan shape is invalid.");
  }

  const resolved: ResolvedOperation[] = [];
  for (const operation of plan.operations) {
    const result = resolveOperation(originalText, plan.option, operation);
    if (!result.ok) return fallback(originalText, result.code, result.message);
    resolved.push(result.value);
  }

  const insertionKeys = new Set<string>();
  const spans: Array<{ start: number; end: number }> = [];
  const insertions: PendingInsertion[] = [];

  for (const operation of resolved) {
    if (operation.kind === "markdown_span") {
      spans.push({ start: operation.start, end: operation.end });
      insertions.push({ sourceIndex: operation.start, text: operation.marker, category: "markdown_open" });
      insertions.push({ sourceIndex: operation.end, text: operation.marker, category: "markdown_close" });
      continue;
    }
    const category = operation.kind;
    const key = String(operation.sourceIndex) + ":" + category;
    if (insertionKeys.has(key)) {
      return fallback(originalText, "FORMAT_INSERTION_CONFLICT", "Duplicate decorations cannot share the same insertion boundary.");
    }
    insertionKeys.add(key);
    insertions.push({ sourceIndex: operation.sourceIndex, text: operation.text, category, position: operation.position });
  }

  spans.sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < spans.length; index += 1) {
    if (spans[index].start < spans[index - 1].end) {
      return fallback(originalText, "FORMAT_SPAN_OVERLAP", "Markdown spans must not overlap.");
    }
  }

  insertions.sort((left, right) => left.sourceIndex - right.sourceIndex || insertionOrder(left) - insertionOrder(right) || left.text.localeCompare(right.text));
  let cursor = 0;
  let text = "";
  const renderedInsertions: RenderedInsertion[] = [];

  for (const insertion of insertions) {
    text += originalText.slice(cursor, insertion.sourceIndex);
    renderedInsertions.push({ renderedStart: text.length, text: insertion.text });
    text += insertion.text;
    cursor = insertion.sourceIndex;
  }
  text += originalText.slice(cursor);

  return { ok: true, text, insertions: renderedInsertions, caseTransforms: [] };
}

export function recoverCanonicalText(renderedText: string, insertions: RenderedInsertion[], caseTransforms: RenderedCaseTransform[] = []): string | undefined {
  let recovered = renderedText;
  for (const insertion of [...insertions].sort((left, right) => right.renderedStart - left.renderedStart)) {
    if (recovered.slice(insertion.renderedStart, insertion.renderedStart + insertion.text.length) !== insertion.text) {
      return undefined;
    }
    recovered = recovered.slice(0, insertion.renderedStart) + recovered.slice(insertion.renderedStart + insertion.text.length);
  }
  for (const transform of [...caseTransforms].sort((left, right) => (right.renderedStart ?? right.sourceStart) - (left.renderedStart ?? left.sourceStart))) {
    const start = transform.renderedStart ?? transform.sourceStart;
    if (recovered.slice(start, start + transform.transformedText.length) !== transform.transformedText) return undefined;
    recovered = recovered.slice(0, start) + transform.originalText + recovered.slice(start + transform.transformedText.length);
  }
  return recovered;
}

function resolveOperation(
  originalText: string,
  option: FormattingOption,
  operation: unknown
): { ok: true; value: ResolvedOperation } | Invalid {
  if (!isRecord(operation) || typeof operation.kind !== "string") return invalidOperation("Formatting operation shape is invalid.");
  if (operation.kind === "paragraph_break") {
    const anchor = resolveAnchor(originalText, operation.anchor);
    if (!anchor.ok) return anchor;
    if (operation.position !== "before" && operation.position !== "after") return invalidOperation("Paragraph break position is invalid.");
    return { ok: true, value: { kind: "paragraph_break", sourceIndex: operation.position === "before" ? anchor.value.start : anchor.value.end, text: "\n\n", position: operation.position } };
  }
  if (operation.kind === "emoji_insertion") {
    if (option !== "option_2") return { ok: false, code: "FORMAT_OPTION_1_EMOJI_FORBIDDEN", message: "Option 1 does not allow expressive emoji." };
    const anchor = resolveAnchor(originalText, operation.anchor);
    if (!anchor.ok) return anchor;
    if (operation.position !== "before" && operation.position !== "after") return invalidOperation("Emoji position is invalid.");
    if (typeof operation.emoji !== "string" || !isOrdinaryEmoji(operation.emoji)) {
      return { ok: false, code: "FORMAT_EMOJI_INVALID", message: "Emoji insertion must contain only a bounded expressive emoji token." };
    }
    return { ok: true, value: { kind: "emoji_insertion", sourceIndex: operation.position === "before" ? anchor.value.start : anchor.value.end, text: operation.emoji, position: operation.position } };
  }
  if (operation.kind === "markdown_span") {
    const anchor = resolveAnchor(originalText, operation.anchor);
    if (!anchor.ok) return anchor;
    const marker = markerForStyle(operation.style);
    if (!marker) return invalidOperation("Markdown style is invalid.");
    return { ok: true, value: { kind: "markdown_span", start: anchor.value.start, end: anchor.value.end, marker } };
  }
  return { ok: false, code: "FORMAT_OPERATION_UNSUPPORTED", message: "Formatting operation is unsupported." };
}

function resolveAnchor(originalText: string, candidate: unknown): { ok: true; value: { start: number; end: number } } | Invalid {
  if (!isRecord(candidate) || typeof candidate.text !== "string" || !candidate.text) {
    return { ok: false, code: "FORMAT_ANCHOR_INVALID", message: "Formatting anchor is invalid or ambiguous." };
  }
  const occurrenceCount = candidate.occurrence;
  if (!Number.isInteger(occurrenceCount) || typeof occurrenceCount !== "number" || occurrenceCount < 0) {
    return { ok: false, code: "FORMAT_ANCHOR_INVALID", message: "Formatting anchor is invalid or ambiguous." };
  }
  let fromIndex = 0;
  let matchIndex = -1;
  for (let occurrence = 0; occurrence <= occurrenceCount; occurrence += 1) {
    matchIndex = originalText.indexOf(candidate.text, fromIndex);
    if (matchIndex < 0) return { ok: false, code: "FORMAT_ANCHOR_NOT_FOUND", message: "Formatting anchor was not found in the canonical draft." };
    fromIndex = matchIndex + candidate.text.length;
  }
  return { ok: true, value: { start: matchIndex, end: matchIndex + candidate.text.length } };
}

function insertionOrder(insertion: PendingInsertion): number {
  if (insertion.category === "markdown_close") return 0;
  if (insertion.position === "after") return insertion.category === "emoji_insertion" ? 1 : 2;
  if (insertion.position === "before") return insertion.category === "paragraph_break" ? 3 : 4;
  return 5;
}

function markerForStyle(style: unknown): string | undefined {
  if (style === "bold") return "*";
  if (style === "italic") return "_";
  if (style === "code") return String.fromCharCode(96);
  return undefined;
}

function invalidOperation(message: string): Invalid {
  return { ok: false, code: "FORMAT_OPERATION_INVALID", message };
}

function fallback(originalText: string, code: string, message: string): FormattingApplyResult {
  return { ok: false, code, message, text: originalText };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}


export type CanonicalFormattingRole =
  | "main_heading"
  | "section_heading"
  | "intro"
  | "primary_list"
  | "nested_list"
  | "list_candidate"
  | "prompt_code"
  | "cta"
  | "audience_question"
  | "hashtag_footer"
  | "paragraph";

export type CanonicalFormattingSegment = { id: string; start: number; end: number; text: string; role: CanonicalFormattingRole };
export type SegmentFormattingOperation =
  | { id: string; kind: "paragraph_break"; position: "before" | "after" }
  | { id: string; kind: "emoji_insertion"; position: "before" | "after"; emoji: string }
  | { id: string; kind: "semantic_accent"; position: "before" | "after"; emoji: string }
  | { id: string; kind: "markdown_span"; style: "bold" | "code" }
  | { id: string; kind: "heading_case"; mode: "uppercase" }
  | { id: string; kind: "list_marker"; marker: "dash" | "em_dash" }
  | { id: string; kind: "list_decoration"; role: "primary_list" | "nested_list" | "section_heading" };

export function deriveCanonicalSegments(text: string): CanonicalFormattingSegment[] {
  if (!text) return [];
  const raw: Array<{ start: number; end: number; text: string }> = [];
  const matcher = /[^\n]+/g;
  for (const match of text.matchAll(matcher)) raw.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, text: match[0] });
  const title = raw.length > 1 && isHeadingCandidate(raw[0].text);
  const audienceIndex = findAudienceQuestionIndex(raw);
  const introIndex = findIntroIndex(raw, title ? 1 : 0, audienceIndex);
  return raw.map((segment, index) => {
    let role: CanonicalFormattingRole;
    const trimmed = segment.text.trim();
    if (title && index === 0) role = "main_heading";
    else if (/^(?:`{1,3}|\u041a\u043e\u0434\s*:|\u041f\u0440\u043e\u043c\u043f\u0442\s*:)/iu.test(trimmed)) role = "prompt_code";
    else if (/^(?:#[\p{L}\p{N}_-]+\s*)+$/u.test(trimmed)) role = "hashtag_footer";
    else if (index === audienceIndex) role = "audience_question";
    else if (isCtaCandidate(trimmed)) role = "cta";
    else if (/^\s*(?:\u2014|\u2013)\s+/u.test(segment.text)) role = "nested_list";
    else if (/^\s*(?:-|\u2022|\d+[.)])\s+/u.test(segment.text)) role = "primary_list";
    else if (isSectionHeadingCandidate(raw, index)) role = "section_heading";
    else if (index === introIndex) role = "intro";
    else if (isEnumerationLead(raw, index)) role = "primary_list";
    else if (isLineGroupMember(raw, index)) role = "list_candidate";
    else role = "paragraph";
    return { id: "block_" + (index + 1), ...segment, role };
  });
}

function findAudienceQuestionIndex(raw: readonly { text: string }[]): number {
  for (let index = raw.length - 1; index >= 0; index -= 1) {
    const trimmed = raw[index].text.trim();
    if (/^(?:#[\p{L}\p{N}_-]+\s*)+$/u.test(trimmed)) continue;
    return /\?\s*$/u.test(trimmed) ? index : -1;
  }
  return -1;
}

function findIntroIndex(raw: readonly { start: number; end: number; text: string }[], start: number, audienceIndex: number): number {
  const end = audienceIndex >= 0 ? audienceIndex : raw.length;
  const preferred = raw.findIndex((segment, index) => index >= start && index < end
    && lexicalWordCount(segment.text) > 14
    && /[.!?]\s*$/u.test(segment.text)
    && upperCaseRatio(segment.text) <= 0.1
    && !isLineGroupMember(raw, index));
  if (preferred >= 0) return preferred;
  return raw.findIndex((_segment, index) => index >= start && index < end && !isSectionHeadingCandidate(raw, index) && !isLineGroupMember(raw, index));
}

function isLineGroupMember(raw: readonly { start: number; end: number; text: string }[], index: number): boolean {
  const previousGap = index > 0 ? raw[index].start - raw[index - 1].end : 0;
  const nextGap = index < raw.length - 1 ? raw[index + 1].start - raw[index].end : 0;
  return previousGap === 1 || nextGap === 1;
}

function isEnumerationLead(raw: readonly { start: number; end: number; text: string }[], index: number): boolean {
  const previousGap = index > 0 ? raw[index].start - raw[index - 1].end : 0;
  const nextGap = index < raw.length - 1 ? raw[index + 1].start - raw[index].end : 0;
  return previousGap !== 1 && nextGap === 1 && /:\s*$/u.test(raw[index].text);
}

function isSectionHeadingCandidate(raw: readonly { start: number; end: number; text: string }[], index: number): boolean {
  const value = raw[index]?.text ?? "";
  const wordCount = lexicalWordCount(value);
  if (wordCount <= 0 || wordCount > 14) return false;
  if (upperCaseRatio(value) >= 0.7) return true;
  if (index <= 0 || index >= raw.length - 1 || /[.!?]\s*$/u.test(value)) return false;
  const previous = raw[index - 1]!.text;
  if (lexicalWordCount(previous) > 0 && lexicalWordCount(previous) <= 14 && upperCaseRatio(previous) >= 0.7) return false;
  const previousGap = raw[index]!.start - raw[index - 1]!.end;
  const nextGap = raw[index + 1]!.start - raw[index]!.end;
  return previousGap >= 2 && nextGap >= 2;
}

function upperCaseRatio(value: string): number {
  const letters = [...value].filter((character) => /\p{L}/u.test(character));
  return letters.length ? letters.filter((character) => character === character.toLocaleUpperCase("ru") && character !== character.toLocaleLowerCase("ru")).length / letters.length : 0;
}

export function applySegmentFormattingPlan(text: string, option: FormattingOption, operations: SegmentFormattingOperation[], suppliedSegments?: readonly CanonicalFormattingSegment[]): FormattingApplyResult {
  const segments = suppliedSegments ? [...suppliedSegments] : deriveCanonicalSegments(text);
  if (!segments.length || segments.some((segment) => segment.text !== text.slice(segment.start, segment.end))) return fallback(text, "FORMAT_SEGMENT_SOURCE_MISMATCH", "Formatting segments do not match the canonical draft.");
  if (!operations.every(isSupportedSegmentOperation)) return fallback(text, "FORMAT_SEGMENT_OPERATION_INVALID", "Formatting operation must contain decoration metadata only.");
  const known = new Set(segments.map((segment) => segment.id));
  const used = new Set<string>();
  const assignedRoles = new Map(operations.filter((operation) => operation.kind === "list_decoration").map((operation) => [operation.id, operation.role] as const));
  const sourceTransforms: Array<RenderedCaseTransform & { sourceEnd: number }> = [];
  for (const operation of operations) {
    if (!known.has(operation.id)) return fallback(text, "FORMAT_SEGMENT_UNKNOWN", "Formatting segment is not canonical.");
    const key = operation.id + ":" + operation.kind;
    if (used.has(key)) return fallback(text, "FORMAT_SEGMENT_DUPLICATE", "Duplicate segment decoration is not allowed.");
    used.add(key);
    const segment = segments.find((item) => item.id === operation.id)!;
    if (operation.kind === "list_decoration" && segment.role !== "list_candidate") return fallback(text, "FORMAT_OPTION2_LIST_ROLE_INVALID", "Role assignment is allowed only for an ambiguous canonical list candidate.");
    if (operation.kind === "heading_case") {
      const effectiveRole = assignedRoles.get(segment.id) ?? segment.role;
      if ((effectiveRole !== "main_heading" && effectiveRole !== "section_heading") || operation.mode !== "uppercase") return fallback(text, "FORMAT_OPTION2_HEADING_CASE_ROLE_INVALID", "Heading case transformation is not allowed for this segment.");
      const upper = segment.text.toLocaleUpperCase("ru");
      if (upper.length !== segment.text.length || !sameCaseInsensitiveTokens(segment.text, upper)) return fallback(text, "FORMAT_OPTION2_HEADING_CASE_UNSAFE", "Heading case transformation is not reversibly bounded.");
      sourceTransforms.push({ sourceStart: segment.start, sourceEnd: segment.end, originalText: segment.text, transformedText: upper });
      continue;
    }
    if (operation.kind === "emoji_insertion" && operation.position === "before" && operation.emoji === "🟠" && segment.role === "primary_list") {
      const marker = /^(\s*)(?:-|\*|\u2022|\d+[.)])(\s+)/u.exec(segment.text);
      if (marker) {
        const originalText = marker[0];
        sourceTransforms.push({ sourceStart: segment.start, sourceEnd: segment.start + originalText.length, originalText, transformedText: `${marker[1]}🟠${marker[2]}` });
      }
    }
  }
  sourceTransforms.sort((left, right) => left.sourceStart - right.sourceStart);
  for (let index = 1; index < sourceTransforms.length; index += 1) {
    if (sourceTransforms[index]!.sourceStart < sourceTransforms[index - 1]!.sourceEnd) return fallback(text, "FORMAT_SOURCE_TRANSFORM_OVERLAP", "Source-backed transforms must not overlap.");
  }
  let transformed = "";
  let sourceCursor = 0;
  for (const transform of sourceTransforms) {
    transformed += text.slice(sourceCursor, transform.sourceStart);
    transform.renderedStart = transformed.length;
    transformed += transform.transformedText;
    sourceCursor = transform.sourceEnd;
  }
  transformed += text.slice(sourceCursor);
  const insertions = buildSegmentInsertions(segments, operations, sourceTransforms);
  if (!insertions.ok) return fallback(text, insertions.code, insertions.message);
  let cursor = 0;
  let rendered = "";
  const renderedInsertions: RenderedInsertion[] = [];
  for (const insertion of insertions.value) {
    rendered += transformed.slice(cursor, insertion.sourceIndex);
    renderedInsertions.push({ renderedStart: rendered.length, text: insertion.text });
    rendered += insertion.text;
    cursor = insertion.sourceIndex;
  }
  rendered += transformed.slice(cursor);
  if (!validateTelegramMarkdownFormatting(rendered, renderedInsertions)) return fallback(text, "FORMAT_TELEGRAM_MARKDOWN_INVALID", "Rendered Telegram Markdown is unbalanced.");
  if (recoverCanonicalText(rendered, renderedInsertions, sourceTransforms) !== text) return fallback(text, "FORMAT_LEXICAL_PRESERVATION_FAILED", "Rendered formatting did not preserve the canonical draft.");
  return { ok: true, text: rendered, insertions: renderedInsertions, caseTransforms: sourceTransforms };
}

export function validateTelegramMarkdownFormatting(text: string, generatedInsertions?: readonly RenderedInsertion[]): boolean {
  const generated = generatedInsertions?.map((insertion) => insertion.text).join("") ?? text;
  return (generated.match(/(?<!\\)\*/gu)?.length ?? 0) % 2 === 0
    && (generated.match(/(?<!\\)`/gu)?.length ?? 0) % 2 === 0
    && !/(?<!\\)(?:_|~|\|\|)/u.test(generated);
}

function buildSegmentInsertions(segments: readonly CanonicalFormattingSegment[], operations: readonly SegmentFormattingOperation[], transforms: readonly (RenderedCaseTransform & { sourceEnd: number })[] = []): { ok: true; value: PendingInsertion[] } | Invalid {
  const insertions: PendingInsertion[] = [];
  const emojiByBoundary = new Map<string, { sourceIndex: number; values: string[]; position: "before" | "after" }>();
  for (const operation of operations) {
    if (operation.kind === "heading_case") continue;
    const segment = segments.find((item) => item.id === operation.id)!;
    const sourceIndex = (index: number) => index + transforms.reduce((delta, transform) => transform.sourceEnd <= index ? delta + transform.transformedText.length - transform.originalText.length : delta, 0);
    if (operation.kind === "markdown_span") {
      const marker = operation.style === "bold" ? "**" : "`";
      const trimmed = segment.text.trim();
      if (trimmed.startsWith(marker) && trimmed.endsWith(marker) && trimmed.length > marker.length * 2) continue;
      insertions.push({ sourceIndex: sourceIndex(segment.start), text: marker, category: "markdown_open" }, { sourceIndex: sourceIndex(segment.end), text: marker, category: "markdown_close" });
    } else if (operation.kind === "paragraph_break") {
      insertions.push({ sourceIndex: sourceIndex(operation.position === "before" ? segment.start : segment.end), text: "\n\n", category: "paragraph_break", position: operation.position });
    } else if (operation.kind === "list_marker") {
      const marker = operation.marker === "em_dash" ? "\u2014 " : "- ";
      if (!segment.text.trimStart().startsWith(marker)) return { ok: false, code: "FORMAT_OPTION2_LIST_MARKER_SOURCE_MISMATCH", message: "List marker metadata must match existing canonical punctuation." };
    } else if (operation.kind === "list_decoration") {
      if (operation.role === "section_heading") continue;
      const marker = operation.role === "primary_list" ? "\uD83D\uDFE0 " : "\u2014 ";
      insertions.push({ sourceIndex: sourceIndex(segment.start), text: marker, category: operation.role === "primary_list" ? "emoji_insertion" : "list_marker", position: "before" });
    } else {
      const markerReplaced = operation.kind === "emoji_insertion" && operation.position === "before" && operation.emoji === "🟠" && segment.role === "primary_list" && transforms.some((transform) => transform.sourceStart === segment.start);
      if (markerReplaced) continue;
      const boundaryIndex = sourceIndex(operation.position === "before" ? segment.start : segment.end);
      const boundary = boundaryIndex + ":" + operation.position;
      const group = emojiByBoundary.get(boundary) ?? { sourceIndex: boundaryIndex, values: [], position: operation.position };
      group.values.push(operation.emoji);
      emojiByBoundary.set(boundary, group);
    }
  }
  for (const group of emojiByBoundary.values()) insertions.push({ sourceIndex: group.sourceIndex, text: group.values.join(" ") + " ", category: "emoji_insertion", position: group.position });
  insertions.sort((left, right) => left.sourceIndex - right.sourceIndex || insertionOrder(left) - insertionOrder(right) || left.text.localeCompare(right.text));
  return { ok: true, value: insertions };
}

function isHeadingCandidate(value: string): boolean {
  const trimmed = value.trim();
  return !trimmed.includes("\n") && lexicalWordCount(trimmed) > 0 && lexicalWordCount(trimmed) <= 14 && !/[.!?]\s*$/u.test(trimmed) && !/^(?:[-\u2013\u2014\u2022#`]|\d+[.)]\s)/u.test(trimmed);
}

function isCtaCandidate(value: string): boolean {
  return /^(?:подпишитесь|напишите|сохраните|переходите|присоединяйтесь|попробуйте|заберите|скачайте|оставьте|поделитесь|register|join|subscribe|try|download)(?=\s|[.!?:;,-]|$)/iu.test(value);
}

function lexicalWordCount(value: string): number {
  return [...value.matchAll(/[\p{L}\p{N}]+/gu)].length;
}

function sameCaseInsensitiveTokens(left: string, right: string): boolean {
  const normalize = (value: string) => [...value.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => match[0].toLocaleLowerCase("ru"));
  const leftTokens = normalize(left);
  const rightTokens = normalize(right);
  return leftTokens.length === rightTokens.length && leftTokens.every((value, index) => value === rightTokens[index]);
}

function isSupportedSegmentOperation(value: unknown): value is SegmentFormattingOperation {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.kind !== "string") return false;
  const keys = Object.keys(value).sort().join(",");
  if (value.kind === "paragraph_break") return keys === "id,kind,position" && (value.position === "before" || value.position === "after");
  if (value.kind === "emoji_insertion" || value.kind === "semantic_accent") return keys === "emoji,id,kind,position" && typeof value.emoji === "string" && (value.position === "before" || value.position === "after");
  if (value.kind === "markdown_span") return keys === "id,kind,style" && (value.style === "bold" || value.style === "code");
  if (value.kind === "heading_case") return keys === "id,kind,mode" && value.mode === "uppercase";
  if (value.kind === "list_marker") return keys === "id,kind,marker" && (value.marker === "dash" || value.marker === "em_dash");
  return value.kind === "list_decoration" && keys === "id,kind,role" && (value.role === "primary_list" || value.role === "nested_list" || value.role === "section_heading");
}
