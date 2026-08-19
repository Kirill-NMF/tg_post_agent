import type { ModelAdapters } from "../domain/modelContracts.js";
import type { Job } from "../domain/jobTypes.js";
import type { PlanningResult, Project, ProjectMessageKind } from "../domain/types.js";
import { noopLogger, type Logger } from "../observability/logger.js";
import type { ProjectRepository } from "../repositories/projectRepository.js";
import type { TelegramNotifier } from "../telegram/telegramNotifier.js";
import { PermanentJobError, RetryableJobError, type JobHandler } from "./jobWorker.js";
import { planReplyMarkup, renderPlanOptionsHistory, renderPlanRecommendationMessage } from "./planningPresentation.js";

export type PlanSplitJobHandlerDeps = { projects: ProjectRepository; planning: Pick<ModelAdapters, "planSplit">; notifier?: TelegramNotifier; logger?: Logger };

export function createPlanSplitJobHandler(deps: PlanSplitJobHandlerDeps): JobHandler {
  return async (job) => {
    if (job.type !== "PLAN_SPLIT") throw new PermanentJobError("UNEXPECTED_JOB_TYPE", "Handler received an unexpected job type.");
    if (!job.projectId) throw new PermanentJobError("MISSING_PROJECT_ID", "Planning job is missing project id.");
    const logger = deps.logger ?? noopLogger;
    const project = await deps.projects.findById(job.projectId);
    if (!project || !project.isActive) throw new PermanentJobError("PROJECT_NOT_ACTIVE", "Project is no longer active.");
    if (!project.transcript?.trim()) throw new PermanentJobError("PLAN_TRANSCRIPT_MISSING", "Project transcript is required before planning.");
    logger.info({ event: "plan_split_started", jobId: job.id, projectId: job.projectId }, "plan split started");
    const result = await deps.planning.planSplit({ projectId: project.id, transcript: project.transcript, planningHistory: planningHistory(project), outputLanguage: project.outputLanguage });
    if (!result.ok) {
      if (result.error.retryable) throw new RetryableJobError(result.error.code, result.error.message);
      await recoverFromPermanentPlanFailure(deps, project, job.id, result.error.code);
      throw new PermanentJobError(result.error.code, result.error.message);
    }
    storePlan(project, result.value);
    await deps.projects.save(project);
    logger.info({ event: "plan_split_saved", jobId: job.id, projectId: job.projectId, recommendedPostCount: recommendedCount(result.value), alternativeCount: result.value.options.length - 1 }, "plan split saved");
    const notificationStatus = await notifyPlan(deps, project, result.value, job.id);
    return { provider: result.meta.provider, modelLabel: result.meta.modelLabel, recommendedPostCount: recommendedCount(result.value), alternativeCount: result.value.options.length - 1, notificationStatus };
  };
}
export function storePlan(project: Project, plan: PlanningResult): void {
  project.planOptions = plan.options;
  project.planRecommendation = plan.recommendation;
  project.planAlternativesRevealed = false;
  project.state = "planning";
  project.messages.push(message("plan_options", renderPlanOptionsHistory(plan)));
}
export function currentPlan(project: Project): PlanningResult | undefined {
  if (project.planRecommendation && project.planOptions?.some((option) => option.optionId === project.planRecommendation?.recommendedOptionId)) return { options: project.planOptions, recommendation: project.planRecommendation };
  const options = project.planOptions;
  const legacy = options?.[0];
  return legacy ? { options, recommendation: { recommendedOptionId: legacy.optionId, rationale: "Сохранённый вариант плана.", confidence: "low" } } : undefined;
}
async function recoverFromPermanentPlanFailure(deps: PlanSplitJobHandlerDeps, project: Project, jobId: string, errorCode: string): Promise<void> {
  project.planOptions = undefined; project.planRecommendation = undefined; project.planAlternativesRevealed = undefined; project.selectedPlan = undefined; project.posts = []; project.currentPostIndex = undefined; project.state = "awaiting_audio";
  await deps.projects.save(project);
  if (!deps.notifier) return;
  try { await deps.notifier.sendMessage(project.chatId, errorCode === "GEMINI_PLAN_OUTPUT_LANGUAGE_INVALID" ? "Не удалось подготовить план на нужном языке. Пришлите аудио ещё раз или начните новый проект командой /start." : "Не удалось подготовить варианты плана. Пришлите аудио ещё раз или начните новый проект командой /start."); }
  catch { deps.logger?.warn({ event: "plan_split_failure_notification_failed", jobId, projectId: project.id, errorCode }, "plan split recovery notification failed"); }
}
async function notifyPlan(deps: PlanSplitJobHandlerDeps, project: Project, plan: PlanningResult, jobId: string): Promise<"not_configured" | "sent" | "failed"> {
  if (!deps.notifier) return "not_configured";
  try { await deps.notifier.sendMessage(project.chatId, renderPlanRecommendationMessage(plan), { reply_markup: planReplyMarkup(plan, project.id) }); return "sent"; }
  catch { deps.logger?.warn({ event: "plan_split_notification_failed", jobId, projectId: project.id }, "plan split notification failed"); return "failed"; }
}
function planningHistory(project: Project): string[] { return project.messages.filter((item) => item.kind === "planning_edit" || item.kind === "plan_options").slice(-5).map((item) => item.text); }
function recommendedCount(plan: PlanningResult): number { return plan.options.find((item) => item.optionId === plan.recommendation.recommendedOptionId)?.postCount ?? 0; }
function message(kind: ProjectMessageKind, text: string) { return { kind, text, createdAt: new Date() }; }
