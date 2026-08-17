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

describe("Option 2 provider-schema/parser alignment diagnostics", () => {
  it.each([
    ["paragraph_missing_position", { id: "block_1", kind: "paragraph_break" }],
    ["markdown_missing_style", { id: "block_1", kind: "markdown_span" }],
    ["emoji_missing_position_and_emoji", { id: "block_1", kind: "emoji_insertion" }],
    ["paragraph_cross_kind_style", { id: "block_1", kind: "paragraph_break", position: "after", style: "bold" }],
    ["markdown_cross_kind_position", { id: "block_1", kind: "markdown_span", style: "bold", position: "after" }],
    ["emoji_cross_kind_style", { id: "block_1", kind: "emoji_insertion", position: "before", emoji: "\u{1F4DC}", style: "bold" }]
  ])("rejects former provider-schema/parser drift fixture %s", (_category, operation) => {
    const validate = new Ajv({ strict: false }).compile(option2SegmentPlanSchema);
    const document = {
      primaryEmoji: { id: "block_1", kind: "emoji_insertion", position: "before", emoji: "\u{1F4DC}" },
      operations: [operation]
    };

    expect(validate(document)).toBe(false);
  });

  it.each([
    ["paragraph_break", { id: "block_1", kind: "paragraph_break", position: "after" }],
    ["markdown_span", { id: "block_1", kind: "markdown_span", style: "bold" }],
    ["emoji_insertion", { id: "block_1", kind: "emoji_insertion", position: "before", emoji: "\u{1F4DC}" }]
  ])("keeps provider schema and parser aligned for valid %s form", (kind, operation) => {
    const validate = new Ajv({ strict: false }).compile(option2SegmentPlanSchema);
    const primaryEmoji = kind === "emoji_insertion"
      ? operation
      : { id: "block_2", kind: "emoji_insertion", position: "before", emoji: "\u{1F4DC}" };
    const operations = kind === "emoji_insertion" ? [] : [operation];
    const document = { primaryEmoji, operations };

    expect(validate(document)).toBe(true);
    expect(parseOption2SegmentPlan(JSON.stringify(document), testSegments(["block_1", "block_2"], String(primaryEmoji.id)))).toHaveLength(operations.length + 1);
  });

  it("keeps a seven-segment mixed drift corpus rejected by both validators", () => {
    const document = {
      primaryEmoji: { id: "block_1", kind: "emoji_insertion", position: "before", emoji: "\u{1F4DC}" },
      operations: [
        { id: "block_1", kind: "paragraph_break", position: "after" },
        { id: "block_2", kind: "markdown_span", style: "bold" },
        { id: "block_3", kind: "emoji_insertion", position: "before", emoji: "\u{1F4DC}" },
        { id: "block_4", kind: "paragraph_break", position: "before" },
        { id: "block_5", kind: "markdown_span", style: "italic" },
        { id: "block_6", kind: "paragraph_break" },
        { id: "block_7", kind: "emoji_insertion", position: "after", emoji: "\u{1F4A1}" }
      ]
    };
    const validate = new Ajv({ strict: false }).compile(option2SegmentPlanSchema);

    expect(validate(document)).toBe(false);
    expectSegmentValidationCode(
      () => parseOption2SegmentPlan(JSON.stringify(document), testSegments(Array.from({ length: 7 }, (_, index) => `block_${index + 1}`))),
      "FORMAT_SEGMENT_PLAN_SCHEMA_INVALID"
    );
  });

  it("emits category-only rejected segment-plan diagnostics without provider output values", async () => {
    const logger = new CapturingLogger();
    const output = JSON.stringify({
      primaryEmoji: { id: "block_1", kind: "emoji_insertion", position: "before", emoji: "\u{1F4DC}" },
      operations: [{ id: "block_2", kind: "paragraph_break" }]
    });
    const adapter = new OpenRouterFormattingAdapter({ client: capturingClient(output), model: "owner-selected-format-model", logger });

    await adapter.formatOption2Segments({ projectId: "project-safe", draftText: "Safe intro.\n\nSafe body.", segments: [
      { id: "block_1", start: 0, end: 11, text: "Safe intro.", role: "intro" },
      { id: "block_2", start: 13, end: 23, text: "Safe body.", role: "paragraph" }
    ] });

    expect(logger.entries.at(-1)?.fields).toMatchObject({
      validationCode: "FORMAT_SEGMENT_PLAN_SCHEMA_INVALID",
      responseByteLengthBucket: "128_255",
      parsedOperationCount: 1,
      failingOperationIndexBucket: "0",
      failingOperationKind: "paragraph_break",
      fieldPresenceMask: 3,
      anyEmojiDirective: true,
      planValidationStage: "shape",
      schemaFailureLocation: "operation"
    });
    const serialized = JSON.stringify(logger.entries);
    expect(serialized).not.toContain("block_1");
    expect(serialized).not.toContain("block_2");
    expect(serialized).not.toContain("\u2728");
    expect(serialized).not.toContain(output);
  });

  it("emits a distinct category-only primary emoji semantic failure", async () => {
    const logger = new CapturingLogger();
    const unsafeValue = "NOT_AN_EMOJI_SENTINEL";
    const output = JSON.stringify({
      primaryEmoji: { id: "block_1", kind: "emoji_insertion", position: "before", emoji: unsafeValue },
      operations: []
    });
    const adapter = new OpenRouterFormattingAdapter({ client: capturingClient(output), model: "owner-selected-format-model", logger });

    await adapter.formatOption2Segments({
      projectId: "project-safe",
      draftText: "Safe intro.", segments: [{ id: "block_1", start: 0, end: 11, text: "Safe intro.", role: "intro" }]
    });

    expect(logger.entries.at(-1)?.fields).toMatchObject({
      validationCode: "FORMAT_OPTION2_PRIMARY_EMOJI_INVALID",
      parsedOperationCount: 0,
      failingOperationIndexBucket: "not_applicable",
      failingOperationKind: "emoji_insertion",
      fieldPresenceMask: 23,
      anyEmojiDirective: true,
      planValidationStage: "semantic",
      schemaFailureLocation: "primary_emoji"
    });
    expect(JSON.stringify(logger.entries)).not.toContain(unsafeValue);
  });

  it("reports current Anthropic-unsupported schema constraints separately", () => {
    const keywords = collectSchemaKeywords(option2SegmentPlanSchema);
    const documentedUnsupported = new Set(["minimum", "maximum", "minLength", "maxLength"]);

    expect([...keywords].sort()).toEqual([
      "additionalProperties", "anyOf", "enum", "items", "properties", "required", "type"
    ]);
    expect([...keywords].filter((keyword) => documentedUnsupported.has(keyword))).toEqual([]);
  });
});

function testSegments(ids: string[], primaryId = ids[0]) {
  return ids.map((id, index) => ({ id, start: index * 2, end: index * 2 + 1, text: "x", role: id === primaryId ? "intro" as const : "paragraph" as const }));
}

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
    if (!["primaryEmoji", "operations", "id", "kind", "position", "style", "emoji"].includes(key)) result.add(key);
    if (key === "properties" && child && typeof child === "object" && !Array.isArray(child)) {
      for (const nested of Object.values(child)) collectSchemaKeywords(nested, result);
    } else {
      collectSchemaKeywords(child, result);
    }
  }
  return result;
}
