import type { ModelAdapters } from "../domain/modelContracts.js";
import type { Job } from "../domain/jobTypes.js";
import type { Project, ProjectMessageKind } from "../domain/types.js";
import { noopLogger, type Logger } from "../observability/logger.js";
import type { ProjectRepository } from "../repositories/projectRepository.js";
import type { TelegramNotifier } from "../telegram/telegramNotifier.js";
import { draftGenerationRetryMarkup, draftReplyMarkup } from "./draftPresentation.js";
import { PermanentJobError, RetryableJobError, type JobHandler } from "./jobWorker.js";

export type GenerateDraftJobHandlerDeps = {
  projects: ProjectRepository;
  drafting: Pick<ModelAdapters, "generateDraft">;
  notifier?: TelegramNotifier;
  logger?: Logger;
  formattingEnabled?: boolean;
  now?: () => number;
};

export function createGenerateDraftJobHandler(deps: GenerateDraftJobHandlerDeps): JobHandler {
  return async (job: Job) => {
    if (job.type !== "GENERATE_DRAFT") throw new PermanentJobError("UNEXPECTED_JOB_TYPE", "Handler received an unexpected job type.");
    if (!job.projectId) throw new PermanentJobError("MISSING_PROJECT_ID", "Draft job is missing project id.");
    const logger = deps.logger ?? noopLogger;
    const now = deps.now ?? Date.now;
    const startedAt = now();
    const queueWaitMs = Math.max(0, startedAt - job.createdAt.getTime());
    const project = await deps.projects.findById(job.projectId);
    if (!project || !project.isActive) throw new PermanentJobError("PROJECT_NOT_ACTIVE", "Project is no longer active.");
    if (project.state !== "draft_generating") throw new PermanentJobError("PROJECT_STATE_INVALID", "Project is not waiting for draft generation.");
    if (!project.transcript?.trim()) throw new PermanentJobError("DRAFT_TRANSCRIPT_MISSING", "Project transcript is required before draft generation.");
    if (!project.selectedPlan) throw new PermanentJobError("DRAFT_PLAN_MISSING", "Selected plan is required before draft generation.");
    if (!project.rewriteMode) throw new PermanentJobError("DRAFT_REWRITE_MODE_MISSING", "Rewrite mode is required before draft generation.");
    if (!project.currentPostIndex) throw new PermanentJobError("DRAFT_POST_INDEX_MISSING", "Current post index is required before draft generation.");
    const post = project.posts.find((candidate) => candidate.index === project.currentPostIndex);
    if (!post) throw new PermanentJobError("DRAFT_POST_MISSING", "Current post is required before draft generation.");
    const rerun = rerunRequest(job.payload);
    if (rerun && (!post.currentDraft || currentDraftVersion(post) !== rerun.sourceDraftVersion)) {
      project.state = "draft_editing";
      await deps.projects.save(project);
      throw new PermanentJobError("DRAFT_RERUN_STALE", "Draft rerun source is stale.");
    }
    const requestedRewriteMode = rerun?.rewriteMode ?? project.rewriteMode;
    const retry = rerun ? { rewriteMode: rerun.rewriteMode, sourceDraftVersion: rerun.sourceDraftVersion } : { rewriteMode: requestedRewriteMode };

    logger.info({ event: "draft_generation_started", jobId: job.id, projectId: job.projectId, postIndex: post.index }, "draft generation started");
    let result: Awaited<ReturnType<ModelAdapters["generateDraft"]>>;
    const providerStartedAt = now();
    let providerDurationMs = 0;
    try {
      result = await deps.drafting.generateDraft({
        projectId: project.id,
        selectedPlan: project.selectedPlan,
        postIndex: post.index,
        rewriteMode: requestedRewriteMode,
        transcript: project.transcript,
        compactContext: rerun ? [] : draftContext(project),
        outputLanguage: project.outputLanguage
      });
      providerDurationMs = Math.max(0, now() - providerStartedAt);
    } catch {
      providerDurationMs = Math.max(0, now() - providerStartedAt);
      const failureCategory = "DRAFT_FAILURE_PROVIDER";
      logger.warn({ event: "draft_generation_terminal_failure", jobId: job.id, projectId: project.id, failureCategory }, "draft generation reached terminal failure");
      const notifierDurationMs = await recoverFromPermanentDraftFailure(deps, project, job.id, failureCategory, retry, now);
      emitTiming(logger, job, queueWaitMs, providerDurationMs, 0, notifierDurationMs, Math.max(0, now() - startedAt), "provider_unexpected_failure");
      throw new PermanentJobError(failureCategory, "Draft provider failed unexpectedly.");
    }
    if (!result.ok) {
      const repairableOutput = result.error.code === "GEMINI_DRAFT_OUTPUT_INVALID" || result.error.code === "GEMINI_DRAFT_OUTPUT_LANGUAGE_INVALID";
      if ((result.error.retryable || repairableOutput) && job.attempts < job.maxAttempts) {
        emitTiming(logger, job, queueWaitMs, providerDurationMs, 0, 0, Math.max(0, now() - startedAt), repairableOutput ? "output_repair_scheduled" : "retry_scheduled");
        throw new RetryableJobError(result.error.code, result.error.message);
      }
      const failureCategory = normalizeDraftTerminalFailure(result.error.code);
      logger.warn({ event: "draft_generation_terminal_failure", jobId: job.id, projectId: project.id, failureCategory }, "draft generation reached terminal failure");
      const notifierDurationMs = await recoverFromPermanentDraftFailure(deps, project, job.id, failureCategory, retry, now);
      emitTiming(logger, job, queueWaitMs, providerDurationMs, 0, notifierDurationMs, Math.max(0, now() - startedAt), "terminal_failure");
      throw new PermanentJobError(failureCategory, "Draft generation reached terminal failure.");
    }

    const draftVersion = nextDraftVersion(post);
    post.currentDraft = result.value.draft.fullText;
    post.draftVersion = draftVersion;
    if (rerun) project.rewriteMode = rerun.rewriteMode;
    project.state = "draft_editing";
    project.messages.push(message("draft", post.currentDraft));
    await deps.projects.save(project);
    logger.info({ event: "draft_generation_saved", jobId: job.id, projectId: job.projectId, postIndex: post.index, draftLength: post.currentDraft.length }, "draft generation saved");

    const notification = await notifyDraft(deps, project, post.currentDraft, post.draftVersion, job.id, now);
    emitTiming(logger, job, queueWaitMs, providerDurationMs, 0, notification.durationMs, Math.max(0, now() - startedAt), notification.status === "failed" ? "notifier_failed" : "success");
    return {
      provider: result.meta.provider,
      modelLabel: result.meta.modelLabel,
      postIndex: post.index,
      draftLength: post.currentDraft.length,
      notificationStatus: notification.status
    };
  };
}

