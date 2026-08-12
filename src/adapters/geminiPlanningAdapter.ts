import { GoogleGenAI } from "@google/genai";
import type { ModelAdapters } from "../domain/modelContracts.js";
import type { PlanOption, PlanPostSlice, PlanningConfidence, PlanningResult } from "../domain/types.js";
import { isRetryableProviderError } from "./providerErrors.js";
import { noopLogger, type Logger } from "../observability/logger.js";

export type PlanSplitAdapter = Pick<ModelAdapters, "planSplit" | "revisePlan">;
export type GeminiPlanningInteractionRequest = {
  model: string;
  input: string;
  response_format: { type: "text"; mime_type: "application/json"; schema: Record<string, unknown> };
};
export type GeminiPlanningClient = { create(request: GeminiPlanningInteractionRequest): Promise<{ output_text?: unknown }> };

export class GeminiPlanningAdapter implements PlanSplitAdapter {
  constructor(private readonly input: { client: GeminiPlanningClient; model: string; logger?: Logger; provider?: "gemini" | "openrouter" }) {}

  async planSplit(params: Parameters<ModelAdapters["planSplit"]>[0]): ReturnType<ModelAdapters["planSplit"]> {
    if (!params.transcript.trim()) return failure("GEMINI_PLAN_TRANSCRIPT_EMPTY", "Transcript is required for planning.", false);
    const logger = this.input.logger ?? noopLogger;
    logger.info({ event: "gemini_plan_request_started", projectId: params.projectId, modelLabel: this.input.model }, "gemini planning request started");
    try {
      const interaction = await this.input.client.create({
        model: this.input.model,
        input: buildPlanPrompt(params.transcript, params.planningHistory),
        response_format: { type: "text", mime_type: "application/json", schema: planningSchema }
      });
      if (typeof interaction.output_text !== "string") return failure("GEMINI_PLAN_OUTPUT_INVALID", "Gemini planning output was missing text.", false);
      const recommendation = parsePlanningResult(interaction.output_text);
      logger.info({ event: "gemini_plan_output_validated", projectId: params.projectId, modelLabel: this.input.model, recommendedPostCount: recommendedPlan(recommendation).postCount, alternativeCount: recommendation.options.length - 1 }, "gemini planning output validated");
      return { ok: true, value: recommendation, meta: { provider: this.input.provider ?? "gemini", modelLabel: this.input.model } };
    } catch (error) {
      logger.warn({ event: "gemini_plan_request_failed", projectId: params.projectId, modelLabel: this.input.model, errorCode: safeErrorCode(error) }, "gemini planning request failed");
      return failure("GEMINI_PLAN_OUTPUT_INVALID", safeMessage(error), isRetryableProviderError(error));
    }
  }

  async revisePlan(params: Parameters<ModelAdapters["revisePlan"]>[0]): ReturnType<ModelAdapters["revisePlan"]> {
    const history = [
      "Current recommended plan: " + recommendedPlan(params.currentPlan).summary,
      "Current rationale: " + params.currentPlan.recommendation.rationale,
      "Latest user correction: " + params.latestUserEdit
    ];
    const result = await this.planSplit({ projectId: params.projectId, transcript: params.transcript, planningHistory: history });
    if (!result.ok) return result;
    return { ok: true, value: { ...result.value, changeSummary: "Plan recommendation regenerated from the latest correction." }, meta: result.meta };
  }
}

export function createGeminiPlanningClient(apiKey: string): GeminiPlanningClient {
  const ai = new GoogleGenAI({ apiKey }) as unknown as { interactions: { create(request: GeminiPlanningInteractionRequest): Promise<{ output_text?: unknown }> } };
  return { create(request) { return ai.interactions.create(request); } };
}

function buildPlanPrompt(transcript: string, planningHistory: string[]): string {
  const history = planningHistory.length ? planningHistory.map((item) => "- " + item).join("\n") : "No planning revisions yet.";
  return [
    "Assess the source before choosing whether it should become one, two, or three Russian Telegram posts.",
    "Prefer one post for one coherent thesis, short story, one demonstration, or one complete argument.",
    "Recommend a split only when every post is independently useful, non-repetitive, has its own hook and complete payoff, and improves clarity or reader attention.",
    "Duration alone must never justify a split. Respect explicit user requests in planning history to split or keep one post.",
    "Return exactly one recommended plan. Alternatives are optional and only allowed when materially meaningful; never manufacture options to cover all counts.",
    "Return only JSON matching the schema. Do not copy long transcript passages.",
    "Planning history:\n" + history,
    "Transcript:\n" + transcript
  ].join("\n\n");
}

