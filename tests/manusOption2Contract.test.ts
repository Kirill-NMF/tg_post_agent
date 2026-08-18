import { describe, expect, it } from "vitest";
import {
  applySegmentFormattingPlan,
  deriveCanonicalSegments,
  recoverCanonicalText,
  type CanonicalFormattingSegment,
  validateTelegramMarkdownFormatting,
} from "../src/domain/formatting.js";
import {
  FormattingPlanValidationError,
  buildOption2SegmentPrompt,
  option2SegmentPlanSchema,
  parseOption2SegmentPlan,
} from "../src/adapters/openRouterFormattingAdapter.js";

const longDraft = [
  "главный заголовок",
  "Вводный абзац сохраняет каждое слово и пунктуацию.",
  "ВАЖНЫЙ РАЗДЕЛ",
  "- Первый основной пункт.",
  "— Вложенное пояснение.",
  "`Скопируйте пример команды.`",
  "Что выберете?",
].join("\n\n");

function validPlan() {
  return {
    primaryEmoji: { id: "block_2", kind: "emoji_insertion", position: "before", emoji: "📜" },
    operations: [
      { id: "block_1", kind: "heading_case", mode: "uppercase" },
      { id: "block_1", kind: "markdown_span", style: "bold" },
      { id: "block_3", kind: "markdown_span", style: "bold" },
      { id: "block_3", kind: "emoji_insertion", position: "before", emoji: "⏸" },
      { id: "block_3", kind: "semantic_accent", position: "before", emoji: "✉️" },
      { id: "block_4", kind: "emoji_insertion", position: "before", emoji: "🟠" },
      { id: "block_5", kind: "list_marker", marker: "em_dash" },
      { id: "block_6", kind: "markdown_span", style: "code" },
      { id: "block_6", kind: "emoji_insertion", position: "before", emoji: "🔅" },
      { id: "block_7", kind: "emoji_insertion", position: "before", emoji: "➡️" },
    ],
  };
}

