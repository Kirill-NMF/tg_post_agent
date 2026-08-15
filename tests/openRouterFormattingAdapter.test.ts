import { describe, expect, it } from "vitest";
import { OpenRouterFormattingAdapter, type FormattingInteractionClient } from "../src/adapters/openRouterFormattingAdapter.js";
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

  it("classifies an Option 2 lexical safety rejection without logging draft or model output", async () => {
    const logger = new CapturingLogger();
    const adapter = new OpenRouterFormattingAdapter({
      client: capturingClient(JSON.stringify({
        option: "option_2",
        operations: [
          { kind: "emoji_insertion", anchor: { text: "Alpha", occurrence: 0 }, position: "after", emoji: "\u{1f4a1}" },
          { kind: "paragraph_break", anchor: { text: "Alpha", occurrence: 0 }, position: "after" }
        ]
      })),
      model: "owner-selected-format-model",
      logger
    });

    await expect(adapter.formatPost({ projectId: "project-1", draftText: "SECRET DRAFT Alpha", formattingOption: "option_2" }))
      .resolves.toMatchObject({ ok: false, error: { code: "FORMAT_PLAN_OUTPUT_INVALID", retryable: false } });
    expect(logger.entries.at(-1)?.fields).toMatchObject({
      event: "formatting_request_failed",
      failureBoundary: "formatting_plan_validation",
      validationCode: "FORMAT_INSERTION_AMBIGUOUS",
      errorCode: "FORMAT_INSERTION_AMBIGUOUS",
      errorName: "FormattingPlanValidationError"
    });
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

function capturingClient(output: string): FormattingInteractionClient & { requests: Array<{ input: string }> } {
  return {
    requests: [],
    async create(request) {
      this.requests.push({ input: request.input });
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
