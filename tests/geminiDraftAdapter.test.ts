import { describe, expect, it } from "vitest";
import { GeminiDraftAdapter, type GeminiDraftClient } from "../src/adapters/geminiDraftAdapter.js";
import type { PlanOption } from "../src/domain/types.js";
import type { Logger, LogFields } from "../src/observability/logger.js";

describe("GeminiDraftAdapter", () => {
  it("maps valid structured JSON to a full replacement draft", async () => {
    const adapter = new GeminiDraftAdapter({ client: fakeClient(validOutput()), model: "gemini-2.5-pro" });

    const result = await adapter.generateDraft({
      projectId: "project-1",
      selectedPlan: planOption(),
      postIndex: 1,
      rewriteMode: "make_post",
      transcript: "source transcript"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta).toMatchObject({ provider: "gemini", modelLabel: "gemini-2.5-pro" });
    expect(result.value.draft).toMatchObject({ fullText: "Full draft text", title: "Draft title", cta: "CTA" });
    expect(result.value.draft.notes).toEqual(["safe note"]);
  });

  it("rejects malformed JSON", async () => {
    const adapter = new GeminiDraftAdapter({ client: fakeClient("{not json"), model: "gemini-2.5-pro" });

    const result = await adapter.generateDraft(baseInput());

    expect(result).toMatchObject({ ok: false, error: { code: "GEMINI_DRAFT_OUTPUT_INVALID", retryable: true } });
  });

  it("rejects empty full text", async () => {
    const adapter = new GeminiDraftAdapter({ client: fakeClient(JSON.stringify({ full_text: "   " })), model: "gemini-2.5-pro" });

    const result = await adapter.generateDraft(baseInput());

    expect(result).toMatchObject({ ok: false, error: { retryable: true } });
  });

  it("rejects wrong or unsafe output shapes", async () => {
    const adapter = new GeminiDraftAdapter({
      client: fakeClient(JSON.stringify({ full_text: "Full draft text", shell_command: "rm -rf /" })),
      model: "gemini-2.5-pro"
    });

    const result = await adapter.generateDraft(baseInput());

    expect(result).toMatchObject({ ok: false, error: { retryable: true } });
  });

  it("rejects unbounded full text", async () => {
    const adapter = new GeminiDraftAdapter({ client: fakeClient(JSON.stringify({ full_text: "x".repeat(101) })), model: "gemini-2.5-pro", maxFullTextChars: 100 });

    const result = await adapter.generateDraft(baseInput());

    expect(result).toMatchObject({ ok: false, error: { retryable: true } });
  });

  it("does not log transcript, prompt, user context, or raw model output", async () => {
    const logger = new CapturingLogger();
    const adapter = new GeminiDraftAdapter({
      client: fakeClient(validOutput("LEAKY MODEL DRAFT")),
      model: "gemini-2.5-pro",
      logger
    });

    await adapter.generateDraft({ ...baseInput(), transcript: "SECRET TRANSCRIPT", compactContext: ["SECRET USER EDIT"] });

    const logs = JSON.stringify(logger.entries);
    expect(logs).not.toContain("SECRET TRANSCRIPT");
    expect(logs).not.toContain("SECRET USER EDIT");
    expect(logs).not.toContain("LEAKY MODEL DRAFT");
  });
});

function baseInput(): Parameters<GeminiDraftAdapter["generateDraft"]>[0] {
  return {
    projectId: "project-1",
    selectedPlan: planOption(),
    postIndex: 1,
    rewriteMode: "make_post",
    transcript: "source transcript"
  };
}

function fakeClient(output: string): GeminiDraftClient {
  return {
    async create() {
      return { output_text: output };
    }
  };
}

function validOutput(fullText = "Full draft text"): string {
  return JSON.stringify({
    full_text: fullText,
    title: "Draft title",
    body: "Draft body",
    cta: "CTA",
    notes: ["safe note"]
  });
}

function planOption(): PlanOption {
  return {
    optionId: "one_post",
    postCount: 1,
    title: "Plan title",
    angle: "Plan angle",
    summary: "Plan summary",
    posts: [
      {
        index: 1,
        topic: "Topic",
        angle: "Angle",
        includes: ["Point"],
        excludes: ["Excluded"]
      }
    ]
  };
}

class CapturingLogger implements Logger {
  readonly entries: Array<{ level: string; fields: LogFields; message: string }> = [];

  info(fields: LogFields, message: string): void {
    this.entries.push({ level: "info", fields, message });
  }

  warn(fields: LogFields, message: string): void {
    this.entries.push({ level: "warn", fields, message });
  }

  error(fields: LogFields, message: string): void {
    this.entries.push({ level: "error", fields, message });
  }
}
