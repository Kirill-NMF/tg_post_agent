import type { FormattingOption } from "./types.js";

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

export type FormattingApplyResult =
  | { ok: true; text: string; insertions: RenderedInsertion[] }
  | { ok: false; code: string; message: string; text: string };

type ResolvedOperation =
  | { kind: "paragraph_break" | "emoji_insertion"; sourceIndex: number; text: string; position: "before" | "after" }
  | { kind: "markdown_span"; start: number; end: number; marker: string };

type PendingInsertion = {
  sourceIndex: number;
  text: string;
  category: "paragraph_break" | "emoji_insertion" | "markdown_open" | "markdown_close";
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

  return { ok: true, text, insertions: renderedInsertions };
}

export function recoverCanonicalText(renderedText: string, insertions: RenderedInsertion[]): string | undefined {
  let recovered = renderedText;
  for (const insertion of [...insertions].sort((left, right) => right.renderedStart - left.renderedStart)) {
    if (recovered.slice(insertion.renderedStart, insertion.renderedStart + insertion.text.length) !== insertion.text) {
      return undefined;
    }
    recovered = recovered.slice(0, insertion.renderedStart) + recovered.slice(insertion.renderedStart + insertion.text.length);
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
    if (typeof operation.emoji !== "string" || !isExpressiveEmoji(operation.emoji)) {
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

function isExpressiveEmoji(value: string): boolean {
  return value.length <= 16 && /[^\p{ASCII}]/u.test(value) && !/[\p{L}\p{N}\s]/u.test(value);
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
