import type { ModelAdapters } from "../domain/modelContracts.js";
import type { Job } from "../domain/jobTypes.js";
import type { Project, ProjectMessageKind } from "../domain/types.js";
import { noopLogger, type Logger } from "../observability/logger.js";
import type { ProjectRepository } from "../repositories/projectRepository.js";
import type { TelegramNotifier } from "../telegram/telegramNotifier.js";
import { draftReplyMarkup } from "./draftPresentation.js";
import { PermanentJobError, RetryableJobError, type JobHandler } from "./jobWorker.js";

const maxDraftEditChars = 2000;

export type ReviseDraftJobHandlerDeps = {
  projects: ProjectRepository;
  drafting: Pick<ModelAdapters, "reviseDraft">;
  notifier?: TelegramNotifier;
  logger?: Logger;
};

export function createReviseDraftJobHandler(deps: ReviseDraftJobHandlerDeps): JobHandler {
  return async (job: Job) => {
    if (job.type !== "REVISE_DRAFT") throw new PermanentJobError("UNEXPECTED_JOB_TYPE", "Handler received an unexpected job type.");
    if (!job.projectId) throw new PermanentJobError("MISSING_PROJECT_ID", "Draft revision job is missing project id.");
    const latestUserEdit = parseLatestUserEdit(job.payload);
    const logger = deps.logger ?? noopLogger;
    const project = await deps.projects.findById(job.projectId);
    if (!project || !project.isActive) throw new PermanentJobError("PROJECT_NOT_ACTIVE", "Project is no longer active.");
    if (project.state !== "draft_generating") throw new PermanentJobError("PROJECT_STATE_INVALID", "Project is not waiting for draft revision.");
    if (!project.transcript?.trim()) throw new PermanentJobError("DRAFT_TRANSCRIPT_MISSING", "Project transcript is required before draft revision.");
    if (!project.selectedPlan) throw new PermanentJobError("DRAFT_PLAN_MISSING", "Selected plan is required before draft revision.");
    if (!project.rewriteMode) throw new PermanentJobError("DRAFT_REWRITE_MODE_MISSING", "Rewrite mode is required before draft revision.");
    if (!project.currentPostIndex) throw new PermanentJobError("DRAFT_POST_INDEX_MISSING", "Current post index is required before draft revision.");
    const post = project.posts.find((candidate) => candidate.index === project.currentPostIndex);
    if (!post) throw new PermanentJobError("DRAFT_POST_MISSING", "Current post is required before draft revision.");
    if (!post.currentDraft?.trim()) throw new PermanentJobError("DRAFT_CURRENT_DRAFT_MISSING", "Current draft is required before draft revision.");

    logger.info({ event: "draft_revision_started", jobId: job.id, projectId: job.projectId, postIndex: post.index }, "draft revision started");
    const result = await deps.drafting.reviseDraft({
      projectId: project.id,
      currentDraft: post.currentDraft,
      latestUserEdit,
      compactContext: draftContext(project)
    });
    if (!result.ok) {
      if (result.error.retryable) throw new RetryableJobError(result.error.code, result.error.message);
      throw new PermanentJobError(result.error.code, result.error.message);
    }

    post.currentDraft = result.value.updatedDraft.fullText;
    project.state = "draft_editing";
    project.messages.push(message("draft", post.currentDraft));
    await deps.projects.save(project);
    logger.info({ event: "draft_revision_saved", jobId: job.id, projectId: job.projectId, postIndex: post.index, draftLength: post.currentDraft.length }, "draft revision saved");

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

function parseLatestUserEdit(payload: Record<string, unknown>): string {
  if (typeof payload.latestUserEdit !== "string") throw new PermanentJobError("DRAFT_EDIT_MISSING", "Draft revision payload is missing latest user edit.");
  const latestUserEdit = payload.latestUserEdit
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!latestUserEdit) throw new PermanentJobError("DRAFT_EDIT_MISSING", "Draft revision payload is missing latest user edit.");
  if (latestUserEdit.length > maxDraftEditChars) throw new PermanentJobError("DRAFT_EDIT_TOO_LONG", "Draft revision edit exceeds the configured length limit.");
  return latestUserEdit;
}

async function notifyDraft(deps: ReviseDraftJobHandlerDeps, project: Project, draft: string, jobId: string): Promise<"not_configured" | "sent" | "failed"> {
  if (!deps.notifier) return "not_configured";
  try {
    await deps.notifier.sendMessage(project.chatId, draft, { reply_markup: draftReplyMarkup() });
    return "sent";
  } catch {
    deps.logger?.warn({ event: "draft_revision_notification_failed", jobId, projectId: project.id }, "draft revision notification failed");
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
