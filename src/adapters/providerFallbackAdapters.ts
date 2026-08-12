import type { DraftAdapter } from "./geminiDraftAdapter.js";
import type { PlanSplitAdapter } from "./geminiPlanningAdapter.js";
import { isRetryableProviderError, safeProviderErrorCode } from "./providerErrors.js";
import type { TranscriptionAdapter, TranscriptionInput, TranscriptionResult } from "../domain/audioTypes.js";
import type { AdapterResult, AdapterMeta } from "../domain/types.js";
import { noopLogger, type Logger } from "../observability/logger.js";

type ProviderName = AdapterMeta["provider"];

export class FallbackTranscriptionAdapter implements TranscriptionAdapter {
  constructor(private readonly input: { primary: TranscriptionAdapter; primaryProvider: ProviderName; fallback?: TranscriptionAdapter; fallbackProvider?: ProviderName; logger?: Logger }) {
    logRoute(input.logger ?? noopLogger, "transcription", input.primaryProvider, input.fallbackProvider);
  }
  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    try {
      return await this.input.primary.transcribe(input);
    } catch (error) {
      if (!this.input.fallback || !this.input.fallbackProvider || !isRetryableProviderError(error)) throw error;
      logFallback(this.input.logger ?? noopLogger, "transcription", this.input.primaryProvider, this.input.fallbackProvider, error);
      return this.input.fallback.transcribe(input);
    }
  }
}

export class FallbackPlanningAdapter implements PlanSplitAdapter {
  constructor(private readonly input: { primary: PlanSplitAdapter; primaryProvider: ProviderName; fallback?: PlanSplitAdapter; fallbackProvider?: ProviderName; logger?: Logger }) {
    logRoute(input.logger ?? noopLogger, "planning", input.primaryProvider, input.fallbackProvider);
  }
  async planSplit(params: Parameters<PlanSplitAdapter["planSplit"]>[0]): ReturnType<PlanSplitAdapter["planSplit"]> {
    return this.withFallback("planning", () => this.input.primary.planSplit(params), () => this.input.fallback?.planSplit(params));
  }
  async revisePlan(params: Parameters<PlanSplitAdapter["revisePlan"]>[0]): ReturnType<PlanSplitAdapter["revisePlan"]> {
    return this.withFallback("plan_revision", () => this.input.primary.revisePlan(params), () => this.input.fallback?.revisePlan(params));
  }
  private async withFallback<T>(operation: string, primary: () => Promise<AdapterResult<T>>, fallback: () => Promise<AdapterResult<T>> | undefined): Promise<AdapterResult<T>> {
    const result = await primary();
    if (result.ok || !result.error.retryable || !this.input.fallback || !this.input.fallbackProvider) return result;
    logFallback(this.input.logger ?? noopLogger, operation, this.input.primaryProvider, this.input.fallbackProvider, result.error.code);
    return fallback() ?? result;
  }
}

export class FallbackDraftAdapter implements DraftAdapter {
  constructor(private readonly input: { primary: DraftAdapter; primaryProvider: ProviderName; fallback?: DraftAdapter; fallbackProvider?: ProviderName; logger?: Logger }) {
    logRoute(input.logger ?? noopLogger, "draft", input.primaryProvider, input.fallbackProvider);
  }
  async generateDraft(params: Parameters<DraftAdapter["generateDraft"]>[0]): ReturnType<DraftAdapter["generateDraft"]> {
    return this.withFallback("draft_generation", () => this.input.primary.generateDraft(params), () => this.input.fallback?.generateDraft(params));
  }
  async reviseDraft(params: Parameters<DraftAdapter["reviseDraft"]>[0]): ReturnType<DraftAdapter["reviseDraft"]> {
    return this.withFallback("draft_revision", () => this.input.primary.reviseDraft(params), () => this.input.fallback?.reviseDraft(params));
  }
  private async withFallback<T>(operation: string, primary: () => Promise<AdapterResult<T>>, fallback: () => Promise<AdapterResult<T>> | undefined): Promise<AdapterResult<T>> {
    const result = await primary();
    if (result.ok || !result.error.retryable || !this.input.fallback || !this.input.fallbackProvider) return result;
    logFallback(this.input.logger ?? noopLogger, operation, this.input.primaryProvider, this.input.fallbackProvider, result.error.code);
    return fallback() ?? result;
  }
}

function logRoute(logger: Logger, operation: string, primary: ProviderName, fallback?: ProviderName): void {
  logger.info({ event: "provider_route_configured", operation, primaryProvider: primary, fallbackProvider: fallback ?? null }, "provider route configured");
}
function logFallback(logger: Logger, operation: string, primary: ProviderName, fallback: ProviderName, error: unknown): void {
  logger.warn({ event: "provider_fallback_started", operation, primaryProvider: primary, fallbackProvider: fallback, errorCode: typeof error === "string" ? error : safeProviderErrorCode(error) }, "retryable provider request failed; using configured fallback");
}
