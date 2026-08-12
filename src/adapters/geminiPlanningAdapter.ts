import { GoogleGenAI } from "@google/genai";
import type { ModelAdapters } from "../domain/modelContracts.js";
import { assertExpectedOutputLanguage, OutputLanguageMismatchError, outputLanguageInstruction } from "../domain/outputLanguage.js";
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
        input: buildPlanPrompt(params.transcript, params.planningHistory, params.outputLanguage),
        response_format: { type: "text", mime_type: "application/json", schema: planningSchema }
      });
      if (typeof interaction.output_text !== "string") return failure("GEMINI_PLAN_OUTPUT_INVALID", "Gemini planning output was missing text.", false);
      const recommendation = parsePlanningResult(interaction.output_text);
      assertExpectedOutputLanguage(planText(recommendation), params.outputLanguage);
      logger.info({ event: "gemini_plan_output_validated", projectId: params.projectId, modelLabel: this.input.model, recommendedPostCount: recommendedPlan(recommendation).postCount, alternativeCount: recommendation.options.length - 1 }, "gemini planning output validated");
      return { ok: true, value: recommendation, meta: { provider: this.input.provider ?? "gemini", modelLabel: this.input.model } };
    } catch (error) {
      logger.warn({ event: "gemini_plan_request_failed", projectId: params.projectId, modelLabel: this.input.model, errorCode: safeErrorCode(error) }, "gemini planning request failed");
      return failure(
        error instanceof OutputLanguageMismatchError ? "GEMINI_PLAN_OUTPUT_LANGUAGE_INVALID" : "GEMINI_PLAN_OUTPUT_INVALID",
        safeMessage(error),
        error instanceof OutputLanguageMismatchError ? false : isRetryableProviderError(error)
      );
    }
  }

  async revisePlan(params: Parameters<ModelAdapters["revisePlan"]>[0]): ReturnType<ModelAdapters["revisePlan"]> {
    const history = [
      "\u0422\u0435\u043a\u0443\u0449\u0430\u044f \u0440\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0443\u0435\u043c\u0430\u044f \u0440\u0430\u0437\u0431\u0438\u0432\u043a\u0430: " + recommendedPlan(params.currentPlan).summary,
      "\u0422\u0435\u043a\u0443\u0449\u0435\u0435 \u043e\u0431\u043e\u0441\u043d\u043e\u0432\u0430\u043d\u0438\u0435: " + params.currentPlan.recommendation.rationale,
      "\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u044f\u044f \u043f\u0440\u0430\u0432\u043a\u0430 \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f: " + params.latestUserEdit
    ];
    const result = await this.planSplit({ projectId: params.projectId, transcript: params.transcript, planningHistory: history, outputLanguage: params.outputLanguage });
    if (!result.ok) return result;
    return { ok: true, value: { ...result.value, changeSummary: "\u0420\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0430\u0446\u0438\u044f \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0430 \u043f\u043e \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0435\u0439 \u043f\u0440\u0430\u0432\u043a\u0435." }, meta: result.meta };
  }
}

export function createGeminiPlanningClient(apiKey: string): GeminiPlanningClient {
  const ai = new GoogleGenAI({ apiKey }) as unknown as { interactions: { create(request: GeminiPlanningInteractionRequest): Promise<{ output_text?: unknown }> } };
  return { create(request) { return ai.interactions.create(request); } };
}

