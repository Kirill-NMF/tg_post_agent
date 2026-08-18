import type { Job } from "../domain/jobTypes.js";
import { applyFormattingPlan, applySegmentFormattingPlan, deriveCanonicalSegments, type CanonicalFormattingSegment, type SegmentFormattingOperation } from "../domain/formatting.js";
import type { ModelAdapters } from "../domain/modelContracts.js";
import type { AdapterMeta, AdapterResult, FormattingOption, Project, ProjectMessageKind } from "../domain/types.js";
import { noopLogger, type Logger } from "../observability/logger.js";
import type { ProjectRepository } from "../repositories/projectRepository.js";
import type { TelegramNotifier } from "../telegram/telegramNotifier.js";
import { PermanentJobError, RetryableJobError, type JobHandler } from "./jobWorker.js";
import { formattedReplyMarkup } from "./formatPresentation.js";

type Option2SegmentAdapter = {
  formatOption2Segments(input: { projectId: string; draftText: string; segments: readonly CanonicalFormattingSegment[] }): Promise<AdapterResult<{ directives: SegmentFormattingOperation[] }>>
};

export type FormatPostJobHandlerDeps = {
  projects: ProjectRepository;
  formatting: Pick<ModelAdapters, "formatPost"> & Partial<Option2SegmentAdapter>;
  notifier?: TelegramNotifier;
  logger?: Logger;
  now?: () => number;
};

