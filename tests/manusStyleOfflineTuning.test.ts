import { describe, expect, it } from "vitest";
import {
  deformatGold,
  evaluateManusStyle,
} from "../src/evaluation/manusStyleEvaluator.js";
import {
  applySegmentFormattingPlan,
  deriveCanonicalSegments,
  recoverCanonicalText,
} from "../src/domain/formatting.js";
import {
  buildOption2SegmentPlanSchema,
  parseOption2SegmentPlan,
} from "../src/adapters/openRouterFormattingAdapter.js";

describe("Manus offline tuning regressions", () => {
  it("treats Telegram single-star bold as bold rather than punctuation or italic", () => {
    const gold = [
      "**MAIN TITLE**",
      "",
      "⏸ **SECTION TITLE**",
      "",
      "📜 Intro sentence.",
    ].join("\n");
    const candidate = gold.replaceAll("**", "*");
    const result = evaluateManusStyle(deformatGold(gold).plainText, gold, candidate, 0);

    expect(result.hardGates.punctuationPreserved).toBe(true);
    expect(result.hardGates.forbiddenStylesZero).toBe(true);
    expect(result.hardGates.markdownBalanced).toBe(true);
    expect(result.metrics.heading.f1).toBe(1);
    expect(result.metrics.section.f1).toBe(1);
    expect(result.metrics.bold.f1).toBe(1);
    expect(result.metrics.roles.main_heading.f1).toBe(1);
    expect(result.metrics.roles.section_heading.f1).toBe(1);
    expect(result.metrics.weightedContributions.heading).toBe(0.12);
  });

  it("keeps underscore italic forbidden after accepting Telegram bold", () => {
    const gold = "**MAIN TITLE**\n\n📜 Intro sentence.";
    const candidate = "*MAIN TITLE*\n\n📜 _Intro_ sentence.";
    const result = evaluateManusStyle(deformatGold(gold).plainText, gold, candidate, 0);
    expect(result.hardGates.forbiddenStylesZero).toBe(false);
  });

  it("derives conservative line-scoped roles for production-shaped long form", () => {
    const draft = [
      "MAIN TITLE",
      "Short opening sentence.",
      "Another opening sentence.",
      "This deliberately long introductory paragraph contains more than fourteen lexical words and ends as a sentence.",
      "SECTION ONE",
      "Ordinary short fragment",
      "List group lead\nNested detail one.\nNested detail two.",
      "SECTION TWO.",
      "Ordinary body sentence.",
      "Subscribe now.",
      "What will you choose?",
      "#navigation",
    ].join("\n\n");

    expect(deriveCanonicalSegments(draft).map((segment) => segment.role)).toEqual([
      "main_heading",
      "paragraph",
      "paragraph",
      "intro",
      "section_heading",
      "paragraph",
      "list_candidate",
      "list_candidate",
      "list_candidate",
      "section_heading",
      "paragraph",
      "cta",
      "audience_question",
      "hashtag_footer",
    ]);
  });

  it("classifies only a colon-terminated group lead as a deterministic primary list anchor", () => {
    const draft = [
      "MAIN TITLE",
      "This deliberately long introductory paragraph contains more than fourteen lexical words and ends as a sentence.",
      "Available paths:\nFirst path keeps the current approach.\nSecond path changes the approach.",
      "Ordinary lead line\nOrdinary continuation line.",
      "Ambiguous lead;\nAmbiguous continuation line.",
      "What will you choose?",
    ].join("\n\n");

    const segments = deriveCanonicalSegments(draft);
    expect(segments.map((segment) => segment.role)).toEqual([
      "main_heading",
      "intro",
      "primary_list",
      "list_candidate",
      "list_candidate",
      "list_candidate",
      "list_candidate",
      "list_candidate",
      "list_candidate",
      "audience_question",
    ]);
    const intro = segments.find((segment) => segment.role === "intro")!;
    const directives = parseOption2SegmentPlan(JSON.stringify({
      primaryEmoji: { id: intro.id, kind: "emoji_insertion", position: "before", emoji: "📜" },
      operations: [],
    }), segments);
    expect(directives).toEqual(expect.arrayContaining([
      { id: "block_3", kind: "emoji_insertion", position: "before", emoji: "🟠" },
    ]));
    const rendered = applySegmentFormattingPlan(draft, "option_2", directives, segments);
    expect(rendered.ok).toBe(true);
    if (rendered.ok) expect(recoverCanonicalText(rendered.text, rendered.insertions, rendered.caseTransforms)).toBe(draft);
  });

  it("applies typed primary and nested list decorations without lexical or punctuation mutation", () => {
    const draft = [
      "MAIN TITLE",
      "This deliberately long introductory paragraph contains more than fourteen lexical words and ends as a sentence.",
      "List group lead\nNested detail one.\nNested detail two.",
      "What will you choose?",
    ].join("\n\n");
    const segments = deriveCanonicalSegments(draft);
    const listSegments = segments.filter((segment) => segment.role === "list_candidate");
    const plan = {
      primaryEmoji: { id: segments.find((segment) => segment.role === "intro")!.id, kind: "emoji_insertion", position: "before", emoji: "📜" },
      operations: [
        { id: listSegments[0]!.id, kind: "list_decoration", role: "primary_list" },
        { id: listSegments[1]!.id, kind: "list_decoration", role: "nested_list" },
        { id: listSegments[2]!.id, kind: "list_decoration", role: "nested_list" },
      ],
    };
    const directives = parseOption2SegmentPlan(JSON.stringify(plan), segments);
    const rendered = applySegmentFormattingPlan(draft, "option_2", directives, segments);

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.text).toContain("🟠 List group lead");
    expect(rendered.text).toContain("— Nested detail one.");
    expect(recoverCanonicalText(rendered.text, rendered.insertions, rendered.caseTransforms)).toBe(draft);
    const evaluation = evaluateManusStyle(draft, rendered.text, rendered.text, 0);
    expect(evaluation.hardGates.lexicalSequenceExact).toBe(true);
    expect(evaluation.hardGates.punctuationPreserved).toBe(true);
  });

  it("keeps list decoration schema closed and rejects non-candidate targets", () => {
    const draft = "MAIN TITLE\n\nThis deliberately long introductory paragraph contains more than fourteen lexical words and ends as a sentence.\n\nOrdinary body sentence.\n\nWhat will you choose?";
    const segments = deriveCanonicalSegments(draft);
    const schema = JSON.stringify(buildOption2SegmentPlanSchema(segments));
    expect(schema).toContain("list_decoration");
    try {
      parseOption2SegmentPlan(JSON.stringify({
        primaryEmoji: { id: segments[1]!.id, kind: "emoji_insertion", position: "before", emoji: "📜" },
        operations: [{ id: segments[2]!.id, kind: "list_decoration", role: "primary_list" }],
      }), segments);
      throw new Error("expected validation failure");
    } catch (error) {
      expect(error).toMatchObject({ code: "FORMAT_OPTION2_LIST_ROLE_INVALID" });
    }
  });
});