const planSchema = {
  type: "object", additionalProperties: false, required: ["post_count", "title", "angle", "summary", "posts"],
  properties: {
    post_count: { type: "integer", enum: [1, 2, 3] },
    title: { type: "string" }, angle: { type: "string" }, summary: { type: "string" },
    posts: {
      type: "array", items: {
        type: "object", additionalProperties: false, required: ["index", "topic", "angle", "includes"],
        properties: {
          index: { type: "integer", enum: [1, 2, 3] }, topic: { type: "string" }, angle: { type: "string" },
          includes: { type: "array", items: { type: "string" } }, excludes: { type: "array", items: { type: "string" } }
        }
      }
    }
  }
};

const planningSchema = {
  type: "object", additionalProperties: false, required: ["recommended", "rationale", "confidence", "alternatives"],
  properties: {
    recommended: planSchema,
    rationale: { type: "string" },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    alternatives: { type: "array", minItems: 0, maxItems: 2, items: planSchema }
  }
};

function parsePlanningResult(raw: string): PlanningResult {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || !isRecord(parsed.recommended) || !Array.isArray(parsed.alternatives)) throw new Error("Planning output must contain recommended plan and alternatives.");
  if (parsed.alternatives.length > 2) throw new Error("Planning output has too many alternatives.");
  const plans = [parsePlan(parsed.recommended, "recommended"), ...parsed.alternatives.map((item, index) => parsePlan(item, "alternative_" + (index + 2)))];
  const counts = new Set(plans.map((plan) => plan.postCount));
  if (counts.size !== plans.length) throw new Error("Planning alternatives must use distinct post counts.");
  return {
    options: plans,
    recommendation: {
      recommendedOptionId: "recommended",
      rationale: cleanString(parsed.rationale, 360),
      confidence: parseConfidence(parsed.confidence)
    }
  };
}

function parsePlan(value: unknown, optionId: string): PlanOption {
  if (!isRecord(value)) throw new Error("Planning option must be an object.");
  const postCount = parsePostCount(value.post_count);
  if (!Array.isArray(value.posts) || value.posts.length !== postCount) throw new Error("Planning post slice count is invalid.");
  const posts = value.posts.map(parsePostSlice);
  for (let index = 1; index <= postCount; index += 1) if (posts[index - 1]?.index !== index) throw new Error("Planning post slice indexes must be contiguous.");
  return { optionId, postCount, title: cleanString(value.title, 160), angle: cleanString(value.angle, 240), summary: cleanString(value.summary, 700), posts };
}

function parsePostSlice(value: unknown): PlanPostSlice {
  if (!isRecord(value)) throw new Error("Planning post slice must be an object.");
  const excludes = value.excludes === undefined ? [] : cleanStringArray(value.excludes, 8, 160);
  return { index: parsePostIndex(value.index), topic: cleanString(value.topic, 160), angle: cleanString(value.angle, 240), includes: cleanStringArray(value.includes, 10, 160), excludes: excludes.length ? excludes : undefined };
}

function parseConfidence(value: unknown): PlanningConfidence {
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new Error("Planning confidence is invalid.");
}
function parsePostCount(value: unknown): 1 | 2 | 3 { if (value === 1 || value === 2 || value === 3) return value; throw new Error("Planning post count is invalid."); }
function parsePostIndex(value: unknown): 1 | 2 | 3 { if (value === 1 || value === 2 || value === 3) return value; throw new Error("Planning post index is invalid."); }
function recommendedPlan(value: PlanningResult): PlanOption { const option = value.options.find((item) => item.optionId === value.recommendation.recommendedOptionId); if (!option) throw new Error("Recommended plan is missing."); return option; }
function cleanString(value: unknown, maxLength: number): string { if (typeof value !== "string") throw new Error("Planning text field must be a string."); const cleaned = value.replace(/\s+/g, " ").trim(); if (!cleaned) throw new Error("Planning text field must not be empty."); return cleaned.slice(0, maxLength); }
function cleanStringArray(value: unknown, maxItems: number, maxLength: number): string[] { if (!Array.isArray(value)) throw new Error("Planning list field must be an array."); const cleaned = value.map((item) => cleanString(item, maxLength)).filter(Boolean).slice(0, maxItems); if (!cleaned.length) throw new Error("Planning list field must not be empty."); return cleaned; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function failure(code: string, message: string, retryable: boolean): ReturnType<ModelAdapters["planSplit"]> extends Promise<infer Result> ? Result : never { return { ok: false, error: { code, message: message.slice(0, 500), retryable } }; }
function safeMessage(error: unknown): string { if (error instanceof SyntaxError) return "Gemini planning output was not valid JSON."; if (error instanceof Error) return error.message.replace(/AIza[0-9A-Za-z_-]+/g, "[redacted]").slice(0, 500); return "Gemini planning request failed."; }
function safeErrorCode(error: unknown): string { if (error instanceof SyntaxError) return "SyntaxError"; if (error instanceof Error && error.name) return error.name.slice(0, 80); return "GEMINI_PLAN_FAILED"; }
