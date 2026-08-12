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

  it("preserves Telegram-readable paragraph breaks in full text and body", async () => {
    const adapter = new GeminiDraftAdapter({
      client: fakeClient(
        JSON.stringify({
          full_text: "  First paragraph\r\n\r\nSecond paragraph\n\n\nThird paragraph  ",
          title: " Draft title ",
          body: "  Body intro\r\n\r\nBody outro  ",
          cta: " CTA ",
          notes: [" safe note "]
        })
      ),
      model: "gemini-2.5-pro"
    });

    const result = await adapter.generateDraft(baseInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.draft.fullText).toBe("First paragraph\n\nSecond paragraph\n\nThird paragraph");
    expect(result.value.draft.body).toBe("Body intro\n\nBody outro");
    expect(result.value.draft.title).toBe("Draft title");
    expect(result.value.draft.cta).toBe("CTA");
    expect(result.value.draft.notes).toEqual(["safe note"]);
  });

  it("rejects malformed JSON", async () => {
    const adapter = new GeminiDraftAdapter({ client: fakeClient("{not json"), model: "gemini-2.5-pro" });

    const result = await adapter.generateDraft(baseInput());

    expect(result).toMatchObject({ ok: false, error: { code: "GEMINI_DRAFT_OUTPUT_INVALID", retryable: false } });
  });

  it("rejects empty full text", async () => {
    const adapter = new GeminiDraftAdapter({ client: fakeClient(JSON.stringify({ full_text: "   " })), model: "gemini-2.5-pro" });

    const result = await adapter.generateDraft(baseInput());

    expect(result).toMatchObject({ ok: false, error: { retryable: false } });
  });

  it("rejects wrong or unsafe output shapes", async () => {
    const adapter = new GeminiDraftAdapter({
      client: fakeClient(JSON.stringify({ full_text: "Full draft text", shell_command: "rm -rf /" })),
      model: "gemini-2.5-pro"
    });

    const result = await adapter.generateDraft(baseInput());

    expect(result).toMatchObject({ ok: false, error: { retryable: false } });
  });

  it("rejects unbounded full text", async () => {
    const adapter = new GeminiDraftAdapter({ client: fakeClient(JSON.stringify({ full_text: "x".repeat(101) })), model: "gemini-2.5-pro", maxFullTextChars: 100 });

    const result = await adapter.generateDraft(baseInput());

    expect(result).toMatchObject({ ok: false, error: { retryable: false } });
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

  it("maps valid revision JSON to a full updated draft", async () => {
    const adapter = new GeminiDraftAdapter({ client: fakeClient(validOutput("Updated draft text")), model: "gemini-2.5-pro" });

    const result = await adapter.reviseDraft(baseReviseInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta).toMatchObject({ provider: "gemini", modelLabel: "gemini-2.5-pro" });
    expect(result.value.updatedDraft.fullText).toBe("Updated draft text");
  });

  it("preserves paragraph breaks in revised draft full text and body", async () => {
    const adapter = new GeminiDraftAdapter({
      client: fakeClient(
        JSON.stringify({
          full_text: "  First revised paragraph\r\n\r\nSecond revised paragraph\n\n\nThird revised paragraph  ",
          body: "  Body one\r\n\r\nBody two  "
        })
      ),
      model: "gemini-2.5-pro"
    });

    const result = await adapter.reviseDraft(baseReviseInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.updatedDraft.fullText).toBe("First revised paragraph\n\nSecond revised paragraph\n\nThird revised paragraph");
    expect(result.value.updatedDraft.body).toBe("Body one\n\nBody two");
  });

  it("rejects malformed revision JSON", async () => {
    const adapter = new GeminiDraftAdapter({ client: fakeClient("{not json"), model: "gemini-2.5-pro" });

    const result = await adapter.reviseDraft(baseReviseInput());

    expect(result).toMatchObject({ ok: false, error: { code: "GEMINI_DRAFT_REVISION_OUTPUT_INVALID", retryable: false } });
  });

  it("rejects empty, unbounded, or unknown-field revision output", async () => {
    const empty = new GeminiDraftAdapter({ client: fakeClient(JSON.stringify({ full_text: "   " })), model: "gemini-2.5-pro" });
    const overLimit = new GeminiDraftAdapter({ client: fakeClient(JSON.stringify({ full_text: "x".repeat(101) })), model: "gemini-2.5-pro", maxFullTextChars: 100 });
    const unknown = new GeminiDraftAdapter({ client: fakeClient(JSON.stringify({ full_text: "Updated draft", markdown_entities: [] })), model: "gemini-2.5-pro" });

    await expect(empty.reviseDraft(baseReviseInput())).resolves.toMatchObject({ ok: false, error: { retryable: false } });
    await expect(overLimit.reviseDraft(baseReviseInput())).resolves.toMatchObject({ ok: false, error: { retryable: false } });
    await expect(unknown.reviseDraft(baseReviseInput())).resolves.toMatchObject({ ok: false, error: { retryable: false } });
  });

  it("does not log current draft, latest edit, user context, or raw revision output", async () => {
    const logger = new CapturingLogger();
    const adapter = new GeminiDraftAdapter({
      client: fakeClient(validOutput("LEAKY REVISED DRAFT")),
      model: "gemini-2.5-pro",
      logger
    });

    await adapter.reviseDraft({
      ...baseReviseInput(),
      currentDraft: "SECRET CURRENT DRAFT",
      latestUserEdit: "SECRET USER EDIT",
      compactContext: ["SECRET CONTEXT"]
    });

    const logs = JSON.stringify(logger.entries);
    expect(logs).not.toContain("SECRET CURRENT DRAFT");
    expect(logs).not.toContain("SECRET USER EDIT");
    expect(logs).not.toContain("SECRET CONTEXT");
    expect(logs).not.toContain("LEAKY REVISED DRAFT");
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

function baseReviseInput(): Parameters<GeminiDraftAdapter["reviseDraft"]>[0] {
  return {
    projectId: "project-1",
    currentDraft: "Current draft text",
    latestUserEdit: "Make the intro sharper",
    compactContext: ["Earlier edit"]
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
