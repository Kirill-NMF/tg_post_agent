import { GoogleGenAI } from "@google/genai";
import type { ModelAdapters } from "../domain/modelContracts.js";
import { assertExpectedOutputLanguage, OutputLanguageMismatchError, outputLanguageInstruction } from "../domain/outputLanguage.js";
import type { AdapterResult, DraftText, PlanPostSlice } from "../domain/types.js";
import { noopLogger, type Logger } from "../observability/logger.js";
import { isRetryableProviderError } from "./providerErrors.js";

export type DraftAdapter = Pick<ModelAdapters, "generateDraft" | "reviseDraft">;

export type GeminiDraftInteractionRequest = {
  model: string;
  input: string;
  response_format: {
    type: "text";
    mime_type: "application/json";
    schema: Record<string, unknown>;
  };
};

export type GeminiDraftClient = {
  create(request: GeminiDraftInteractionRequest): Promise<{ output_text?: unknown }>;
};

export class GeminiDraftAdapter implements DraftAdapter {
  private readonly maxFullTextChars: number;

  constructor(
    private readonly input: {
      client: GeminiDraftClient;
      model: string;
      maxFullTextChars?: number;
      logger?: Logger;
      provider?: "gemini" | "openrouter";
    }
  ) {
    this.maxFullTextChars = input.maxFullTextChars ?? 4000;
  }

  async generateDraft(params: Parameters<ModelAdapters["generateDraft"]>[0]): ReturnType<ModelAdapters["generateDraft"]> {
    if (!params.transcript.trim()) return failure("GEMINI_DRAFT_TRANSCRIPT_EMPTY", "Transcript is required for draft generation.", false);
    const slice = params.selectedPlan.posts.find((post) => post.index === params.postIndex);
    if (!slice) return failure("GEMINI_DRAFT_PLAN_SLICE_MISSING", "Selected plan does not contain the requested post index.", false);

    const logger = this.input.logger ?? noopLogger;
    logger.info({ event: "gemini_draft_request_started", projectId: params.projectId, modelLabel: this.input.model, postIndex: params.postIndex }, "gemini draft request started");

    try {
      const interaction = await this.input.client.create({
        model: this.input.model,
        input: buildDraftPrompt({ ...params, slice }),
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: draftSchema
        }
      });
      if (typeof interaction.output_text !== "string") {
        return failure("GEMINI_DRAFT_OUTPUT_INVALID", "Gemini draft output was missing text.", false);
      }
      const draft = parseDraft(interaction.output_text, this.maxFullTextChars);
      assertExpectedOutputLanguage(draftText(draft), params.outputLanguage);
      logger.info(
        { event: "gemini_draft_output_validated", projectId: params.projectId, modelLabel: this.input.model, postIndex: params.postIndex, draftLength: draft.fullText.length },
        "gemini draft output validated"
      );
      return { ok: true, value: { draft }, meta: { provider: this.input.provider ?? "gemini", modelLabel: this.input.model } };
    } catch (error) {
      logger.warn(
        { event: "gemini_draft_request_failed", projectId: params.projectId, modelLabel: this.input.model, postIndex: params.postIndex, errorCode: safeErrorCode(error) },
        "gemini draft request failed"
      );
      return failure(
        error instanceof OutputLanguageMismatchError ? "GEMINI_DRAFT_OUTPUT_LANGUAGE_INVALID" : "GEMINI_DRAFT_OUTPUT_INVALID",
        safeMessage(error),
        error instanceof OutputLanguageMismatchError ? false : isRetryableProviderError(error)
      );
    }
  }

  async reviseDraft(params: Parameters<ModelAdapters["reviseDraft"]>[0]): ReturnType<ModelAdapters["reviseDraft"]> {
    if (!params.currentDraft.trim()) return failure("GEMINI_DRAFT_CURRENT_DRAFT_EMPTY", "Current draft is required for draft revision.", false);
    if (!params.latestUserEdit.trim()) return failure("GEMINI_DRAFT_EDIT_EMPTY", "Latest user edit is required for draft revision.", false);
    if (params.latestUserEdit.length > 2000) return failure("GEMINI_DRAFT_EDIT_TOO_LONG", "Latest user edit exceeds the configured length limit.", false);

    const logger = this.input.logger ?? noopLogger;
    logger.info({ event: "gemini_draft_revision_request_started", projectId: params.projectId, modelLabel: this.input.model }, "gemini draft revision request started");

    try {
      const interaction = await this.input.client.create({
        model: this.input.model,
        input: buildDraftRevisionPrompt(params),
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: draftSchema
        }
      });
      if (typeof interaction.output_text !== "string") {
        return failure("GEMINI_DRAFT_REVISION_OUTPUT_INVALID", "Gemini draft revision output was missing text.", false);
      }
      const updatedDraft = parseDraft(interaction.output_text, this.maxFullTextChars);
      assertExpectedOutputLanguage(draftText(updatedDraft), params.outputLanguage);
      logger.info(
        { event: "gemini_draft_revision_output_validated", projectId: params.projectId, modelLabel: this.input.model, draftLength: updatedDraft.fullText.length },
        "gemini draft revision output validated"
      );
      return { ok: true, value: { updatedDraft }, meta: { provider: this.input.provider ?? "gemini", modelLabel: this.input.model } };
    } catch (error) {
      logger.warn(
        { event: "gemini_draft_revision_request_failed", projectId: params.projectId, modelLabel: this.input.model, errorCode: safeErrorCode(error) },
        "gemini draft revision request failed"
      );
      return failure(
        error instanceof OutputLanguageMismatchError ? "GEMINI_DRAFT_REVISION_OUTPUT_LANGUAGE_INVALID" : "GEMINI_DRAFT_REVISION_OUTPUT_INVALID",
        safeMessage(error),
        error instanceof OutputLanguageMismatchError ? false : isRetryableProviderError(error)
      );
    }
  }
}

