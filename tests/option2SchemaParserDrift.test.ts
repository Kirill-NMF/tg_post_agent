import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import {
  FormattingPlanValidationError,
  OpenRouterFormattingAdapter,
  option2SegmentPlanSchema,
  parseOption2SegmentPlan,
  type FormattingInteractionClient,
  type FormattingInteractionRequest
} from "../src/adapters/openRouterFormattingAdapter.js";
import type { Logger, LogFields } from "../src/observability/logger.js";

describe("Option 2 provider-schema/parser drift diagnostics", () => {
  it.each([
    ["paragraph_missing_position", { id: "block_1", kind: "paragraph_break" }],
    ["markdown_missing_style", { id: "block_1", kind: "markdown_span" }],
    ["emoji_missing_position_and_emoji", { id: "block_1", kind: "emoji_insertion" }],
    ["paragraph_cross_kind_style", { id: "block_1", kind: "paragraph_break", position: "after", style: "bold" }],
    ["markdown_cross_kind_position", { id: "block_1", kind: "markdown_span", style: "bold", position: "after" }],
    ["emoji_cross_kind_style", { id: "block_1", kind: "emoji_insertion", position: "before", emoji: "\u2728", style: "bold" }]
  ])("proves provider-schema/parser drift for %s", (_category, operation) => {
    const validate = new Ajv({ strict: false }).compile(option2SegmentPlanSchema);
    const document = { operations: [operation] };

    expect(validate(document)).toBe(true);
    expectSegmentValidationCode(() => parseOption2SegmentPlan(JSON.stringify(document), ["block_1"]), "FORMAT_SEGMENT_PLAN_SCHEMA_INVALID");
  });

  it.each([
    ["paragraph_break", { id: "block_1", kind: "paragraph_break", position: "after" }],
    ["markdown_span", { id: "block_1", kind: "markdown_span", style: "bold" }],
    ["emoji_insertion", { id: "block_1", kind: "emoji_insertion", position: "before", emoji: "\u2728" }]
  ])("keeps provider schema and parser aligned for valid %s form", (kind, operation) => {
    const validate = new Ajv({ strict: false }).compile(option2SegmentPlanSchema);
    const operations = kind === "emoji_insertion"
      ? [operation]
      : [operation, { id: "block_2", kind: "emoji_insertion", position: "after", emoji: "\u2728" }];
    const document = { operations };

    expect(validate(document)).toBe(true);
    expect(parseOption2SegmentPlan(JSON.stringify(document), ["block_1", "block_2"])).toHaveLength(operations.length);
  });

  it("proves drift in a seven-segment mixed corpus without recording content", () => {
    const document = {
      operations: [
        { id: "block_1", kind: "paragraph_break", position: "after" },
        { id: "block_2", kind: "markdown_span", style: "bold" },
        { id: "block_3", kind: "emoji_insertion", position: "before", emoji: "\u2728" },
        { id: "block_4", kind: "paragraph_break", position: "before" },
        { id: "block_5", kind: "markdown_span", style: "italic" },
        { id: "block_6", kind: "paragraph_break" },
        { id: "block_7", kind: "emoji_insertion", position: "after", emoji: "\u{1F4A1}" }
      ]
    };
    const validate = new Ajv({ strict: false }).compile(option2SegmentPlanSchema);

    expect(validate(document)).toBe(true);
    expectSegmentValidationCode(
      () => parseOption2SegmentPlan(JSON.stringify(document), Array.from({ length: 7 }, (_, index) => `block_${index + 1}`)),
      "FORMAT_SEGMENT_PLAN_SCHEMA_INVALID"
    );
  });

  it("emits category-only rejected segment-plan diagnostics without provider output values", async () => {
    const logger = new CapturingLogger();
    const output = JSON.stringify({ operations: [
      { id: "block_1", kind: "emoji_insertion", position: "before", emoji: "\u2728" },
      { id: "block_2", kind: "paragraph_break" }
    ] });
    const adapter = new OpenRouterFormattingAdapter({ client: capturingClient(output), model: "owner-selected-format-model", logger });

    await adapter.formatOption2Segments({ projectId: "project-safe", segments: [
      { id: "block_1", start: 0, end: 10 },
      { id: "block_2", start: 11, end: 20 }
    ] });

    expect(logger.entries.at(-1)?.fields).toMatchObject({
      validationCode: "FORMAT_SEGMENT_PLAN_SCHEMA_INVALID",
      responseByteLengthBucket: "128_255",
      parsedOperationCount: 2,
      failingOperationIndexBucket: "1_3",
      failingOperationKind: "paragraph_break",
      fieldPresenceMask: 3,
      anyEmojiDirective: true
    });
    const serialized = JSON.stringify(logger.entries);
    expect(serialized).not.toContain("block_1");
    expect(serialized).not.toContain("block_2");
    expect(serialized).not.toContain("\u2728");
    expect(serialized).not.toContain(output);
  });

  it("reports current Anthropic-unsupported schema constraints separately", () => {
    const keywords = collectSchemaKeywords(option2SegmentPlanSchema);
    const documentedUnsupported = new Set(["minimum", "maximum", "minLength", "maxLength"]);

    expect([...keywords].sort()).toEqual([
      "additionalProperties", "enum", "items", "maxItems", "maxLength", "minLength", "pattern", "properties", "required", "type"
    ]);
    expect([...keywords].filter((keyword) => documentedUnsupported.has(keyword)).sort()).toEqual(["maxLength", "minLength"]);
  });
});

function expectSegmentValidationCode(action: () => unknown, expected: string): void {
  try {
    action();
    throw new Error("Expected segment contract validation error.");
  } catch (error) {
    expect(error).toBeInstanceOf(FormattingPlanValidationError);
    expect((error as FormattingPlanValidationError).code).toBe(expected);
  }
}

function capturingClient(output: string): FormattingInteractionClient & { requests: FormattingInteractionRequest[] } {
  return {
    requests: [],
    async create(request) {
      this.requests.push(request);
      return { output_text: output };
    }
  };
}

class CapturingLogger implements Logger {
  readonly entries: Array<{ level: string; fields: LogFields; message: string }> = [];
  info(fields: LogFields, message: string): void { this.entries.push({ level: "info", fields, message }); }
  warn(fields: LogFields, message: string): void { this.entries.push({ level: "warn", fields, message }); }
  error(fields: LogFields, message: string): void { this.entries.push({ level: "error", fields, message }); }
}

function collectSchemaKeywords(value: unknown, result = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [key, child] of Object.entries(value)) {
    if (!["operations", "id", "kind", "position", "style", "emoji"].includes(key)) result.add(key);
    if (key === "properties" && child && typeof child === "object" && !Array.isArray(child)) {
      for (const nested of Object.values(child)) collectSchemaKeywords(nested, result);
    } else {
      collectSchemaKeywords(child, result);
    }
  }
  return result;
}
