import { describe, expect, it } from "vitest";
import { GeminiDraftAdapter, type GeminiDraftClient, type GeminiDraftInteractionRequest } from "../src/adapters/geminiDraftAdapter.js";
import { GeminiPlanningAdapter, type GeminiPlanningClient, type GeminiPlanningInteractionRequest } from "../src/adapters/geminiPlanningAdapter.js";
import type { PlanOption, PlanningResult } from "../src/domain/types.js";

describe("Stage 2 output language prompts", () => {
  it("makes Russian the prominent default for planning and plan revisions", async () => {
    const client = new PlanningClient(russianPlanOutput());
    const adapter = new GeminiPlanningAdapter({ client, model: "google/gemini-2.5-pro" });
    const initial = await adapter.planSplit({ projectId: "p", transcript: "MIXED SOURCE TEXT", planningHistory: [] });
    expect(initial.ok).toBe(true);
    expect(client.requests[0]?.input).toContain("\u042f\u0417\u042b\u041a \u0418\u0422\u041e\u0413\u041e\u0412\u041e\u0413\u041e \u0422\u0415\u041a\u0421\u0422\u0410: \u0440\u0443\u0441\u0441\u043a\u0438\u0439 (ru)");
    if (!initial.ok) return;
    await adapter.revisePlan({ projectId: "p", transcript: "MIXED SOURCE TEXT", currentPlan: initial.value, latestUserEdit: "\u0423\u0442\u043e\u0447\u043d\u0438 \u043f\u043b\u0430\u043d" });
    expect(client.requests[1]?.input).toContain("\u042f\u0417\u042b\u041a \u0418\u0422\u041e\u0413\u041e\u0412\u041e\u0413\u041e \u0422\u0415\u041a\u0421\u0422\u0410: \u0440\u0443\u0441\u0441\u043a\u0438\u0439 (ru)");
  });

  it("accepts an explicit non-Russian override and rejects clearly English default planning output", async () => {
    const explicit = new GeminiPlanningAdapter({ client: new PlanningClient(englishPlanOutput()), model: "google/gemini-2.5-pro" });
    await expect(explicit.planSplit({ projectId: "p", transcript: "source", planningHistory: [], outputLanguage: "en" as never })).resolves.toMatchObject({ ok: true });
    const defaultRussian = new GeminiPlanningAdapter({ client: new PlanningClient(englishPlanOutput()), model: "google/gemini-2.5-pro" });
    await expect(defaultRussian.planSplit({ projectId: "p", transcript: "source", planningHistory: [] })).resolves.toMatchObject({ ok: false, error: { code: "GEMINI_PLAN_OUTPUT_LANGUAGE_INVALID", retryable: false } });
  });

  it("makes Russian the default for draft generation and revision while permitting an explicit override", async () => {
    const client = new DraftClient(russianDraftOutput());
    const adapter = new GeminiDraftAdapter({ client, model: "google/gemini-2.5-pro" });
    await expect(adapter.generateDraft(draftInput())).resolves.toMatchObject({ ok: true });
    expect(client.requests[0]?.input).toContain("\u042f\u0417\u042b\u041a \u0418\u0422\u041e\u0413\u041e\u0412\u041e\u0413\u041e \u0422\u0415\u041a\u0421\u0422\u0410: \u0440\u0443\u0441\u0441\u043a\u0438\u0439 (ru)");
    await expect(adapter.reviseDraft({ projectId: "p", currentDraft: "\u0422\u0435\u043a\u0443\u0449\u0438\u0439 \u0447\u0435\u0440\u043d\u043e\u0432\u0438\u043a", latestUserEdit: "\u0423\u0442\u043e\u0447\u043d\u0438", compactContext: [] })).resolves.toMatchObject({ ok: true });
    expect(client.requests[1]?.input).toContain("\u042f\u0417\u042b\u041a \u0418\u0422\u041e\u0413\u041e\u0412\u041e\u0413\u041e \u0422\u0415\u041a\u0421\u0422\u0410: \u0440\u0443\u0441\u0441\u043a\u0438\u0439 (ru)");
    const englishClient = new DraftClient(JSON.stringify({ full_text: "A complete English draft with enough text to satisfy the language guard." }));
    const english = new GeminiDraftAdapter({ client: englishClient, model: "google/gemini-2.5-pro" });
    await expect(english.reviseDraft({ projectId: "p", currentDraft: "Current", latestUserEdit: "Write in English", compactContext: [], outputLanguage: "en" as never })).resolves.toMatchObject({ ok: true });
    expect(englishClient.requests[0]?.input).toContain("\u0430\u043d\u0433\u043b\u0438\u0439\u0441\u043a\u0438\u0439 (en)");
  });
});

