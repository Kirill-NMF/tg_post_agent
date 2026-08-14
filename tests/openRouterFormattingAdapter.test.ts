import { describe, expect, it } from "vitest";
import { OpenRouterFormattingAdapter, type FormattingInteractionClient } from "../src/adapters/openRouterFormattingAdapter.js";
import { ProviderRequestError } from "../src/adapters/providerErrors.js";
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
