import { GoogleGenAI } from "@google/genai";
import type { ModelAdapters } from "../domain/modelContracts.js";
import type { PlanOption, PlanOptionId, PlanPostSlice } from "../domain/types.js";
import { isRetryableProviderError } from "./providerErrors.js";
import { noopLogger, type Logger } from "../observability/logger.js";
import { planOptionOrder } from "../services/planningPresentation.js";


export type PlanSplitAdapter = Pick<ModelAdapters, "planSplit" | "revisePlan">;
export type GeminiPlanningInteractionRequest = {
  model: string;
  input: string;
  response_format: {
    type: "text";
    mime_type: "application/json";
    schema: Record<string, unknown>;
  };
};

export type GeminiPlanningClient = {
  create(request: GeminiPlanningInteractionRequest): Promise<{ output_text?: unknown }>;
};

export class GeminiPlanningAdapter implements PlanSplitAdapter {
  constructor(
    private readonly input: {
      client: GeminiPlanningClient;
      model: string;
      logger?: Logger;
      provider?: "gemini" | "openrouter";
    }
  ) {}

  async planSplit(params: Parameters<ModelAdapters["planSplit"]>[0]): ReturnType<ModelAdapters["planSplit"]> {
    if (!params.transcript.trim()) {
      return failure("GEMINI_PLAN_TRANSCRIPT_EMPTY", "Transcript is required for planning.", false);
    }

    const logger = this.input.logger ?? noopLogger;
    logger.info({ event: "gemini_plan_request_started", projectId: params.projectId, modelLabel: this.input.model }, "gemini planning request started");

    try {
      const interaction = await this.input.client.create({
        model: this.input.model,
        input: buildPlanSplitPrompt(params.transcript, params.planningHistory),
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: planSplitSchema
        }
      });
      if (typeof interaction.output_text !== "string") {
        return failure("GEMINI_PLAN_OUTPUT_INVALID", "Gemini planning output was missing text.", false);
      }
      const options = parsePlanOptions(interaction.output_text);
      logger.info({ event: "gemini_plan_output_validated", projectId: params.projectId, modelLabel: this.input.model, optionCount: options.length }, "gemini planning output validated");
      return { ok: true, value: { options }, meta: { provider: this.input.provider ?? "gemini", modelLabel: this.input.model } };
    } catch (error) {
      logger.warn({ event: "gemini_plan_request_failed", projectId: params.projectId, modelLabel: this.input.model, errorCode: safeErrorCode(error) }, "gemini planning request failed");
      return failure("GEMINI_PLAN_OUTPUT_INVALID", safeMessage(error), isRetryableProviderError(error));
    }
  }

  async revisePlan(params: Parameters<ModelAdapters["revisePlan"]>[0]): ReturnType<ModelAdapters["revisePlan"]> {
    const history = [
      ...params.currentOptions.map((option) => "Current " + option.optionId + ": " + option.summary),
      "Latest user correction: " + params.latestUserEdit
    ];
    const result = await this.planSplit({ projectId: params.projectId, transcript: params.transcript, planningHistory: history });
    if (!result.ok) return result;
    return {
      ok: true,
      value: { options: result.value.options, changeSummary: "Plan options regenerated from the latest correction." },
      meta: result.meta
    };
  }
}

export function createGeminiPlanningClient(apiKey: string): GeminiPlanningClient {
  const ai = new GoogleGenAI({ apiKey }) as unknown as {
    interactions: { create(request: GeminiPlanningInteractionRequest): Promise<{ output_text?: unknown }> };
  };
  return {
    create(request) {
      return ai.interactions.create(request);
    }
  };
}

function buildPlanSplitPrompt(transcript: string, planningHistory: string[]): string {
  const history = planningHistory.length ? planningHistory.map((item) => `- ${item}`).join("\n") : "No planning revisions yet.";
  return [
    "Create exactly three Russian content plan options for a Telegram post series.",
    "Return only JSON that matches the schema.",
    "The options must be one_post, two_posts, and three_posts.",
    "Do not copy long transcript passages; summarize structure and angles.",
    `Planning history:\n${history}`,
    `Transcript:\n${transcript}`
  ].join("\n\n");
}

