import { describe, expect, it } from "vitest";
import { FormattingPlanValidationError, OpenRouterFormattingAdapter, buildOption2SegmentPrompt, option2SegmentPlanSchema, parseFormattingPlan, parseOption2SegmentPlan, type FormattingInteractionClient, type FormattingInteractionRequest } from "../src/adapters/openRouterFormattingAdapter.js";
import { ProviderRequestError, ProviderResponseError } from "../src/adapters/providerErrors.js";
import type { Logger, LogFields } from "../src/observability/logger.js";

describe("OpenRouterFormattingAdapter", () => {
  it("maps a strict decoration plan and preserves the canonical draft", async () => {
    const client = capturingClient(JSON.stringify({
      option: "option_2",
      operations: [{ kind: "emoji_insertion", anchor: { text: "Alpha", occurrence: 0 }, position: "before", emoji: "\u{1f4a1}" }]
    }));
    const adapter = new OpenRouterFormattingAdapter({ client, model: "owner-selected-format-model" });

    const result = await adapter.formatPost({ projectId: "project-1", draftText: "Alpha text.", formattingOption: "option_2" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta).toEqual({ provider: "openrouter", modelLabel: "owner-selected-format-model" });
    expect(result.value.decorationPlan.operations).toHaveLength(1);
    expect(client.requests[0]?.input).toContain("decoration plan only");
    expect(client.requests[0]?.input).not.toContain("replacement body");
  });

  it("parses ID-only Option 2 directives without exposing canonical segment text", () => {
    const directives = parseOption2SegmentPlan(JSON.stringify({
      operations: [
        { id: "block_1", kind: "emoji_insertion", position: "before", emoji: "\\u2728" },
        { id: "block_2", kind: "paragraph_break", position: "after" }
      ]
    }), ["block_1", "block_2"]);

    expect(directives).toEqual([
      { id: "block_1", kind: "emoji_insertion", position: "before", emoji: "\\u2728" },
      { id: "block_2", kind: "paragraph_break", position: "after" }
    ]);
    const prompt = buildOption2SegmentPrompt(["block_1", "block_2"]);
    expect(prompt).toContain("block_1");
    expect(prompt).not.toContain("CANONICAL_TEXT_SENTINEL");
    const schema = JSON.stringify(option2SegmentPlanSchema);
    expect(schema).not.toContain("anchor");
    expect(schema).not.toContain("replacement");
    expect(schema).not.toContain("text");
  });

  it("requests strict OpenRouter JSON Schema for Option 2 segment directives", async () => {
    const client = capturingClient(JSON.stringify({ operations: [] }));
    const adapter = new OpenRouterFormattingAdapter({ client, model: "owner-selected-format-model" });

    await expect(adapter.formatOption2Segments({ projectId: "project-1", segments: [{ id: "block_1", start: 0, end: 23 }] })).resolves.toMatchObject({ ok: true });

    const request = client.requests[0] as unknown as { response_format?: Record<string, unknown>; stream?: unknown; provider?: Record<string, unknown>; plugins?: unknown };
    expect(request.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { name: "tg_post_agent_option2_segment_plan", strict: true }
    });
    expect(JSON.stringify(request.response_format)).toContain("\"additionalProperties\":false");
    expect(request.stream).toBe(false);
    expect(request.provider).toMatchObject({ require_parameters: true });
    expect(request.plugins).toEqual([{ id: "response-healing" }]);
  });

  it.each(["prose instead of JSON", "```json\n{\"operations\":[]}\n```"])("rejects non-JSON Option 2 provider output", async (output) => {
    const adapter = new OpenRouterFormattingAdapter({ client: capturingClient(output), model: "owner-selected-format-model" });
    await expect(adapter.formatOption2Segments({ projectId: "project-1", segments: [{ id: "block_1", start: 0, end: 23 }] }))
      .resolves.toMatchObject({ ok: false, error: { code: "FORMAT_PLAN_OUTPUT_INVALID", retryable: false } });
  });

  it("maps an unsupported structured-output parameter failure to controlled recovery", async () => {
    const adapter = new OpenRouterFormattingAdapter({
      client: { async create() { throw new ProviderRequestError("HTTP_400", false); } },
      model: "owner-selected-format-model"
    });
    await expect(adapter.formatOption2Segments({ projectId: "project-1", segments: [{ id: "block_1", start: 0, end: 23 }] }))
      .resolves.toMatchObject({ ok: false, error: { code: "FORMAT_PLAN_OUTPUT_INVALID", retryable: false } });
  });

  it.each([
    [JSON.stringify({ operations: [{ id: "block_9", kind: "paragraph_break", position: "after" }] }), "FORMAT_SEGMENT_ID_INVALID"],
    [JSON.stringify({ operations: [{ id: "block_1", kind: "paragraph_break", position: "after", anchor: { text: "source", occurrence: 0 } }] }), "FORMAT_SEGMENT_PLAN_SCHEMA_INVALID"],
    [JSON.stringify({ operations: [{ id: "block_1", kind: "paragraph_break", position: "after", text: "source" }] }), "FORMAT_SEGMENT_PLAN_SCHEMA_INVALID"],
    [JSON.stringify({ operations: [{ id: "block_1", kind: "markdown_span", style: "bold", replacement_text: "source" }] }), "FORMAT_SEGMENT_PLAN_SCHEMA_INVALID"]
  ])("rejects non-ID Option 2 directives", (raw, expected) => {
    expectSegmentValidationCode(() => parseOption2SegmentPlan(raw, ["block_1"]), expected);
  });

  it("categorizes a mismatched selected option without recording model content", () => {
    expectValidationCode(() => parseFormattingPlan(JSON.stringify({ option: "option_1", operations: [] }), "Alpha text.", "option_2"), "FORMAT_PLAN_OPTION_MISMATCH");
  });

  it.each([
    [JSON.stringify({ option: "option_2", operations: "not-an-array" }), "FORMAT_PLAN_OPERATIONS_INVALID"],
    [JSON.stringify({ option: "option_2", operations: [{ kind: "emoji_insertion", anchor: { text: "Alpha", occurrence: 0 }, emoji: "\u{2728}" }] }), "FORMAT_PLAN_OPERATION_SHAPE_INVALID"],
    [JSON.stringify({ option: "option_2", operations: Array.from({ length: 31 }, () => ({ kind: "paragraph_break", anchor: { text: "Alpha", occurrence: 0 }, position: "after" })) }), "FORMAT_PLAN_OPERATION_LIMIT_EXCEEDED"]
  ])("categorizes decoration contract failures safely", (output, expected) => {
    expectValidationCode(() => parseFormattingPlan(output, "Alpha text.", "option_2"), expected);
  });


  it.each([
    JSON.stringify({ option: "option_1", operations: [] }),
    JSON.stringify({ option: "option_2", operations: [{ kind: "delete", anchor: { text: "Alpha", occurrence: 0 } }] }),
    JSON.stringify({ option: "option_2", operations: [], replacement_text: "other" }),
    JSON.stringify({ option: "option_2", operations: [{ kind: "markdown_span", anchor: { text: "Alpha", occurrence: 0 }, style: "bold", replacement_text: "other" }] }),
    "{not json"
  ])("rejects malformed or non-preserving model output", async (output) => {
    const adapter = new OpenRouterFormattingAdapter({ client: capturingClient(output), model: "owner-selected-format-model" });

    await expect(adapter.formatPost({ projectId: "project-1", draftText: "Alpha text.", formattingOption: "option_2" }))
      .resolves.toMatchObject({ ok: false, error: { code: "FORMAT_PLAN_OUTPUT_INVALID", retryable: false } });
  });

  it("accepts compatible Option 2 decorations at one anchor without logging draft or model output", async () => {
    const logger = new CapturingLogger();
    const client = capturingClient(JSON.stringify({
      option: "option_2",
      operations: [
        { kind: "emoji_insertion", anchor: { text: "Alpha", occurrence: 0 }, position: "after", emoji: "\u{1f4a1}" },
        { kind: "paragraph_break", anchor: { text: "Alpha", occurrence: 0 }, position: "after" }
      ]
    }));
    const adapter = new OpenRouterFormattingAdapter({ client, model: "owner-selected-format-model", logger });

    await expect(adapter.formatPost({ projectId: "project-1", draftText: "SECRET DRAFT Alpha", formattingOption: "option_2" }))
      .resolves.toMatchObject({ ok: true });
    expect(client.requests[0]?.input).toContain("Compatible shared-boundary decorations");
    expect(JSON.stringify(logger.entries)).not.toContain("SECRET DRAFT");
  });

  it("categorizes unknown provider errors without logging draft or raw output", async () => {
    const logger = new CapturingLogger();
    const adapter = new OpenRouterFormattingAdapter({
      client: { async create() { throw new Error("provider body must not be logged"); } },
      model: "owner-selected-format-model",
      logger
    });

    await expect(adapter.formatPost({ projectId: "project-1", draftText: "SECRET DRAFT", formattingOption: "option_1" }))
      .resolves.toMatchObject({ ok: false, error: { code: "FORMAT_PLAN_OUTPUT_INVALID", retryable: false } });
    expect(logger.entries.at(-1)?.fields).toMatchObject({ event: "formatting_request_failed", errorCode: "PROVIDER_REQUEST_FAILED", errorName: "Error" });
    expect(JSON.stringify(logger.entries)).not.toContain("SECRET DRAFT");
    expect(JSON.stringify(logger.entries)).not.toContain("provider body");
  });

  it("carries only typed response metadata to the formatting failure log", async () => {
    const logger = new CapturingLogger();
    const metadata = { endpoint: "openrouter_chat_completions" as const, statusClass: "2xx" as const, contentType: "html" as const, byteLength: 37 };
    const adapter = new OpenRouterFormattingAdapter({ client: { async create() { throw new ProviderResponseError("RESPONSE_NON_JSON", metadata); } }, model: "owner-selected-format-model", logger });
    await adapter.formatPost({ projectId: "project-1", draftText: "SECRET DRAFT", formattingOption: "option_1" });
    expect(logger.entries.at(-1)?.fields).toMatchObject({ errorCode: "RESPONSE_NON_JSON", errorName: "ProviderResponseError", responseEndpoint: metadata.endpoint, responseStatusClass: metadata.statusClass, responseContentType: metadata.contentType, responseByteLength: metadata.byteLength });
    expect(JSON.stringify(logger.entries)).not.toContain("SECRET DRAFT");
  });

  it("keeps provider timeout retryable without logging draft or raw output", async () => {
    const logger = new CapturingLogger();
    const adapter = new OpenRouterFormattingAdapter({
      client: { async create() { throw new ProviderRequestError("TIMEOUT", true); } },
      model: "owner-selected-format-model",
      logger
    });

    const result = await adapter.formatPost({ projectId: "project-1", draftText: "SECRET DRAFT", formattingOption: "option_1" });

    expect(result).toMatchObject({ ok: false, error: { retryable: true } });
    expect(JSON.stringify(logger.entries)).not.toContain("SECRET DRAFT");
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

function expectValidationCode(run: () => void, expected: string): void {
  try {
    run();
    throw new Error("expected formatting plan validation failure");
  } catch (error) {
    expect(error).toBeInstanceOf(FormattingPlanValidationError);
    expect((error as FormattingPlanValidationError).code).toBe(expected);
  }
}