async function recoverFromPermanentDraftFailure(
  deps: GenerateDraftJobHandlerDeps,
  project: Project,
  jobId: string,
  errorCode: string,
  retry: { rewriteMode: "clean_up" | "make_post"; sourceDraftVersion?: number },
  now: () => number
): Promise<number> {
  if (project.state !== "draft_generating") return 0;
  project.state = retry.sourceDraftVersion ? "draft_editing" : "rewrite_mode";
  await deps.projects.save(project);

  if (!deps.notifier) return 0;
  try {
    const notifierStartedAt = now();
    const text = retry.sourceDraftVersion ? "Не удалось сгенерировать новый черновик. Текущий черновик сохранён; повторите тот же режим." : "Не удалось подготовить черновик. План и выбранный режим сохранены; повторите тот же режим.";
    await deps.notifier.sendMessage(project.chatId, text, { reply_markup: draftGenerationRetryMarkup(retry.rewriteMode, retry.sourceDraftVersion) });
    return Math.max(0, now() - notifierStartedAt);
  } catch {
    deps.logger?.warn({ event: "draft_generation_failure_notification_failed", jobId, projectId: project.id, errorCode }, "draft generation recovery notification failed");
    return 0;
  }
}

async function notifyDraft(deps: GenerateDraftJobHandlerDeps, project: Project, draft: string, draftVersion: number, jobId: string, now: () => number): Promise<{ status: "not_configured" | "sent" | "failed"; durationMs: number }> {
  if (!deps.notifier) return { status: "not_configured", durationMs: 0 };
  const notifierStartedAt = now();
  try {
    await deps.notifier.sendMessage(project.chatId, draft, { reply_markup: draftReplyMarkup(deps.formattingEnabled, draftVersion) });
    return { status: "sent", durationMs: Math.max(0, now() - notifierStartedAt) };
  } catch {
    deps.logger?.warn({ event: "draft_generation_notification_failed", jobId, projectId: project.id }, "draft generation notification failed");
    return { status: "failed", durationMs: Math.max(0, now() - notifierStartedAt) };
  }
}