export function createGeminiDraftClient(apiKey: string): GeminiDraftClient {
  const ai = new GoogleGenAI({ apiKey }) as unknown as {
    interactions: { create(request: GeminiDraftInteractionRequest): Promise<{ output_text?: unknown }> };
  };
  return {
    create(request) {
      return ai.interactions.create(request);
    }
  };
}

function buildDraftPrompt(params: Parameters<ModelAdapters["generateDraft"]>[0] & { slice: PlanPostSlice }): string {
  if (params.rewriteMode === "clean_up") {
    return [
      outputLanguageInstruction(params.outputLanguage),
      "\u0412\u0435\u0440\u043d\u0438 \u0442\u043e\u043b\u044c\u043a\u043e JSON \u043f\u043e \u0441\u0445\u0435\u043c\u0435. \u0420\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442 \u0434\u043e\u043b\u0436\u0435\u043d \u043f\u043e\u043b\u043d\u043e\u0441\u0442\u044c\u044e \u0437\u0430\u043c\u0435\u043d\u044f\u0442\u044c \u0447\u0435\u0440\u043d\u043e\u0432\u0438\u043a.",
      "\u0421\u043e\u0445\u0440\u0430\u043d\u044f\u0439 \u0432\u0441\u0435 \u0441\u043b\u043e\u0432\u0430 \u0438 \u0432\u0435\u0441\u044c \u0441\u043c\u044b\u0441\u043b \u0438\u0441\u0445\u043e\u0434\u043d\u043e\u0433\u043e \u0442\u0435\u043a\u0441\u0442\u0430 \u0441\u043b\u043e\u0432\u043e \u0432 \u0441\u043b\u043e\u0432\u043e. \u041d\u0438\u0447\u0435\u0433\u043e \u043d\u0435 \u0441\u043e\u043a\u0440\u0430\u0449\u0430\u0439, \u043d\u0435 \u0432\u044b\u0431\u0440\u0430\u0441\u044b\u0432\u0430\u0439 \u0438 \u043d\u0435 \u043e\u0431\u043e\u0431\u0449\u0430\u0439.",
      "\u0420\u0430\u0437\u0440\u0435\u0448\u0435\u043d\u043e \u0442\u043e\u043b\u044c\u043a\u043e: \u0440\u0430\u0441\u0441\u0442\u0430\u0432\u0438\u0442\u044c \u043f\u0443\u043d\u043a\u0442\u0443\u0430\u0446\u0438\u044e \u0438 \u0437\u0430\u0433\u043b\u0430\u0432\u043d\u044b\u0435 \u0431\u0443\u043a\u0432\u044b, \u0438\u0441\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u0442\u043e\u043b\u044c\u043a\u043e \u0431\u0435\u0437\u043e\u0448\u0438\u0431\u043e\u0447\u043d\u043e \u0440\u0430\u0441\u043f\u043e\u0437\u043d\u0430\u0432\u0430\u0435\u043c\u044b\u0435 ASR-\u043e\u0448\u0438\u0431\u043a\u0438 \u0438 \u0440\u0430\u0437\u0434\u0435\u043b\u0438\u0442\u044c \u0442\u0435\u043a\u0441\u0442 \u043d\u0430 \u0447\u0438\u0442\u0430\u0435\u043c\u044b\u0435 \u0430\u0431\u0437\u0430\u0446\u044b.",
      "\u041d\u0435 \u0434\u043e\u0431\u0430\u0432\u043b\u044f\u0439 \u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a, CTA, \u0445\u044d\u0448\u0442\u0435\u0433\u0438, \u0441\u043f\u0438\u0441\u043a\u0438, \u0440\u0435\u0434\u0430\u043a\u0442\u043e\u0440\u0441\u043a\u0438\u0435 \u043c\u0435\u0442\u043a\u0438 \u0438\u043b\u0438 \u0441\u0442\u0440\u0443\u043a\u0442\u0443\u0440\u0443 Telegram-\u043f\u043e\u0441\u0442\u0430. \u041d\u0435 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0439 \u043f\u043b\u0430\u043d, \u0435\u0433\u043e \u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a \u0438\u043b\u0438 \u0435\u0433\u043e \u043c\u0435\u0442\u0430\u0434\u0430\u043d\u043d\u044b\u0435.",
      `\u0420\u0430\u0441\u0448\u0438\u0444\u0440\u043e\u0432\u043a\u0430:\n${params.transcript}`
    ].join("\n\n");
  }

  const compactContext = params.compactContext?.length ? params.compactContext.map((item) => `- ${item}`).join("\n") : "No previous draft edits.";
  return [
    outputLanguageInstruction(params.outputLanguage),
    "Generate one complete Russian Telegram post draft for the selected plan slice.",
    "Return only JSON that matches the schema.",
    "The output must be a full replacement draft, not a patch or instructions.",
    "Do not format as Option 1 or Option 2; formatting is a later stage.",
    "Turn the selected transcript material into a polished Telegram post while preserving facts, intent, and voice.",
    `Post index: ${params.postIndex} of ${params.selectedPlan.postCount}`,
    `Plan title: ${params.selectedPlan.title}`,
    `Plan slice topic: ${params.slice.topic}`,
    `Plan slice angle: ${params.slice.angle}`,
    `Plan slice includes: ${params.slice.includes.join("; ")}`,
    `Plan slice excludes: ${(params.slice.excludes ?? []).join("; ") || "none"}`,
    `Compact edit context:\n${compactContext}`,
    `Transcript:\n${params.transcript}`
  ].join("\n\n");
}