const planSplitSchema = {
  type: "object",
  additionalProperties: false,
  required: ["options"],
  properties: {
    options: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["option_id", "post_count", "title", "angle", "summary", "posts"],
        properties: {
          option_id: { type: "string", enum: planOptionOrder },
          post_count: { type: "integer", enum: [1, 2, 3] },
          title: { type: "string" },
          angle: { type: "string" },
          summary: { type: "string" },
          posts: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["index", "topic", "angle", "includes"],
              properties: {
                index: { type: "integer", enum: [1, 2, 3] },
                topic: { type: "string" },
                angle: { type: "string" },
                includes: { type: "array", items: { type: "string" } },
                excludes: { type: "array", items: { type: "string" } }
              }
            }
          }
        }
      }
    }
  }
};

function parsePlanOptions(raw: string): PlanOption[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.options) || parsed.options.length !== 3) throw new Error("Planning output must contain exactly three options.");

  const options = parsed.options.map(parsePlanOption);
  const ids = new Set(options.map((option) => option.optionId));
  if (ids.size !== 3 || !planOptionOrder.every((id) => ids.has(id))) throw new Error("Planning options must include one_post, two_posts, and three_posts exactly once.");

  return [...options].sort((left, right) => left.postCount - right.postCount);
}

function parsePlanOption(value: unknown): PlanOption {
  if (!isRecord(value)) throw new Error("Planning option must be an object.");
  const optionId = parseOptionId(value.option_id);
  const postCount = parsePostCount(value.post_count);
  if (postCount !== expectedPostCount(optionId)) throw new Error("Planning option post_count does not match option_id.");
  if (!Array.isArray(value.posts) || value.posts.length !== postCount) throw new Error("Planning option post slice count is invalid.");

  const posts = value.posts.map((post) => parsePostSlice(post));
  for (let index = 1; index <= postCount; index += 1) {
    if (posts[index - 1]?.index !== index) throw new Error("Planning post slice indexes must be contiguous.");
  }

  return {
    optionId,
    postCount,
    title: cleanString(value.title, 160),
    angle: cleanString(value.angle, 240),
    summary: cleanString(value.summary, 700),
    posts
  };
}

function parsePostSlice(value: unknown): PlanPostSlice {
  if (!isRecord(value)) throw new Error("Planning post slice must be an object.");
  const index = parsePostIndex(value.index);
  const excludes = value.excludes === undefined ? [] : cleanStringArray(value.excludes, 8, 160);
  return {
    index,
    topic: cleanString(value.topic, 160),
    angle: cleanString(value.angle, 240),
    includes: cleanStringArray(value.includes, 10, 160),
    excludes: excludes.length ? excludes : undefined
  };
}

function parseOptionId(value: unknown): PlanOptionId {
  if (value === "one_post" || value === "two_posts" || value === "three_posts") return value;
  throw new Error("Planning option id is invalid.");
}

function parsePostCount(value: unknown): 1 | 2 | 3 {
  if (value === 1 || value === 2 || value === 3) return value;
  throw new Error("Planning post count is invalid.");
}

function parsePostIndex(value: unknown): 1 | 2 | 3 {
  if (value === 1 || value === 2 || value === 3) return value;
  throw new Error("Planning post index is invalid.");
}

function expectedPostCount(optionId: PlanOptionId): 1 | 2 | 3 {
  if (optionId === "one_post") return 1;
  if (optionId === "two_posts") return 2;
  return 3;
}

function cleanString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") throw new Error("Planning text field must be a string.");
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) throw new Error("Planning text field must not be empty.");
  return cleaned.slice(0, maxLength);
}

function cleanStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) throw new Error("Planning list field must be an array.");
  const cleaned = value.map((item) => cleanString(item, maxLength)).filter(Boolean).slice(0, maxItems);
  if (cleaned.length === 0) throw new Error("Planning list field must not be empty.");
  return cleaned;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function failure(code: string, message: string, retryable: boolean): ReturnType<ModelAdapters["planSplit"]> extends Promise<infer Result> ? Result : never {
  return { ok: false, error: { code, message: message.slice(0, 500), retryable } };
}

function safeMessage(error: unknown): string {
  if (error instanceof SyntaxError) return "Gemini planning output was not valid JSON.";
  if (error instanceof Error) return error.message.replace(/AIza[0-9A-Za-z_-]+/g, "[redacted]").slice(0, 500);
  return "Gemini planning request failed.";
}

function safeErrorCode(error: unknown): string {
  if (error instanceof SyntaxError) return "SyntaxError";
  if (error instanceof Error && error.name) return error.name.slice(0, 80);
  return "GEMINI_PLAN_FAILED";
}
