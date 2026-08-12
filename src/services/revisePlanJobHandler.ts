import type { ModelAdapters } from "../domain/modelContracts.js";
import type { Job } from "../domain/jobTypes.js";
import type { Project, ProjectMessageKind } from "../domain/types.js";
import { noopLogger, type Logger } from "../observability/logger.js";
import type { ProjectRepository } from "../repositories/projectRepository.js";
import type { TelegramNotifier } from "../telegram/telegramNotifier.js";
import { PermanentJobError, RetryableJobError, type JobHandler } from "./jobWorker.js";
import { currentPlan, storePlan } from "./planSplitJobHandler.js";
import { planReplyMarkup, renderPlanRecommendationMessage } from "./planningPresentation.js";
const maxEditChars = 2000;
export function createRevisePlanJobHandler(deps: { projects: ProjectRepository; planning: Pick<ModelAdapters, "revisePlan">; notifier?: TelegramNotifier; logger?: Logger }): JobHandler {
  return async (job) => {
    if (job.type !== "REVISE_PLAN" || !job.projectId) throw new PermanentJobError("INVALID_REVISE_PLAN_JOB", "Plan revision job is invalid.");
    const latestUserEdit = parseEdit(job.payload); const project = await deps.projects.findById(job.projectId); const plan = project && currentPlan(project);
    if (!project?.isActive) throw new PermanentJobError("PROJECT_NOT_ACTIVE", "Project is no longer active.");
    if (project.state !== "planning" || !project.transcript?.trim() || !plan) throw new PermanentJobError("PLAN_REVISION_STALE", "Planning state changed before the voice edit could be applied.");
    const result = await deps.planning.revisePlan({ projectId: project.id, transcript: project.transcript, currentPlan: plan, latestUserEdit, outputLanguage: project.outputLanguage });
    if (!result.ok) throw result.error.retryable ? new RetryableJobError(result.error.code, result.error.message) : new PermanentJobError(result.error.code, result.error.message);
    storePlan(project, result.value); await deps.projects.save(project);
    const notificationStatus = await notify(deps, project, job.id);
    return { provider: result.meta.provider, modelLabel: result.meta.modelLabel, recommendedPostCount: result.value.options.find((item) => item.optionId === result.value.recommendation.recommendedOptionId)?.postCount ?? 0, alternativeCount: result.value.options.length - 1, notificationStatus };
  };
}
function parseEdit(payload: Record<string, unknown>): string { if (typeof payload.latestUserEdit !== "string") throw new PermanentJobError("PLAN_EDIT_MISSING", "Plan revision payload is missing edit text."); const value=payload.latestUserEdit.trim(); if(!value)throw new PermanentJobError("PLAN_EDIT_MISSING","Plan revision payload is missing edit text."); if(value.length>maxEditChars)throw new PermanentJobError("PLAN_EDIT_TOO_LONG","Plan revision edit exceeds the configured length limit."); return value; }
async function notify(deps:{notifier?:TelegramNotifier;logger?:Logger},project:Project,jobId:string):Promise<"not_configured"|"sent"|"failed">{const plan=currentPlan(project);if(!deps.notifier||!plan)return "not_configured";try{await deps.notifier.sendMessage(project.chatId,renderPlanRecommendationMessage(plan),{reply_markup:planReplyMarkup(plan)});return"sent"}catch{(deps.logger??noopLogger).warn({event:"plan_revision_notification_failed",jobId,projectId:project.id},"plan revision notification failed");return"failed"}}
function message(kind:ProjectMessageKind,text:string){return{kind,text,createdAt:new Date()};}