function buildDraftRevisionPrompt(params: Parameters<ModelAdapters["reviseDraft"]>[0]): string {
  const compactContext = params.compactContext.length
    ? params.compactContext.map((item) => `- ${item}`).join("\n")
    : "\u041f\u0440\u0435\u0434\u044b\u0434\u0443\u0449\u0438\u0445 \u043f\u0440\u0430\u0432\u043e\u043a \u043d\u0435\u0442.";

  return [
    outputLanguageInstruction(params.outputLanguage),
    "\u041e\u0431\u043d\u043e\u0432\u0438 \u0442\u0435\u043a\u0443\u0449\u0438\u0439 \u0447\u0435\u0440\u043d\u043e\u0432\u0438\u043a \u043f\u043e\u0441\u0442\u0430 Telegram \u0441 \u0443\u0447\u0451\u0442\u043e\u043c \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0435\u0439 \u043f\u0440\u0430\u0432\u043a\u0438 \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f.",
    "\u0412\u0435\u0440\u043d\u0438 \u0442\u043e\u043b\u044c\u043a\u043e JSON \u043f\u043e \u0441\u0445\u0435\u043c\u0435. \u041d\u0443\u0436\u0435\u043d \u043f\u043e\u043b\u043d\u044b\u0439 \u0437\u0430\u043c\u0435\u043d\u044f\u044e\u0449\u0438\u0439 \u0447\u0435\u0440\u043d\u043e\u0432\u0438\u043a, \u043d\u0435 \u043f\u0430\u0442\u0447, \u043d\u0435 \u0434\u0438\u0444\u0444, \u043d\u0435 \u043a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0438.",
    "\u0421\u043e\u0445\u0440\u0430\u043d\u0438 \u0447\u0438\u0442\u0430\u0435\u043c\u044b\u0435 \u0430\u0431\u0437\u0430\u0446\u044b. \u041d\u0435 \u0434\u0435\u043b\u0430\u0439 \u043e\u0444\u043e\u0440\u043c\u043b\u0435\u043d\u0438\u0435 Option 1/Option 2 \u0438 \u043d\u0435 \u0434\u043e\u0431\u0430\u0432\u043b\u044f\u0439 \u043f\u0443\u0431\u043b\u0438\u043a\u0430\u0446\u0438\u044e \u0432 \u043a\u0430\u043d\u0430\u043b.",
    `\u041a\u043e\u043d\u0442\u0435\u043a\u0441\u0442 \u043f\u0440\u0430\u0432\u043e\u043a:\n${compactContext}`,
    `\u0422\u0435\u043a\u0443\u0449\u0438\u0439 \u0447\u0435\u0440\u043d\u043e\u0432\u0438\u043a:\n${params.currentDraft}`,
    `\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u044f\u044f \u043f\u0440\u0430\u0432\u043a\u0430:\n${params.latestUserEdit}`
  ].join("\n\n");
}

