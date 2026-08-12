import type { ModelAdapters } from "../domain/modelContracts.js";
import type { Job } from "../domain/jobTypes.js";
import type { Project, ProjectMessageKind } from "../domain/types.js";
import { noopLogger, type Logger } from "../observability/logger.js";
import type { ProjectRepository } from "../repositories/projectRepository.js";
import type { TelegramNotifier } from "../telegram/telegramNotifier.js";
import { draftReplyMarkup } from "./draftPresentation.js";
import { PermanentJobError, RetryableJobError, type JobHandler } from "./jobWorker.js";

export type GenerateDraftJobHandlerDeps = {
  projects: ProjectRepository;
  drafting: Pick<ModelAdapters, "generateDraft">;
  notifier?: TelegramNotifier;
  logger?: Logger;
};

export function createGenerateDraftJobHandler(deps: GenerateDraftJobHandlerDeps): JobHandler {
  return async (job: Job) => {
    if (job.type !== "GENERATE_DRAFT") throw new PermanentJobError("UNEXPECTED_JOB_TYPE", "Handler received an unexpected job type.");
    if (!job.projectId) throw new PermanentJobError("MISSING_PROJECT_ID", "Draft job is missing project id.");
    const logger = deps.logger ?? noopLogger;
    const project = await deps.projects.findById(job.projectId);
    if (!project || !project.isActive) throw new PermanentJobError("PROJECT_NOT_ACTIVE", "Project is no longer active.");
    if (project.state !== "draft_generating") throw new PermanentJobError("PROJECT_STATE_INVALID", "Project is not waiting for draft generation.");
    if (!project.transcript?.trim()) throw new PermanentJobError("DRAFT_TRANSCRIPT_MISSING", "Project transcript is required before draft generation.");
    if (!project.selectedPlan) throw new PermanentJobError("DRAFT_PLAN_MISSING", "Selected plan is required before draft generation.");
    if (!project.rewriteMode) throw new PermanentJobError("DRAFT_REWRITE_MODE_MISSING", "Rewrite mode is required before draft generation.");
    if (!project.currentPostIndex) throw new PermanentJobError("DRAFT_POST_INDEX_MISSING", "Current post index is required before draft generation.");
    const post = project.posts.find((candidate) => candidate.index === project.currentPostIndex);
    if (!post) throw new PermanentJobError("DRAFT_POST_MISSING", "Current post is required before draft generation.");

    logger.info({ event: "draft_generation_started", jobId: job.id, projectId: job.projectId, postIndex: post.index }, "draft generation started");
    const result = await deps.drafting.generateDraft({
      projectId: project.id,
      selectedPlan: project.selectedPlan,
      postIndex: post.index,
      rewriteMode: project.rewriteMode,
      transcript: project.transcript,
      compactContext: draftContext(project),
      outputLanguage: project.outputLanguage
    });
    if (!result.ok) {
      if (result.error.retryable) throw new RetryableJobError(result.error.code, result.error.message);
      await recoverFromPermanentDraftFailure(deps, project, job.id, result.error.code);
      throw new PermanentJobError(result.error.code, result.error.message);
    }

    post.currentDraft = result.value.draft.fullText;
    project.state = "draft_editing";
    project.messages.push(message("draft", post.currentDraft));
    await deps.projects.save(project);
    logger.info({ event: "draft_generation_saved", jobId: job.id, projectId: job.projectId, postIndex: post.index, draftLength: post.currentDraft.length }, "draft generation saved");

    const notificationStatus = await notifyDraft(deps, project, post.currentDraft, job.id);
    return {
      provider: result.meta.provider,
      modelLabel: result.meta.modelLabel,
      postIndex: post.index,
      draftLength: post.currentDraft.length,
      notificationStatus
    };
  };
}

async function recoverFromPermanentDraftFailure(
  deps: GenerateDraftJobHandlerDeps,
  project: Project,
  jobId: string,
  errorCode: string
): Promise<void> {
  project.state = "rewrite_mode";
  await deps.projects.save(project);

  if (!deps.notifier) return;
  try {
    await deps.notifier.sendMessage(project.chatId, errorCode === "GEMINI_DRAFT_OUTPUT_LANGUAGE_INVALID" ? "Не удалось подготовить черновик на нужном языке. Выберите режим переписывания ещё раз." : "Не удалось подготовить черновик. Выберите режим переписывания ещё раз.");
  } catch {
    deps.logger?.warn({ event: "draft_generation_failure_notification_failed", jobId, projectId: project.id, errorCode }, "draft generation recovery notification failed");
  }
}

async function notifyDraft(deps: GenerateDraftJobHandlerDeps, project: Project, draft: string, jobId: string): Promise<"not_configured" | "sent" | "failed"> {
  if (!deps.notifier) return "not_configured";
  try {
    await deps.notifier.sendMessage(project.chatId, draft, { reply_markup: draftReplyMarkup() });
    return "sent";
  } catch {
    deps.logger?.warn({ event: "draft_generation_notification_failed", jobId, projectId: project.id }, "draft generation notification failed");
    return "failed";
  }
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