function buildPlanPrompt(
  transcript: string,
  planningHistory: string[],
  outputLanguage: Parameters<ModelAdapters["planSplit"]>[0]["outputLanguage"]
): string {
  const history = planningHistory.length
    ? planningHistory.map((item) => "- " + item).join("\n")
    : "\u041f\u0440\u0430\u0432\u043e\u043a \u043f\u043b\u0430\u043d\u0430 \u0435\u0449\u0451 \u043d\u0435\u0442.";
  return [
    outputLanguageInstruction(outputLanguage),
    "\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u043e\u0446\u0435\u043d\u0438 \u0438\u0441\u0445\u043e\u0434\u043d\u0438\u043a \u0438 \u0437\u0430\u0442\u0435\u043c \u0432\u044b\u0431\u0435\u0440\u0438, \u0441\u0442\u043e\u0438\u0442 \u043b\u0438 \u043f\u0440\u0435\u0432\u0440\u0430\u0449\u0430\u0442\u044c \u0435\u0433\u043e \u0432 \u043e\u0434\u0438\u043d, \u0434\u0432\u0430 \u0438\u043b\u0438 \u0442\u0440\u0438 \u043f\u043e\u0441\u0442\u0430 Telegram.",
    "\u0415\u0441\u043b\u0438 \u0432 \u0438\u0441\u0442\u043e\u0447\u043d\u0438\u043a\u0435 \u043e\u0434\u043d\u0430 \u0446\u0435\u043b\u044c\u043d\u0430\u044f \u043c\u044b\u0441\u043b\u044c, \u043a\u043e\u0440\u043e\u0442\u043a\u0430\u044f \u0438\u0441\u0442\u043e\u0440\u0438\u044f, \u043e\u0434\u043d\u0430 \u0434\u0435\u043c\u043e\u043d\u0441\u0442\u0440\u0430\u0446\u0438\u044f \u0438\u043b\u0438 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043d\u043d\u044b\u0439 \u0430\u0440\u0433\u0443\u043c\u0435\u043d\u0442, \u043f\u0440\u0435\u0434\u043f\u043e\u0447\u0442\u0438 \u043e\u0434\u0438\u043d \u043f\u043e\u0441\u0442.",
    "\u0420\u0430\u0437\u0431\u0438\u0432\u043a\u0430 \u0434\u043e\u043f\u0443\u0441\u0442\u0438\u043c\u0430 \u0442\u043e\u043b\u044c\u043a\u043e, \u0435\u0441\u043b\u0438 \u043a\u0430\u0436\u0434\u044b\u0439 \u043f\u043e\u0441\u0442 \u0441\u0430\u043c\u043e\u0441\u0442\u043e\u044f\u0442\u0435\u043b\u044c\u043d\u043e \u043f\u043e\u043b\u0435\u0437\u0435\u043d, \u043d\u0435 \u043f\u043e\u0432\u0442\u043e\u0440\u044f\u0435\u0442\u0441\u044f, \u0438\u043c\u0435\u0435\u0442 \u0441\u0432\u043e\u0439 \u0437\u0430\u0445\u0432\u0430\u0442 \u0432\u043d\u0438\u043c\u0430\u043d\u0438\u044f \u0438 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043d\u043d\u0443\u044e \u043e\u0442\u0434\u0430\u0447\u0443. \u041e\u0434\u043d\u0430 \u0434\u043b\u0438\u0442\u0435\u043b\u044c\u043d\u043e\u0441\u0442\u044c \u0430\u0443\u0434\u0438\u043e \u043d\u0438\u043a\u043e\u0433\u0434\u0430 \u043d\u0435 \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u044f\u0435\u0442 \u0440\u0430\u0437\u0431\u0438\u0432\u043a\u0443.",
    "\u0412\u0435\u0440\u043d\u0438 \u0440\u043e\u0432\u043d\u043e \u043e\u0434\u043d\u0443 \u0440\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0443\u0435\u043c\u0443\u044e \u0440\u0430\u0437\u0431\u0438\u0432\u043a\u0443. \u0410\u043b\u044c\u0442\u0435\u0440\u043d\u0430\u0442\u0438\u0432\u044b \u0434\u043e\u0431\u0430\u0432\u043b\u044f\u0439 \u0442\u043e\u043b\u044c\u043a\u043e, \u0435\u0441\u043b\u0438 \u043e\u043d\u0438 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0442\u0435\u043b\u044c\u043d\u043e \u043e\u0441\u043c\u044b\u0441\u043b\u0435\u043d\u043d\u044b; \u043d\u0435 \u043f\u0440\u0438\u0434\u0443\u043c\u044b\u0432\u0430\u0439 \u0432\u0430\u0440\u0438\u0430\u043d\u0442\u044b \u0440\u0430\u0434\u0438 \u0432\u0441\u0435\u0445 \u0447\u0438\u0441\u0435\u043b 1/2/3.",
    "\u0412\u0435\u0440\u043d\u0438 \u0442\u043e\u043b\u044c\u043a\u043e JSON \u043f\u043e \u0441\u0445\u0435\u043c\u0435. \u041d\u0435 \u043a\u043e\u043f\u0438\u0440\u0443\u0439 \u0434\u043b\u0438\u043d\u043d\u044b\u0435 \u0444\u0440\u0430\u0433\u043c\u0435\u043d\u0442\u044b \u0440\u0430\u0441\u0448\u0438\u0444\u0440\u043e\u0432\u043a\u0438.",
    "\u0418\u0441\u0442\u043e\u0440\u0438\u044f \u043f\u043b\u0430\u043d\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u044f:\n" + history,
    "\u0420\u0430\u0441\u0448\u0438\u0444\u0440\u043e\u0432\u043a\u0430:\n" + transcript
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

function planText(plan: PlanningResult): string[] {
  return [
    plan.recommendation.rationale,
    ...plan.options.flatMap((option) => [
      option.title,
      option.angle,
      option.summary,
      ...option.posts.flatMap((post) => [post.topic, post.angle, ...post.includes, ...(post.excludes ?? [])])
    ])
  ];
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