const draftSchema = {
  type: "object",
  additionalProperties: false,
  required: ["full_text"],
  properties: {
    full_text: { type: "string" },
    title: { type: "string" },
    body: { type: "string" },
    cta: { type: "string" },
    notes: { type: "array", items: { type: "string" } }
  }
};

const allowedDraftKeys = new Set(["full_text", "title", "body", "cta", "notes"]);

function parseDraft(raw: string, maxFullTextChars: number): DraftText {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) throw new Error("Draft output must be an object.");
  for (const key of Object.keys(parsed)) {
    if (!allowedDraftKeys.has(key)) throw new Error("Draft output contains an unsupported field.");
  }

  const fullText = cleanMultilineString(parsed.full_text, maxFullTextChars, "full_text");
  return {
    fullText,
    title: optionalCleanString(parsed.title, 180, "title"),
    body: optionalCleanMultilineString(parsed.body, maxFullTextChars, "body"),
    cta: optionalCleanString(parsed.cta, 280, "cta"),
    notes: optionalCleanStringArray(parsed.notes, 8, 180)
  };
}

function cleanString(value: unknown, maxLength: number, fieldName: string): string {
  if (typeof value !== "string") throw new Error(`Draft ${fieldName} must be a string.`);
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) throw new Error(`Draft ${fieldName} must not be empty.`);
  if (cleaned.length > maxLength) throw new Error(`Draft ${fieldName} exceeds the configured length limit.`);
  return cleaned;
}

function optionalCleanString(value: unknown, maxLength: number, fieldName: string): string | undefined {
  if (value === undefined) return undefined;
  return cleanString(value, maxLength, fieldName);
}

function cleanMultilineString(value: unknown, maxLength: number, fieldName: string): string {
  if (typeof value !== "string") throw new Error(`Draft ${fieldName} must be a string.`);
  const cleaned = value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, "").replace(/^[ \t]+/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!cleaned) throw new Error(`Draft ${fieldName} must not be empty.`);
  if (cleaned.length > maxLength) throw new Error(`Draft ${fieldName} exceeds the configured length limit.`);
  return cleaned;
}

function optionalCleanMultilineString(value: unknown, maxLength: number, fieldName: string): string | undefined {
  if (value === undefined) return undefined;
  return cleanMultilineString(value, maxLength, fieldName);
}

function optionalCleanStringArray(value: unknown, maxItems: number, maxLength: number): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("Draft notes must be an array.");
  const notes = value.map((item) => cleanString(item, maxLength, "note"));
  if (notes.length > maxItems) throw new Error("Draft notes exceed the configured item limit.");
  return notes.length ? notes : undefined;
}

function draftText(draft: DraftText): Array<string | undefined> {
  return [draft.fullText, draft.title, draft.body, draft.cta, ...(draft.notes ?? [])];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function failure(code: string, message: string, retryable: boolean): AdapterResult<never> {
  return { ok: false, error: { code, message: message.slice(0, 500), retryable } };
}

function safeMessage(error: unknown): string {
  if (error instanceof OutputLanguageMismatchError) return "Draft output did not match the requested language.";
  if (error instanceof SyntaxError) return "Gemini draft output was not valid JSON.";
  if (error instanceof Error) return error.message.replace(/AIza[0-9A-Za-z_-]+/g, "[redacted]").slice(0, 500);
  return "Gemini draft request failed.";
}

function safeErrorCode(error: unknown): string {
  if (error instanceof OutputLanguageMismatchError) return error.code;
  if (error instanceof SyntaxError) return "SyntaxError";
  if (error instanceof Error && error.name) return error.name.slice(0, 80);
  return "GEMINI_DRAFT_FAILED";
}