export function createFormatPostJobHandler(deps: FormatPostJobHandlerDeps): JobHandler {
  return async (job: Job) => {
    if (job.type !== "FORMAT_POST" || !job.projectId) {
      throw new PermanentJobError("INVALID_FORMAT_POST_JOB", "Formatting job is invalid.");
    }

    const request = parseRequest(job.payload);
    const logger = deps.logger ?? noopLogger;
    const now = deps.now ?? Date.now;
    const startedAt = now();
    const queueWaitMs = Math.max(0, startedAt - job.createdAt.getTime());
    const project = await deps.projects.findById(job.projectId);
    if (!project?.isActive) throw new PermanentJobError("PROJECT_NOT_ACTIVE", "Project is no longer active.");
    if (project.state !== "formatting") throw new PermanentJobError("FORMAT_POST_STALE", "Project is no longer waiting for formatting.");
    if (project.currentPostIndex !== request.postIndex) throw new PermanentJobError("FORMAT_POST_STALE", "Formatting job post no longer matches the project.");
    const post = project.posts.find((candidate) => candidate.index === request.postIndex);
    if (!post?.currentDraft?.trim()) throw new PermanentJobError("FORMAT_DRAFT_MISSING", "Canonical draft is required for formatting.");

    logger.info(
      { event: "formatting_started", jobId: job.id, projectId: project.id, postIndex: post.index, formattingOption: request.formattingOption },
      "formatting started"
    );

    let providerFailure: { code: string; message: string; retryable: boolean } | undefined;
    let providerMeta: AdapterMeta | undefined;
    let operationCount = 0;
    let rendered: ReturnType<typeof applyFormattingPlan> | undefined;
    let formattedText: string | undefined;
    let providerDurationMs = 0;
    let validationApplicationDurationMs = 0;

    if (request.formattingOption === "option_2") {
      if (!deps.formatting.formatOption2Segments) {
        providerFailure = { code: "FORMAT_OPTION2_SEGMENT_ADAPTER_UNAVAILABLE", message: "Option 2 source-backed formatting is unavailable.", retryable: false };
      } else {
        const providerStartedAt = now();
        try {
          const segments = deriveCanonicalSegments(post.currentDraft);
          const result = await deps.formatting.formatOption2Segments.call(deps.formatting, { projectId: project.id, draftText: post.currentDraft, segments });
          providerDurationMs = Math.max(0, now() - providerStartedAt);
          if (!result.ok) {
            providerFailure = result.error;
          } else {
            providerMeta = result.meta;
            operationCount = result.value.directives.length;
            const validationStartedAt = now();
            rendered = applySegmentFormattingPlan(post.currentDraft, "option_2", result.value.directives, segments);
            validationApplicationDurationMs = Math.max(0, now() - validationStartedAt);
          }
        } catch {
          providerDurationMs = Math.max(0, now() - providerStartedAt);
          const notifierDurationMs = await recoverFromFailure(deps, project, job.id, "FORMAT_PROVIDER_UNEXPECTED_FAILURE", now);
          emitTiming(logger, job, queueWaitMs, providerDurationMs, 0, notifierDurationMs, Math.max(0, now() - startedAt), "provider_unexpected_failure");
          throw new PermanentJobError("FORMAT_PROVIDER_UNEXPECTED_FAILURE", "Formatting provider failed unexpectedly.");
        }
      }
    } else {
      const providerStartedAt = now();
      try {
        const result = await deps.formatting.formatPost({
          projectId: project.id,
          draftText: post.currentDraft,
          formattingOption: request.formattingOption
        });
        providerDurationMs = Math.max(0, now() - providerStartedAt);
        if (!result.ok) {
          providerFailure = result.error;
        } else {
          providerMeta = result.meta;
          operationCount = result.value.decorationPlan.operations.length;
          const validationStartedAt = now();
          rendered = applyFormattingPlan(post.currentDraft, result.value.decorationPlan);
          validationApplicationDurationMs = Math.max(0, now() - validationStartedAt);
        }
      } catch {
        providerDurationMs = Math.max(0, now() - providerStartedAt);
        const notifierDurationMs = await recoverFromFailure(deps, project, job.id, "FORMAT_PROVIDER_UNEXPECTED_FAILURE", now);
        emitTiming(logger, job, queueWaitMs, providerDurationMs, 0, notifierDurationMs, Math.max(0, now() - startedAt), "provider_unexpected_failure");
        throw new PermanentJobError("FORMAT_PROVIDER_UNEXPECTED_FAILURE", "Formatting provider failed unexpectedly.");
      }
    }

    if (providerFailure) {
      if (providerFailure.retryable && job.attempts < job.maxAttempts) {
        emitTiming(logger, job, queueWaitMs, providerDurationMs, 0, 0, Math.max(0, now() - startedAt), "retry_scheduled");
        throw new RetryableJobError(providerFailure.code, providerFailure.message);
      }
      const notifierDurationMs = await recoverFromFailure(deps, project, job.id, providerFailure.code, now);
      emitTiming(logger, job, queueWaitMs, providerDurationMs, 0, notifierDurationMs, Math.max(0, now() - startedAt), "provider_or_plan_failure");
      throw new PermanentJobError(providerFailure.code, providerFailure.message);
    }
    if (rendered && !rendered.ok) {
      const notifierDurationMs = await recoverFromFailure(deps, project, job.id, rendered.code, now);
      emitTiming(logger, job, queueWaitMs, providerDurationMs, validationApplicationDurationMs, notifierDurationMs, Math.max(0, now() - startedAt), "validation_application_failure");
      throw new PermanentJobError(rendered.code, rendered.message);
    }
    if (rendered?.ok) formattedText = rendered.text;
    if (!formattedText || !providerMeta) {
      const notifierDurationMs = await recoverFromFailure(deps, project, job.id, "FORMAT_APPLICATION_UNAVAILABLE", now);
      emitTiming(logger, job, queueWaitMs, providerDurationMs, validationApplicationDurationMs, notifierDurationMs, Math.max(0, now() - startedAt), "validation_application_failure");
      throw new PermanentJobError("FORMAT_APPLICATION_UNAVAILABLE", "Formatting application was unavailable.");
    }

    post.formattedText = formattedText;
    post.formattingOption = request.formattingOption;
    project.state = "formatted_editing";
    project.messages.push(message("formatted_text", post.formattedText));
    await deps.projects.save(project);

    logger.info(
      { event: "formatting_saved", jobId: job.id, projectId: project.id, postIndex: post.index, formattingOption: request.formattingOption, operationCount },
      "formatting saved"
    );

    const notification = await notifyFormatted(deps, project, post.formattedText, request.formattingOption, job.id, now);
    if (notification.status === "failed") {
      post.formattedText = undefined;
      post.formattingOption = undefined;
      project.state = "draft_editing";
      await deps.projects.save(project);
    }
    emitTiming(logger, job, queueWaitMs, providerDurationMs, validationApplicationDurationMs, notification.durationMs, Math.max(0, now() - startedAt), notification.status === "failed" ? "notifier_failed_recovered" : "success");
    return {
      provider: providerMeta.provider,
      modelLabel: providerMeta.modelLabel,
      postIndex: post.index,
      formattingOption: request.formattingOption,
      notificationStatus: notification.status
    };
  };
}