function emitTiming(logger: Logger, job: Job, queueWaitMs: number, providerDurationMs: number, validationApplicationDurationMs: number, notifierDurationMs: number, totalDurationMs: number, terminalCategory: string): void {
  try {
    logger.info({ event: "draft_generation_job_timing", jobId: job.id, type: job.type, queueWaitMs, providerDurationMs, validationApplicationDurationMs, notifierDurationMs, totalDurationMs, terminalCategory }, "draft generation job timing");
  } catch {
    // Timing must not interrupt a terminal draft state or recovery.
  }
}

function normalizeDraftTerminalFailure(sourceCode: string): "DRAFT_FAILURE_PROVIDER" | "DRAFT_FAILURE_TIMEOUT" | "DRAFT_FAILURE_CONTRACT" | "DRAFT_FAILURE_VALIDATION" | "DRAFT_FAILURE_INTERNAL" {
  if (sourceCode.includes("TIMEOUT")) return "DRAFT_FAILURE_TIMEOUT";
  if (sourceCode === "GEMINI_DRAFT_OUTPUT_LANGUAGE_INVALID" || sourceCode.includes("LANGUAGE_INVALID") || sourceCode.includes("VALIDATION")) return "DRAFT_FAILURE_VALIDATION";
  if (sourceCode === "GEMINI_DRAFT_OUTPUT_INVALID" || sourceCode.includes("SCHEMA") || sourceCode.includes("JSON") || sourceCode.includes("CONTRACT")) return "DRAFT_FAILURE_CONTRACT";
  if (sourceCode.startsWith("DRAFT_PROVIDER_") || sourceCode.startsWith("GEMINI_PROVIDER_") || sourceCode.includes("RATE_LIMIT") || sourceCode.includes("HTTP_") || sourceCode.includes("NETWORK")) return "DRAFT_FAILURE_PROVIDER";
  return "DRAFT_FAILURE_INTERNAL";
}

function draftContext(project: Project): string[] {
  return project.messages
    .filter((item) => item.kind === "planning_edit" || item.kind === "draft_edit")
    .slice(-5)
    .map((item) => item.text);
}

function message(kind: ProjectMessageKind, text: string) {
  return { kind, text, createdAt: new Date() };
}

function rerunRequest(payload: Record<string, unknown>): { rewriteMode: "clean_up" | "make_post"; sourceDraftVersion: number } | undefined {
  if (payload.generationMode !== "rerun") return undefined;
  const sourceDraftVersion = payload.sourceDraftVersion;
  const rewriteMode = payload.rewriteMode;
  if (typeof sourceDraftVersion !== "number" || !Number.isSafeInteger(sourceDraftVersion) || sourceDraftVersion <= 0 || (rewriteMode !== "clean_up" && rewriteMode !== "make_post")) {
    throw new PermanentJobError("DRAFT_RERUN_INVALID", "Draft rerun payload is invalid.");
  }
  return { rewriteMode, sourceDraftVersion };
}

function currentDraftVersion(post: { currentDraft?: string; draftVersion?: number }): number {
  return post.draftVersion ?? (post.currentDraft ? 1 : 0);
}

function nextDraftVersion(post: { currentDraft?: string; draftVersion?: number }): number {
  return currentDraftVersion(post) + 1;
}
