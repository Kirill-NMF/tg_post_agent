import type { ModelAdapters } from "../domain/modelContracts.js";
import type { Job } from "../domain/jobTypes.js";
import type { PlanOption, Project, ProjectMessageKind } from "../domain/types.js";
import { noopLogger, type Logger } from "../observability/logger.js";
import type { ProjectRepository } from "../repositories/projectRepository.js";
import type { TelegramNotifier } from "../telegram/telegramNotifier.js";
import { PermanentJobError, RetryableJobError, type JobHandler } from "./jobWorker.js";
import { planReplyMarkup, renderPlanOptionsHistory, renderPlanOptionsMessage } from "./planningPresentation.js";

export type PlanSplitJobHandlerDeps = {
  projects: ProjectRepository;
  planning: Pick<ModelAdapters, "planSplit">;
  notifier?: TelegramNotifier;
  logger?: Logger;
};

export function createPlanSplitJobHandler(deps: PlanSplitJobHandlerDeps): JobHandler {
  return async (job: Job) => {
    if (job.type !== "PLAN_SPLIT") throw new PermanentJobError("UNEXPECTED_JOB_TYPE", "Handler received an unexpected job type.");
    if (!job.projectId) throw new PermanentJobError("MISSING_PROJECT_ID", "Planning job is missing project id.");
    const logger = deps.logger ?? noopLogger;
    const project = await deps.projects.findById(job.projectId);
    if (!project || !project.isActive) throw new PermanentJobError("PROJECT_NOT_ACTIVE", "Project is no longer active.");
    if (!project.transcript?.trim()) throw new PermanentJobError("PLAN_TRANSCRIPT_MISSING", "Project transcript is required before planning.");

    logger.info({ event: "plan_split_started", jobId: job.id, projectId: job.projectId }, "plan split started");
    const result = await deps.planning.planSplit({
      projectId: project.id,
      transcript: project.transcript,
      planningHistory: planningHistory(project)
    });
    if (!result.ok) {
      if (result.error.retryable) throw new RetryableJobError(result.error.code, result.error.message);
      await recoverFromPermanentPlanFailure(deps, project, job.id, result.error.code);
      throw new PermanentJobError(result.error.code, result.error.message);
    }

    project.planOptions = result.value.options;
    project.state = "planning";
    project.messages.push(message("plan_options", renderPlanOptionsHistory(result.value.options)));
    await deps.projects.save(project);
    logger.info({ event: "plan_split_saved", jobId: job.id, projectId: job.projectId, optionCount: result.value.options.length }, "plan split saved");

    const notificationStatus = await notifyPlanOptions(deps, project, result.value.options, job.id);
    return {
      provider: result.meta.provider,
      modelLabel: result.meta.modelLabel,
      optionCount: result.value.options.length,
      notificationStatus
    };
  };
}

async function recoverFromPermanentPlanFailure(
  deps: PlanSplitJobHandlerDeps,
  project: Project,
  jobId: string,
  errorCode: string
): Promise<void> {
  project.planOptions = undefined;
  project.selectedPlan = undefined;
  project.posts = [];
  project.currentPostIndex = undefined;
  project.state = "awaiting_audio";
  await deps.projects.save(project);

  if (!deps.notifier) return;
  try {
    await deps.notifier.sendMessage(project.chatId, "Не удалось подготовить варианты плана. Пришлите аудио ещё раз или начните новый проект командой /start.");
  } catch {
    deps.logger?.warn({ event: "plan_split_failure_notification_failed", jobId, projectId: project.id, errorCode }, "plan split recovery notification failed");
  }
}

async function notifyPlanOptions(
  deps: PlanSplitJobHandlerDeps,
  project: Project,
  options: PlanOption[],
  jobId: string
): Promise<"not_configured" | "sent" | "failed"> {
  if (!deps.notifier) return "not_configured";
  try {
    await deps.notifier.sendMessage(project.chatId, renderPlanOptionsMessage(options), { reply_markup: planReplyMarkup() });
    return "sent";
  } catch {
    deps.logger?.warn({ event: "plan_split_notification_failed", jobId, projectId: project.id }, "plan split notification failed");
    return "failed";
  }
}

function planningHistory(project: Project): string[] {
  return project.messages.filter((item) => item.kind === "planning_edit" || item.kind === "plan_options").slice(-5).map((item) => item.text);
}

function message(kind: ProjectMessageKind, text: string) {
  return { kind, text, createdAt: new Date() };
}
