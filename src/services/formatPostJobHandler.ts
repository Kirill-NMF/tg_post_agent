import type { Job } from "../domain/jobTypes.js";
import { applyFormattingPlan } from "../domain/formatting.js";
import type { ModelAdapters } from "../domain/modelContracts.js";
import type { FormattingOption, Project, ProjectMessageKind } from "../domain/types.js";
import { noopLogger, type Logger } from "../observability/logger.js";
import type { ProjectRepository } from "../repositories/projectRepository.js";
import type { TelegramNotifier } from "../telegram/telegramNotifier.js";
import { PermanentJobError, RetryableJobError, type JobHandler } from "./jobWorker.js";
import { formattedReplyMarkup } from "./formatPresentation.js";

export type FormatPostJobHandlerDeps = {
  projects: ProjectRepository;
  formatting: Pick<ModelAdapters, "formatPost">;
  notifier?: TelegramNotifier;
  logger?: Logger;
};

export function createFormatPostJobHandler(deps: FormatPostJobHandlerDeps): JobHandler {
  return async (job: Job) => {
    if (job.type !== "FORMAT_POST" || !job.projectId) {
      throw new PermanentJobError("INVALID_FORMAT_POST_JOB", "Formatting job is invalid.");
    }

    const request = parseRequest(job.payload);
    const logger = deps.logger ?? noopLogger;
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

    let result: Awaited<ReturnType<ModelAdapters["formatPost"]>>;
    try {
      result = await deps.formatting.formatPost({
        projectId: project.id,
        draftText: post.currentDraft,
        formattingOption: request.formattingOption
      });
    } catch {
      await recoverFromFailure(deps, project, job.id, "FORMAT_PROVIDER_UNEXPECTED_FAILURE");
      throw new PermanentJobError("FORMAT_PROVIDER_UNEXPECTED_FAILURE", "Formatting provider failed unexpectedly.");
    }

    if (!result.ok) {
      if (result.error.retryable && job.attempts < job.maxAttempts) {
        throw new RetryableJobError(result.error.code, result.error.message);
      }
      await recoverFromFailure(deps, project, job.id, result.error.code);
      throw new PermanentJobError(result.error.code, result.error.message);
    }

    const rendered = applyFormattingPlan(post.currentDraft, result.value.decorationPlan);
    if (!rendered.ok) {
      await recoverFromFailure(deps, project, job.id, rendered.code);
      throw new PermanentJobError(rendered.code, rendered.message);
    }

    post.formattedText = rendered.text;
    post.formattingOption = request.formattingOption;
    project.state = "formatted_editing";
    project.messages.push(message("formatted_text", post.formattedText));
    await deps.projects.save(project);

    logger.info(
      { event: "formatting_saved", jobId: job.id, projectId: project.id, postIndex: post.index, formattingOption: request.formattingOption, operationCount: result.value.decorationPlan.operations.length },
      "formatting saved"
    );

    const notificationStatus = await notifyFormatted(deps, project, post.formattedText, job.id);
    if (notificationStatus === "failed") {
      post.formattedText = undefined;
      post.formattingOption = undefined;
      project.state = "draft_editing";
      await deps.projects.save(project);
    }
    return {
      provider: result.meta.provider,
      modelLabel: result.meta.modelLabel,
      postIndex: post.index,
      formattingOption: request.formattingOption,
      notificationStatus
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

async function recoverFromFailure(deps: FormatPostJobHandlerDeps, project: Project, jobId: string, errorCode: string): Promise<void> {
  if (project.state !== "formatting") return;
  project.state = "draft_editing";
  const post = project.posts.find((item) => item.index === project.currentPostIndex);
  if (post) {
    post.formattedText = undefined;
    post.formattingOption = undefined;
  }
  await deps.projects.save(project);

  if (!deps.notifier) return;
  try {
    await deps.notifier.sendMessage(
      project.chatId,
      "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0431\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u043e \u043e\u0444\u043e\u0440\u043c\u0438\u0442\u044c \u0447\u0435\u0440\u043d\u043e\u0432\u0438\u043a. \u0427\u0435\u0440\u043d\u043e\u0432\u0438\u043a \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d; \u043c\u043e\u0436\u043d\u043e \u043f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c \u0440\u0430\u0431\u043e\u0442\u0443 \u0441 \u0442\u0435\u043a\u0443\u0449\u0438\u043c \u0442\u0435\u043a\u0441\u0442\u043e\u043c."
    );
  } catch {
    (deps.logger ?? noopLogger).warn(
      { event: "formatting_failure_notification_failed", jobId, projectId: project.id, errorCode },
      "formatting recovery notification failed"
    );
  }
}

async function notifyFormatted(deps: FormatPostJobHandlerDeps, project: Project, text: string, jobId: string): Promise<"not_configured" | "sent" | "failed"> {
  if (!deps.notifier) return "not_configured";
  try {
    await deps.notifier.sendMessage(project.chatId, text, { reply_markup: formattedReplyMarkup(project) });
    return "sent";
  } catch {
    (deps.logger ?? noopLogger).warn(
      { event: "formatting_notification_failed", jobId, projectId: project.id },
      "formatting notification failed"
    );
    return "failed";
  }
}

function message(kind: ProjectMessageKind, text: string) {
  return { kind, text, createdAt: new Date() };
}
