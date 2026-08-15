import { describe, expect, it } from "vitest";
import { applyFormattingPlan, recoverCanonicalText, type FormattingDecorationPlan } from "../src/domain/formatting.js";

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
});