class PlanningClient implements GeminiPlanningClient {
  readonly requests: GeminiPlanningInteractionRequest[] = [];
  constructor(private readonly output: string) {}
  async create(request: GeminiPlanningInteractionRequest): Promise<{ output_text?: unknown }> { this.requests.push(request); return { output_text: this.output }; }
}
class DraftClient implements GeminiDraftClient {
  readonly requests: GeminiDraftInteractionRequest[] = [];
  constructor(private readonly output: string) {}
  async create(request: GeminiDraftInteractionRequest): Promise<{ output_text?: unknown }> { this.requests.push(request); return { output_text: this.output }; }
}
function planOption(): PlanOption { return { optionId: "recommended", postCount: 1, title: "\u041e\u0434\u0438\u043d \u043f\u043e\u0441\u0442", angle: "\u0420\u0430\u043a\u0443\u0440\u0441", summary: "\u0417\u0430\u0432\u0435\u0440\u0448\u0451\u043d\u043d\u0430\u044f \u043c\u044b\u0441\u043b\u044c", posts: [{ index: 1, topic: "\u0422\u0435\u043c\u0430", angle: "\u0420\u0430\u043a\u0443\u0440\u0441", includes: ["\u0424\u0430\u043a\u0442"] }] }; }
function draftInput(): Parameters<GeminiDraftAdapter["generateDraft"]>[0] { return { projectId: "p", selectedPlan: planOption(), postIndex: 1, rewriteMode: "make_post", transcript: "MIXED SOURCE TEXT" }; }
function russianPlanOutput(): string { return JSON.stringify({ recommended: { post_count: 1, title: "\u041e\u0434\u0438\u043d \u043f\u043e\u0441\u0442", angle: "\u0420\u0430\u043a\u0443\u0440\u0441", summary: "\u0426\u0435\u043b\u044c\u043d\u0430\u044f \u043c\u044b\u0441\u043b\u044c", posts: [{ index: 1, topic: "\u0422\u0435\u043c\u0430", angle: "\u0420\u0430\u043a\u0443\u0440\u0441", includes: ["\u041f\u0443\u043d\u043a\u0442"] }] }, rationale: "\u041e\u0434\u043d\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043d\u043d\u0430\u044f \u043c\u044b\u0441\u043b\u044c.", confidence: "high", alternatives: [] }); }
function englishPlanOutput(): string { return JSON.stringify({ recommended: { post_count: 1, title: "A complete English plan title", angle: "A clear angle", summary: "A self-contained English summary with a reader payoff", posts: [{ index: 1, topic: "English topic", angle: "English angle", includes: ["English point"] }] }, rationale: "This coherent English rationale explains the value and recommendation.", confidence: "high", alternatives: [] }); }
function russianDraftOutput(): string { return JSON.stringify({ full_text: "\u042d\u0442\u043e \u043f\u043e\u043b\u043d\u044b\u0439 \u0440\u0443\u0441\u0441\u043a\u0438\u0439 \u0447\u0435\u0440\u043d\u043e\u0432\u0438\u043a \u0434\u043b\u044f \u043f\u043e\u0441\u0442\u0430 Telegram.", title: "\u0417\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a" }); }