import { describe, expect, it } from "vitest";
import { applyFormattingPlan, applySegmentFormattingPlan, deriveCanonicalSegments, recoverCanonicalText, type FormattingDecorationPlan } from "../src/domain/formatting.js";

describe("formatting decoration plans", () => {
  const source = "Alpha one.\n\nBeta two.";

  it("renders Option 1 as insert-only readability decoration with no expressive emoji", () => {
    const result = applyFormattingPlan(source, {
      option: "option_1",
      operations: [{ kind: "markdown_span", anchor: { text: "Alpha", occurrence: 0 }, style: "bold" }]
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.text).toBe("*Alpha* one.\n\nBeta two.");
    expect(result.text).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(recoverCanonicalText(result.text, result.insertions)).toBe(source);
  });

  it("renders Option 2 with emoji insertion while preserving canonical lexical text", () => {
    const result = applyFormattingPlan(source, {
      option: "option_2",
      operations: [
        { kind: "emoji_insertion", anchor: { text: "Alpha", occurrence: 0 }, position: "before", emoji: "\u{1f4a1}" },
        { kind: "paragraph_break", anchor: { text: "Beta", occurrence: 0 }, position: "before" }
      ]
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.text).toContain("\u{1f4a1}Alpha one.");
    expect(recoverCanonicalText(result.text, result.insertions)).toBe(source);
  });

  it.each([
    { label: "deleting operation", plan: { option: "option_2", operations: [{ kind: "delete", anchor: { text: "Alpha", occurrence: 0 } }] } },
    { label: "reordering operation", plan: { option: "option_2", operations: [{ kind: "reorder", anchors: [] }] } },
    { label: "ambiguous anchor", plan: { option: "option_2", operations: [{ kind: "emoji_insertion", anchor: { text: "Alpha" }, position: "after", emoji: "\u{1f4a1}" }] } },
    { label: "Option 1 emoji", plan: { option: "option_1", operations: [{ kind: "emoji_insertion", anchor: { text: "Alpha", occurrence: 0 }, position: "after", emoji: "\u{1f4a1}" }] } },
  ])("rejects $label and returns the original draft unchanged", ({ plan }) => {
    const result = applyFormattingPlan(source, plan as unknown as FormattingDecorationPlan);
    expect(result.ok).toBe(false);
    expect(result.text).toBe(source);
  });

  it("composes an Option 2 emoji and paragraph break at one anchor in stable order", () => {
    const canonical = "Alpha. Beta.";
    const result = applyFormattingPlan(canonical, {
      option: "option_2",
      operations: [
        { kind: "paragraph_break", anchor: { text: "Alpha.", occurrence: 0 }, position: "after" },
        { kind: "emoji_insertion", anchor: { text: "Alpha.", occurrence: 0 }, position: "after", emoji: "\u{1f4a1}" }
      ]
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.text).toBe("Alpha.\u{1f4a1}\n\n Beta.");
    expect(recoverCanonicalText(result.text, result.insertions)).toBe(canonical);
  });

  it("rejects duplicate decorations at one boundary and retains canonical text", () => {
    const result = applyFormattingPlan(source, {
      option: "option_2",
      operations: [
        { kind: "paragraph_break", anchor: { text: "Alpha", occurrence: 0 }, position: "after" },
        { kind: "paragraph_break", anchor: { text: "Alpha", occurrence: 0 }, position: "after" }
      ]
    });

    expect(result).toMatchObject({ ok: false, code: "FORMAT_INSERTION_CONFLICT", text: source });
  });

  it("fails closed when rendered presentation cannot be removed at the recorded anchors", () => {
    const result = applyFormattingPlan(source, {
      option: "option_1",
      operations: [{ kind: "markdown_span", anchor: { text: "Alpha", occurrence: 0 }, style: "bold" }]
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(recoverCanonicalText(result.text.replace("*", ""), result.insertions)).toBeUndefined();
  });

  it("uses stable server-derived segment ids without model text anchors", () => {
    const segments = deriveCanonicalSegments("Alpha.\n\nBeta.");
    expect(segments.map((segment) => segment.id)).toEqual(["block_1", "block_2"]);
    const result = applySegmentFormattingPlan("Alpha.\n\nBeta.", "option_2", [{ id: "block_1", kind: "emoji_insertion", position: "before", emoji: "✨" }, { id: "block_2", kind: "paragraph_break", position: "before" }]);
    expect(result.ok).toBe(true); if (result.ok) expect(recoverCanonicalText(result.text, result.insertions)).toBe("Alpha.\n\nBeta.");
  });
  it("rejects unknown or duplicate segment ids and preserves canonical text", () => {
    expect(applySegmentFormattingPlan("Only.", "option_2", [{ id: "block_9", kind: "paragraph_break", position: "after" }])).toMatchObject({ ok: false, code: "FORMAT_SEGMENT_UNKNOWN", text: "Only." });
    expect(applySegmentFormattingPlan("Only.", "option_2", [{ id: "block_1", kind: "paragraph_break", position: "after" }, { id: "block_1", kind: "paragraph_break", position: "before" }])).toMatchObject({ ok: false, code: "FORMAT_SEGMENT_DUPLICATE", text: "Only." });
  });
  it("segments empty and one-block drafts deterministically", () => {
    expect(deriveCanonicalSegments("")).toEqual([]); expect(deriveCanonicalSegments("Only.").map((segment) => segment.id)).toEqual(["block_1"]);
  });

  it("classifies an isolated short title-case line as a section heading", () => {
    const segments = deriveCanonicalSegments(`Главный заголовок

Вводный абзац заканчивается точкой.

Раздел о практике

Основной абзац заканчивается точкой.`);

    expect(segments.map((segment) => segment.role)).toEqual([
      "main_heading",
      "intro",
      "section_heading",
      "paragraph",
    ]);
  });

  it("keeps a paragraph-leading title-case line ambiguous for a typed provider role assignment", () => {
    const segments = deriveCanonicalSegments(`Главный заголовок

Вводный абзац заканчивается точкой.

Раздел перед содержанием
Основной абзац достаточно длинный и заканчивается точкой.`);

    expect(segments[2]?.role).toBe("list_candidate");
  });

  it("uppercases section headings and replaces a canonical bullet from source reversibly", () => {
    const canonical = `Главный заголовок

Вводный абзац заканчивается точкой.

Раздел перед списком

• Первый пункт`;
    const segments = deriveCanonicalSegments(canonical);
    const section = segments[2]!;
    const item = segments.find((segment) => segment.role === "primary_list")!;
    const result = applySegmentFormattingPlan(canonical, "option_2", [
      { id: section.id, kind: "heading_case", mode: "uppercase" },
      { id: section.id, kind: "markdown_span", style: "bold" },
      { id: section.id, kind: "emoji_insertion", position: "before", emoji: "⏸" },
      { id: item.id, kind: "emoji_insertion", position: "before", emoji: "🟠" },
    ], segments);

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.text).toContain("**РАЗДЕЛ ПЕРЕД СПИСКОМ**");
    expect(result.text).toContain("🟠 Первый пункт");
    expect(result.text).not.toContain("🟠 •");
    expect(recoverCanonicalText(result.text, result.insertions, result.caseTransforms)).toBe(canonical);
  });

  it("does not classify an isolated sentence as a section heading", () => {
    const segments = deriveCanonicalSegments(`Главный заголовок

Это короткое предложение.

Основной абзац заканчивается точкой.`);

    expect(segments[1]?.role).not.toBe("section_heading");
  });
});