function parseRequest(payload: Record<string, unknown>): { postIndex: 1 | 2 | 3; formattingOption: FormattingOption } {
  const postIndex = payload.postIndex;
  const formattingOption = payload.formattingOption;
  if ((postIndex !== 1 && postIndex !== 2 && postIndex !== 3) || (formattingOption !== "option_1" && formattingOption !== "option_2")) {
    throw new PermanentJobError("FORMAT_REQUEST_INVALID", "Formatting job payload is invalid.");
  }
  return { postIndex, formattingOption };
}

async function recoverFromFailure(deps: FormatPostJobHandlerDeps, project: Project, jobId: string, errorCode: string, now: () => number): Promise<number> {
  if (project.state !== "formatting") return 0;
  project.state = "draft_editing";
  const post = project.posts.find((item) => item.index === project.currentPostIndex);
  if (post) {
    post.formattedText = undefined;
    post.formattingOption = undefined;
  }
  await deps.projects.save(project);

  if (!deps.notifier) return 0;
  try {
    const notifierStartedAt = now();
    await deps.notifier.sendMessage(
      project.chatId,
      "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0431\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u043e \u043e\u0444\u043e\u0440\u043c\u0438\u0442\u044c \u0447\u0435\u0440\u043d\u043e\u0432\u0438\u043a. \u0427\u0435\u0440\u043d\u043e\u0432\u0438\u043a \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d; \u043c\u043e\u0436\u043d\u043e \u043f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c \u0440\u0430\u0431\u043e\u0442\u0443 \u0441 \u0442\u0435\u043a\u0443\u0449\u0438\u043c \u0442\u0435\u043a\u0441\u0442\u043e\u043c."
    );
    return Math.max(0, now() - notifierStartedAt);
  } catch {
    (deps.logger ?? noopLogger).warn(
      { event: "formatting_failure_notification_failed", jobId, projectId: project.id, errorCode },
      "formatting recovery notification failed"
    );
    return 0;
  }
}

async function notifyFormatted(deps: FormatPostJobHandlerDeps, project: Project, text: string, formattingOption: FormattingOption, jobId: string, now: () => number): Promise<{ status: "not_configured" | "sent" | "failed"; durationMs: number }> {
  if (!deps.notifier) return { status: "not_configured", durationMs: 0 };
  const notifierStartedAt = now();
  try {
    const options = { reply_markup: formattedReplyMarkup(project) };
    if (formattingOption === "option_2" && deps.notifier.sendCryptusOption2) {
      await deps.notifier.sendCryptusOption2(project.chatId, text, options);
    } else {
      await deps.notifier.sendMessage(project.chatId, text, options);
    }
    return { status: "sent", durationMs: Math.max(0, now() - notifierStartedAt) };
  } catch {
    (deps.logger ?? noopLogger).warn(
      { event: "formatting_notification_failed", jobId, projectId: project.id },
      "formatting notification failed"
    );
    return { status: "failed", durationMs: Math.max(0, now() - notifierStartedAt) };
  }
}

function emitTiming(logger: Logger, job: Job, queueWaitMs: number, providerDurationMs: number, validationApplicationDurationMs: number, notifierDurationMs: number, totalDurationMs: number, terminalCategory: string): void {
  try {
    logger.info({ event: "formatting_job_timing", jobId: job.id, type: job.type, queueWaitMs, providerDurationMs, validationApplicationDurationMs, notifierDurationMs, totalDurationMs, terminalCategory }, "formatting job timing");
  } catch {
    // Observability must not change the completed recovery or delivery path.
  }
}

function message(kind: ProjectMessageKind, text: string) {
  return { kind, text, createdAt: new Date() };
}
