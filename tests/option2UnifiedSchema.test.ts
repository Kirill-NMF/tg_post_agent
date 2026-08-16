import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import { applySegmentFormattingPlan, recoverCanonicalText } from "../src/domain/formatting.js";
import {
  FormattingPlanValidationError,
  option2SegmentPlanSchema,
  parseOption2SegmentPlan
} from "../src/adapters/openRouterFormattingAdapter.js";

const primaryEmoji = (emoji = "\u2728") => ({
  id: "block_1",
  kind: "emoji_insertion" as const,
  position: "before" as const,
  emoji
});

describe("Option 2 unified provider/runtime schema", () => {
  it("requires a dedicated primary emoji and exact discriminated operation branches", () => {
    const schema = option2SegmentPlanSchema as {
      required?: string[];
      properties?: {
        primaryEmoji?: Record<string, unknown>;
        operations?: { items?: { anyOf?: Array<Record<string, unknown>> } };
      };
    };
    const serialized = JSON.stringify(schema);

    expect(schema.required).toEqual(["primaryEmoji", "operations"]);
    expect(schema.properties?.operations?.items?.anyOf).toHaveLength(3);
    expect(serialized).not.toMatch(/"pattern"|"minLength"|"maxLength"|"contains"|"minContains"/);
    expectEveryObjectClosed(schema);
  });

  it("rejects a missing primary emoji at the provider schema boundary", () => {
    const validate = compileProviderSchema();

    expect(validate({ operations: [] })).toBe(false);
  });

  it.each([
    ["paragraph_missing_position", { id: "block_2", kind: "paragraph_break" }],
    ["markdown_missing_style", { id: "block_2", kind: "markdown_span" }],
    ["emoji_missing_position_and_emoji", { id: "block_2", kind: "emoji_insertion" }],
    ["paragraph_cross_kind_style", { id: "block_2", kind: "paragraph_break", position: "after", style: "bold" }],
    ["markdown_cross_kind_position", { id: "block_2", kind: "markdown_span", style: "bold", position: "after" }],
    ["emoji_cross_kind_style", { id: "block_2", kind: "emoji_insertion", position: "before", emoji: "\u{1F4A1}", style: "bold" }]
  ])("rejects former drift fixture %s in the shared schema", (_category, operation) => {
    const validate = compileProviderSchema();

    expect(validate({ primaryEmoji: primaryEmoji(), operations: [operation] })).toBe(false);
  });

  it.each([
    ["paragraph_break", { id: "block_2", kind: "paragraph_break", position: "after" }],
    ["markdown_span", { id: "block_2", kind: "markdown_span", style: "bold" }],
    ["emoji_insertion", { id: "block_2", kind: "emoji_insertion", position: "after", emoji: "\u{1F4A1}" }]
  ])("accepts provider-schema-valid %s and passes local shape validation", (_category, operation) => {
    const document = { primaryEmoji: primaryEmoji(), operations: [operation] };
    const validate = compileProviderSchema();

    expect(validate(document)).toBe(true);
    expect(parseOption2SegmentPlan(JSON.stringify(document), ["block_1", "block_2"])).toHaveLength(2);
  });

  it("rejects a non-emoji primary token semantically after schema validation", () => {
    const document = { primaryEmoji: primaryEmoji("not-emoji"), operations: [] };
    const validate = compileProviderSchema();

    expect(validate(document)).toBe(true);
    expectValidationCode(
      () => parseOption2SegmentPlan(JSON.stringify(document), ["block_1"]),
      "FORMAT_OPTION2_PRIMARY_EMOJI_INVALID"
    );
  });

  it.each(["\u{1F4A1}", "\u{1F469}\u200D\u{1F4BB}", "1\uFE0F\u20E3"])("accepts ordinary primary emoji token %s", (emoji) => {
    const document = { primaryEmoji: primaryEmoji(emoji), operations: [] };

    expect(parseOption2SegmentPlan(JSON.stringify(document), ["block_1"])).toEqual([primaryEmoji(emoji)]);
  });

  it.each([1, 7, 30])("accepts a bounded corpus spanning %i canonical segments", (segmentCount) => {
    const ids = Array.from({ length: segmentCount }, (_, index) => `block_${index + 1}`);
    const operations = ids.slice(1).map((id) => ({ id, kind: "paragraph_break" as const, position: "after" as const }));
    const document = { primaryEmoji: primaryEmoji(), operations };
    const validate = compileProviderSchema();

    expect(validate(document)).toBe(true);
    expect(parseOption2SegmentPlan(JSON.stringify(document), ids, 30)).toHaveLength(segmentCount);
  });

  it("enforces the total operation bound semantically", () => {
    const ids = Array.from({ length: 31 }, (_, index) => `block_${index + 1}`);
    const document = {
      primaryEmoji: primaryEmoji(),
      operations: ids.slice(1).map((id) => ({ id, kind: "paragraph_break", position: "after" }))
    };
    const validate = compileProviderSchema();

    expect(validate(document)).toBe(true);
    expectValidationCode(
      () => parseOption2SegmentPlan(JSON.stringify(document), ids, 30),
      "FORMAT_PLAN_OPERATION_LIMIT_EXCEEDED"
    );
  });

  it("maintains schema-valid implies local-shape-valid across a deterministic property matrix", () => {
    const validate = compileProviderSchema();
    const kinds = ["paragraph_break", "markdown_span", "emoji_insertion", "unknown"] as const;
    const optionalFields = ["position", "style", "emoji", "extra"] as const;

    for (const kind of kinds) {
      for (let mask = 0; mask < 16; mask += 1) {
        const candidate: Record<string, unknown> = { id: "block_2", kind };
        if (mask & 1) candidate.position = "after";
        if (mask & 2) candidate.style = "bold";
        if (mask & 4) candidate.emoji = "\u{1F4A1}";
        if (mask & 8) candidate.extra = "category-only-fixture";
        const document = { primaryEmoji: primaryEmoji(), operations: [candidate] };
        if (!validate(document)) continue;

        expect(() => parseOption2SegmentPlan(JSON.stringify(document), ["block_1", "block_2"])).not.toThrow();
      }
    }
  });

  it("preserves canonical lexical units and order after valid decoration", () => {
    const canonical = "Alpha one.\n\nBeta two.";
    const directives = parseOption2SegmentPlan(JSON.stringify({
      primaryEmoji: primaryEmoji(),
      operations: [
        { id: "block_1", kind: "markdown_span", style: "bold" },
        { id: "block_2", kind: "paragraph_break", position: "before" }
      ]
    }), ["block_1", "block_2"]);
    const rendered = applySegmentFormattingPlan(canonical, "option_2", directives);

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(recoverCanonicalText(rendered.text, rendered.insertions)).toBe(canonical);
  });
});

function compileProviderSchema() {
  return new Ajv({ strict: false }).compile(option2SegmentPlanSchema);
}

function expectValidationCode(action: () => unknown, expected: string): void {
  try {
    action();
    throw new Error("Expected validation error.");
  } catch (error) {
    expect(error).toBeInstanceOf(FormattingPlanValidationError);
    expect((error as FormattingPlanValidationError).code).toBe(expected);
  }
}

function expectEveryObjectClosed(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) expectEveryObjectClosed(item);
    return;
  }
  const record = value as Record<string, unknown>;
  if (record.type === "object") expect(record.additionalProperties).toBe(false);
  for (const child of Object.values(record)) expectEveryObjectClosed(child);
}
