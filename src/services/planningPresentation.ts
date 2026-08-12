import type { BotButton, PlanOption, PlanningResult } from "../domain/types.js";

export function planButtons(plan: PlanningResult): BotButton[] {
  const buttons: BotButton[] = [{ label: "Взять в работу", action: `plan:${plan.recommendation.recommendedOptionId}` }];
  if (alternatives(plan).length) buttons.push({ label: "Показать другие разбивки", action: "plan:show_alternatives" });
  return buttons;
}

export function alternativePlanButtons(plan: PlanningResult): BotButton[] {
  return alternatives(plan).map((option) => ({ label: `Выбрать: ${option.postCount} ${postWord(option.postCount)}`, action: `plan:${option.optionId}` }));
}

export function renderPlanRecommendationMessage(plan: PlanningResult): string {
  const recommended = recommendedPlan(plan);
  return [
    `Рекомендую: ${recommended.postCount} ${postWord(recommended.postCount)}`,
    plan.recommendation.rationale,
    `Уверенность: ${confidenceLabel(plan.recommendation.confidence)}`,
    "",
    renderPlan(recommended)
  ].join("\n");
}

export function renderAlternativePlansMessage(plan: PlanningResult): string {
  return alternatives(plan).map(renderPlan).join("\n\n");
}

export function renderPlanOptionsHistory(plan: PlanningResult): string {
  return `recommended:${plan.recommendation.recommendedOptionId}; confidence:${plan.recommendation.confidence}; options:${plan.options.map((option) => `${option.optionId}:${option.title}`).join(", ")}`;
}

export function planReplyMarkup(plan: PlanningResult) {
  return { inline_keyboard: planButtons(plan).map((button) => [{ text: button.label, callback_data: button.action }]) };
}

export function recommendedPlan(plan: PlanningResult): PlanOption {
  const option = plan.options.find((item) => item.optionId === plan.recommendation.recommendedOptionId);
  if (!option) throw new Error("Recommended plan option is missing.");
  return option;
}

export function alternatives(plan: PlanningResult): PlanOption[] {
  return plan.options.filter((option) => option.optionId !== plan.recommendation.recommendedOptionId);
}

function renderPlan(option: PlanOption): string {
  const slices = option.posts.map((slice) => `${slice.index}. ${slice.topic}: ${slice.angle}`).join("\n");
  return `${option.postCount} ${postWord(option.postCount)}: ${option.title}\n${option.summary}\n${slices}`;
}

function postWord(count: number): string {
  if (count === 1) return "пост";
  if (count === 2 || count === 3) return "поста";
  return "постов";
}

function confidenceLabel(value: PlanningResult["recommendation"]["confidence"]): string {
  if (value === "high") return "высокая";
  if (value === "medium") return "средняя";
  return "низкая";
}