describe("Manus Option2 role contract", () => {
  it("derives stable roles for a seven-segment production-shaped draft", () => {
    expect(deriveCanonicalSegments(longDraft).map((segment) => segment.role)).toEqual([
      "main_heading",
      "intro",
      "section_heading",
      "primary_list",
      "nested_list",
      "prompt_code",
      "audience_question",
    ]);
  });

  it("uses one closed provider schema with exact Manus operation branches", () => {
    const serialized = JSON.stringify(option2SegmentPlanSchema);
    expect(serialized).toContain('"heading_case"');
    expect(serialized).toContain('"list_marker"');
    expect(serialized).toContain('"semantic_accent"');
    expect(serialized).not.toContain('"italic"');
    expectEveryObjectClosed(option2SegmentPlanSchema);
  });

  it("builds a concise role-constrained prompt with canonical segments but no output text fields", () => {
    const prompt = buildOption2SegmentPrompt(deriveCanonicalSegments(longDraft), 30);
    expect(prompt).toContain("primary-gold-first");
    expect(prompt).toContain("main_heading");
    expect(prompt).toContain("section_heading");
    expect(prompt).toContain("Preserve every word, punctuation mark, and order");
    expect(prompt).toContain("exact segment ID and contextual marker variant exposed by the schema");
    expect(prompt).toContain("Never invent CTA, audience-question, or hashtag words");
    expect(prompt).not.toContain("post_10");
    expect(JSON.stringify(option2SegmentPlanSchema)).not.toMatch(/anchor|text|replacement/i);
  });

  it("parses and applies the complete seven-segment contract reversibly", () => {
    const segments = deriveCanonicalSegments(longDraft);
    const directives = parseOption2SegmentPlan(JSON.stringify(validPlan()), segments);
    const rendered = applySegmentFormattingPlan(longDraft, "option_2", directives, segments);

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.text).toContain("*ГЛАВНЫЙ ЗАГОЛОВОК*");
    expect(rendered.text).toContain("⏸");
    expect(rendered.text).toContain("🟠");
    expect(rendered.text).toContain("🔅");
    expect(rendered.text).toContain("➡");
    expect(validateTelegramMarkdownFormatting(rendered.text)).toBe(true);
    expect(recoverCanonicalText(rendered.text, rendered.insertions, rendered.caseTransforms)).toBe(longDraft);
  });

  it("server-completes deterministic required role decorations omitted by the provider", () => {
    const segments = deriveCanonicalSegments(longDraft);
    const directives = parseOption2SegmentPlan(JSON.stringify({
      primaryEmoji: { id: "block_2", kind: "emoji_insertion", position: "before", emoji: "📜" },
      operations: [],
    }), segments);

    expect(directives).toHaveLength(10);
    expect(directives).toEqual(expect.arrayContaining([
      { id: "block_1", kind: "heading_case", mode: "uppercase" },
      { id: "block_1", kind: "markdown_span", style: "bold" },
      { id: "block_3", kind: "markdown_span", style: "bold" },
      { id: "block_3", kind: "heading_case", mode: "uppercase" },
      { id: "block_3", kind: "emoji_insertion", position: "before", emoji: "⏸" },
      { id: "block_4", kind: "emoji_insertion", position: "before", emoji: "🟠" },
      { id: "block_6", kind: "markdown_span", style: "code" },
      { id: "block_7", kind: "emoji_insertion", position: "before", emoji: "➡" },
    ]));
    const rendered = applySegmentFormattingPlan(longDraft, "option_2", directives, segments);
    expect(rendered.ok).toBe(true);
    if (rendered.ok) expect(recoverCanonicalText(rendered.text, rendered.insertions, rendered.caseTransforms)).toBe(longDraft);
  });

  it("turns an ambiguous segment role assignment into source-backed section formatting", () => {
    const draft = `MAIN TITLE

This deliberately long introductory paragraph contains more than fourteen lexical words and ends as a sentence.

Section before body
Ordinary body sentence.`;
    const segments = deriveCanonicalSegments(draft);
    expect(segments[2]?.role).toBe("list_candidate");
    const directives = parseOption2SegmentPlan(JSON.stringify({
      primaryEmoji: { id: "block_2", kind: "emoji_insertion", position: "before", emoji: "📜" },
      operations: [{ id: "block_3", kind: "list_decoration", role: "section_heading" }],
    }), segments);

    expect(directives).toEqual(expect.arrayContaining([
      { id: "block_3", kind: "heading_case", mode: "uppercase" },
      { id: "block_3", kind: "markdown_span", style: "bold" },
      { id: "block_3", kind: "emoji_insertion", position: "before", emoji: "⏸" },
    ]));
    const rendered = applySegmentFormattingPlan(draft, "option_2", directives, segments);
    expect(rendered).toMatchObject({ ok: true });
    if (rendered.ok) {
      expect(rendered.text).toContain("⏸ *SECTION BEFORE BODY*");
      expect(recoverCanonicalText(rendered.text, rendered.insertions, rendered.caseTransforms)).toBe(draft);
    }
  });

  it("budgets server-owned required roles separately from a bounded production-shaped provider plan", () => {
    const roles: CanonicalFormattingSegment["role"][] = [
      "main_heading", "intro",
      ...Array(4).fill("section_heading"),
      ...Array(4).fill("primary_list"),
      ...Array(16).fill("nested_list"),
      ...Array(2).fill("prompt_code"),
      "cta", "audience_question",
      ...Array(8).fill("paragraph"),
    ];
    const { draft, segments } = syntheticSegments(roles);
    const operations = segments.slice(0, 15).map((segment) => ({ id: segment.id, kind: "paragraph_break" as const, position: "after" as const }));
    const directives = parseOption2SegmentPlan(JSON.stringify({
      primaryEmoji: { id: "block_2", kind: "emoji_insertion", position: "before", emoji: "\uD83D\uDCDC" },
      operations,
    }), segments, 30);

    expect(directives).toHaveLength(40);
    const rendered = applySegmentFormattingPlan(draft, "option_2", directives, segments);
    expect(rendered.ok).toBe(true);
    if (rendered.ok) expect(recoverCanonicalText(rendered.text, rendered.insertions, rendered.caseTransforms)).toBe(draft);
  });

  it("still rejects more than thirty provider-supplied directives", () => {
    const segments = deriveCanonicalSegments(longDraft);
    const operations = Array.from({ length: 30 }, (_, index) => ({
      id: segments[index % segments.length]!.id,
      kind: "paragraph_break",
      position: "after",
    }));
    expectCode(() => parseOption2SegmentPlan(JSON.stringify({ primaryEmoji: validPlan().primaryEmoji, operations }), segments, 30), "FORMAT_PLAN_OPERATION_LIMIT_EXCEEDED");
  });

  it("treats list-marker metadata as a declaration and never duplicates punctuation", () => {
    const segments = deriveCanonicalSegments(longDraft);
    const directives = parseOption2SegmentPlan(JSON.stringify(validPlan()), segments);
    const rendered = applySegmentFormattingPlan(longDraft, "option_2", directives, segments);
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.text).not.toContain("— —");
    expect(recoverCanonicalText(rendered.text, rendered.insertions, rendered.caseTransforms)).toBe(longDraft);
  });

  it("rejects list-marker metadata that disagrees with canonical punctuation", () => {
    const plan = validPlan();
    plan.operations = plan.operations.map((operation) => operation.kind === "list_marker" ? { ...operation, marker: "dash" } : operation) as typeof plan.operations;
    expectCode(() => parseOption2SegmentPlan(JSON.stringify(plan), deriveCanonicalSegments(longDraft)), "FORMAT_SEGMENT_PLAN_SCHEMA_INVALID");
  });

  it("assigns CTA only from an existing lexical CTA line", () => {
    const roles = deriveCanonicalSegments("Заголовок\n\nВводный текст.\n\nСохраните этот пост.\n\nЧто выберете?").map((segment) => segment.role);
    expect(roles).toEqual(["main_heading", "intro", "cta", "audience_question"]);
    const nonCta = deriveCanonicalSegments("Заголовок\n\nВводный текст.\n\nОбычный короткий абзац.\n\nЧто выберете?").map((segment) => segment.role);
    expect(nonCta).toEqual(["main_heading", "intro", "paragraph", "audience_question"]);
  });

  it("permits reversible uppercase only on inferred heading roles", () => {
    const segments = deriveCanonicalSegments(longDraft);
    expectCode(
      () => parseOption2SegmentPlan(JSON.stringify({ ...validPlan(), operations: validPlan().operations.map((operation) => operation.kind === "heading_case" ? { ...operation, id: "block_2" } : operation) }), segments),
      "FORMAT_OPTION2_HEADING_CASE_ROLE_INVALID",
    );
  });

  it.each([
    ["wrong role anchor", { id: "block_2", kind: "emoji_insertion", position: "before", emoji: "🔥" }, "FORMAT_SEGMENT_PLAN_SCHEMA_INVALID"],
    ["random semantic emoji", { id: "block_3", kind: "semantic_accent", position: "before", emoji: "🚀" }, "FORMAT_OPTION2_SEMANTIC_ACCENT_INVALID"],
    ["code on prose", { id: "block_2", kind: "markdown_span", style: "code" }, "FORMAT_OPTION2_CODE_ROLE_INVALID"],
    ["list marker on heading", { id: "block_3", kind: "list_marker", marker: "dash" }, "FORMAT_SEGMENT_PLAN_SCHEMA_INVALID"],
  ])("rejects %s", (_label, invalidOperation, code) => {
    const plan = validPlan();
    if (invalidOperation.kind === "emoji_insertion" && invalidOperation.id === plan.primaryEmoji.id) plan.primaryEmoji = invalidOperation as typeof plan.primaryEmoji;
    else {
      plan.operations = plan.operations.filter((operation) => operation.id !== invalidOperation.id || operation.kind  !== invalidOperation.kind) as typeof plan.operations;
      plan.operations.push(invalidOperation as never);
    }
    expectCode(() => parseOption2SegmentPlan(JSON.stringify(plan), deriveCanonicalSegments(longDraft)), code);
  });

  it("rejects over-density of semantic accents", () => {
    const draft = ["заголовок", "Вводный текст.", "РАЗДЕЛ ОДИН", "Абзац.", "РАЗДЕЛ ДВА", "Другой абзац.", "РАЗДЕЛ ТРИ"].join("\n\n");
    const segments = deriveCanonicalSegments(draft);
    const plan = {
      primaryEmoji: { id: "block_2", kind: "emoji_insertion", position: "before", emoji: "📜" },
      operations: [
        { id: "block_1", kind: "heading_case", mode: "uppercase" },
        { id: "block_1", kind: "markdown_span", style: "bold" },
        ...["block_3", "block_5", "block_7"].flatMap((id) => [
          { id, kind: "markdown_span", style: "bold" },
          { id, kind: "emoji_insertion", position: "before", emoji: "⏸" },
          { id, kind: "semantic_accent", position: "before", emoji: "✉️" },
        ]),
      ],
    };
    expectCode(() => parseOption2SegmentPlan(JSON.stringify(plan), segments), "FORMAT_OPTION2_SEMANTIC_ACCENT_DENSITY_EXCEEDED");
  });

  it.each([
    ["missing required heading case", { removeKind: "heading_case" }],
    ["missing section pause", { removeId: "block_3", removeKind: "emoji_insertion" }],
    ["missing intro anchor", { replacePrimary: { id: "block_4", kind: "emoji_insertion", position: "before", emoji: "🟠" } }],
  ])("server-completes an incomplete deterministic role contract: %s", (_label, mutation) => {
    const plan = validPlan();
    if ("removeKind" in mutation && mutation.removeKind) plan.operations = plan.operations.filter((operation) => operation.kind !== mutation.removeKind) as typeof plan.operations;
    if ("removeId" in mutation && mutation.removeId) plan.operations = plan.operations.filter((operation) => operation.id !== mutation.removeId || operation.kind !== mutation.removeKind) as typeof plan.operations;
    if ("replacePrimary" in mutation && mutation.replacePrimary) {
      plan.primaryEmoji = mutation.replacePrimary;
      plan.operations = plan.operations.filter((operation) => operation.id !== mutation.replacePrimary.id || operation.kind !== mutation.replacePrimary.kind) as typeof plan.operations;
    }
    const directives = parseOption2SegmentPlan(JSON.stringify(plan), deriveCanonicalSegments(longDraft));
    expect(directives).toEqual(expect.arrayContaining([
      { id: "block_1", kind: "heading_case", mode: "uppercase" },
      { id: "block_1", kind: "markdown_span", style: "bold" },
      { id: "block_3", kind: "markdown_span", style: "bold" },
      { id: "block_3", kind: "emoji_insertion", position: "before", emoji: "⏸" },
      { id: "block_2", kind: "emoji_insertion", position: "before", emoji: "📜" },
      { id: "block_4", kind: "emoji_insertion", position: "before", emoji: "🟠" },
      { id: "block_6", kind: "emoji_insertion", position: "before", emoji: "🔅" },
      { id: "block_6", kind: "markdown_span", style: "code" },
      { id: "block_7", kind: "emoji_insertion", position: "before", emoji: "➡" },
    ]));
  });

  it.each([
    { primaryEmoji: validPlan().primaryEmoji, operations: [{ id: "block_1", kind: "markdown_span", style: "italic" }] },
    { primaryEmoji: validPlan().primaryEmoji, operations: [{ id: "block_2", kind: "emoji_insertion", position: "before", emoji: "📜", replacement: "words" }] },
    { primaryEmoji: validPlan().primaryEmoji, operations: [], hashtags: ["invented"] },
    { primaryEmoji: validPlan().primaryEmoji, operations: [], cta: "invented" },
  ])("rejects forbidden style or invented lexical fields at shape validation", (plan) => {
    expectCode(() => parseOption2SegmentPlan(JSON.stringify(plan), deriveCanonicalSegments(longDraft)), "FORMAT_SEGMENT_PLAN_SCHEMA_INVALID");
  });

  it("does not reinterpret canonical punctuation as formatter-generated style", () => {
    const draft = "Заголовок\n\nВводный_текст | ~ знак.";
    const segments = deriveCanonicalSegments(draft);
    const plan = {
      primaryEmoji: { id: "block_2", kind: "emoji_insertion", position: "before", emoji: "📜" },
      operations: [
        { id: "block_1", kind: "heading_case", mode: "uppercase" },
        { id: "block_1", kind: "markdown_span", style: "bold" },
      ],
    };
    const directives = parseOption2SegmentPlan(JSON.stringify(plan), segments);
    const rendered = applySegmentFormattingPlan(draft, "option_2", directives, segments);
    expect(rendered.ok).toBe(true);
    if (rendered.ok) expect(recoverCanonicalText(rendered.text, rendered.insertions, rendered.caseTransforms)).toBe(draft);
  });

  it("preserves hashtag words and punctuation rather than inventing or rewriting them", () => {
    const draft = "заголовок\n\nВводный текст.\n\n#навигация";
    const segments = deriveCanonicalSegments(draft);
    const plan = {
      primaryEmoji: { id: "block_2", kind: "emoji_insertion", position: "before", emoji: "📜" },
      operations: [
        { id: "block_1", kind: "heading_case", mode: "uppercase" },
        { id: "block_1", kind: "markdown_span", style: "bold" },
      ],
    };
    const directives = parseOption2SegmentPlan(JSON.stringify(plan), segments);
    const rendered = applySegmentFormattingPlan(draft, "option_2", directives, segments);
    expect(rendered.ok).toBe(true);
    if (rendered.ok) expect(recoverCanonicalText(rendered.text, rendered.insertions, rendered.caseTransforms)).toBe(draft);
  });
});

function expectCode(action: () => unknown, expected: string): void {
  try {
    action();
    throw new Error("expected validation failure");
  } catch (error) {
    expect(error).toBeInstanceOf(FormattingPlanValidationError);
    expect((error as FormattingPlanValidationError).code).toBe(expected);
  }
}

function syntheticSegments(roles: readonly CanonicalFormattingSegment["role"][]): { draft: string; segments: CanonicalFormattingSegment[] } {
  const texts = roles.map((_, index) => `Synthetic block ${index + 1}.`);
  const draft = texts.join("\n\n");
  let cursor = 0;
  const segments = texts.map((text, index) => {
    const start = cursor;
    const end = start + text.length;
    cursor = end + 2;
    return { id: `block_${index + 1}`, start, end, text, role: roles[index]! };
  });
  return { draft, segments };
}

function expectEveryObjectClosed(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const object = value as Record<string, unknown>;
  if (object.type === "object") expect(object.additionalProperties).toBe(false);
  for (const child of Object.values(object)) {
    if (Array.isArray(child)) child.forEach(expectEveryObjectClosed);
    else expectEveryObjectClosed(child);
  }
}
