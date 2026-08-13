import type { Job } from "../domain/jobTypes.js";
import type { ModelAdapters } from "../domain/modelContracts.js";
import type { Project } from "../domain/types.js";
import { noopLogger, type Logger } from "../observability/logger.js";
import type { ProjectRepository } from "../repositories/projectRepository.js";
import type { TelegramNotifier } from "../telegram/telegramNotifier.js";
import { PermanentJobError, RetryableJobError, type JobHandler } from "./jobWorker.js";
import { currentPlan, storePlan } from "./planSplitJobHandler.js";
import { planReplyMarkup, renderPlanRecommendationMessage } from "./planningPresentation.js";

const maxEditChars = 2000;

export type RevisePlanJobHandlerDeps = {
  projects: ProjectRepository;
  planning: Pick<ModelAdapters, "revisePlan">;
  notifier?: TelegramNotifier;
  logger?: Logger;
};

export function createRevisePlanJobHandler(deps: RevisePlanJobHandlerDeps): JobHandler {
  return async (job) => {
    if (job.type !== "REVISE_PLAN" || !job.projectId) {
      throw new PermanentJobError("INVALID_REVISE_PLAN_JOB", "Plan revision job is invalid.");
    }

    const latestUserEdit = parseEdit(job.payload);
    const project = await deps.projects.findById(job.projectId);
    const plan = project && currentPlan(project);

    if (!project?.isActive) {
      throw new PermanentJobError("PROJECT_NOT_ACTIVE", "Project is no longer active.");
    }
    if (project.state !== "planning" || !project.transcript?.trim() || !plan) {
      throw new PermanentJobError("PLAN_REVISION_STALE", "Planning state changed before the voice edit could be applied.");
    }

    const result = await deps.planning.revisePlan({
      projectId: project.id,
      transcript: project.transcript,
      currentPlan: plan,
      latestUserEdit,
      outputLanguage: project.outputLanguage
    });

    if (!result.ok) {
      if (result.error.retryable) {
        throw new RetryableJobError(result.error.code, result.error.message);
      }
      await notifyRecovery(deps, project, job.id, result.error.code);
      throw new PermanentJobError(result.error.code, result.error.message);
    }

    storePlan(project, result.value);
    await deps.projects.save(project);
    const notificationStatus = await notify(deps, project, job.id);

    return {
      provider: result.meta.provider,
      modelLabel: result.meta.modelLabel,
      recommendedPostCount: result.value.options.find((item) => item.optionId === result.value.recommendation.recommendedOptionId)?.postCount ?? 0,
      alternativeCount: result.value.options.length - 1,
      notificationStatus
    };
  };
}

function parseEdit(payload: Record<string, unknown>): string {
  if (typeof payload.latestUserEdit !== "string") {
    throw new PermanentJobError("PLAN_EDIT_MISSING", "Plan revision payload is missing edit text.");
  }

  const value = payload.latestUserEdit.trim();
  if (!value) {
    throw new PermanentJobError("PLAN_EDIT_MISSING", "Plan revision payload is missing edit text.");
  }
  if (value.length > maxEditChars) {
    throw new PermanentJobError("PLAN_EDIT_TOO_LONG", "Plan revision edit exceeds the configured length limit.");
  }
  return value;
}

async function notify(deps: RevisePlanJobHandlerDeps, project: Project, jobId: string): Promise<"not_configured" | "sent" | "failed"> {
  const plan = currentPlan(project);
  if (!deps.notifier || !plan) return "not_configured";

  try {
    await deps.notifier.sendMessage(project.chatId, renderPlanRecommendationMessage(plan), { reply_markup: planReplyMarkup(plan) });
    return "sent";
  } catch {
    (deps.logger ?? noopLogger).warn(
      { event: "plan_revision_notification_failed", jobId, projectId: project.id },
      "plan revision notification failed"
    );
    return "failed";
  }
}

async function notifyRecovery(deps: RevisePlanJobHandlerDeps, project: Project, jobId: string, errorCode: string): Promise<void> {
  if (!deps.notifier) return;

  try {
    await deps.notifier.sendMessage(
      project.chatId,
      "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0431\u043d\u043e\u0432\u0438\u0442\u044c \u043f\u043b\u0430\u043d. \u0418\u0441\u0445\u043e\u0434\u043d\u044b\u0439 \u043f\u043b\u0430\u043d \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d: \u043e\u0442\u043f\u0440\u0430\u0432\u044c\u0442\u0435 \u043f\u0440\u0430\u0432\u043a\u0443 \u0442\u0435\u043a\u0441\u0442\u043e\u043c \u0438\u043b\u0438 \u043f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0435\u0449\u0451 \u0440\u0430\u0437."
    );
  } catch {
    (deps.logger ?? noopLogger).warn(
      { event: "plan_revision_failure_notification_failed", jobId, projectId: project.id, errorCode },
      "plan revision recovery notification failed"
    );
  }
}
