import type { BotButton, PlanOption, PlanOptionId } from "../domain/types.js";

export const planOptionOrder: PlanOptionId[] = ["one_post", "two_posts", "three_posts"];

export function planButtons(): BotButton[] {
  return [
    { label: "1 пост", action: "plan:one_post" },
    { label: "2 поста", action: "plan:two_posts" },
    { label: "3 поста", action: "plan:three_posts" }
  ];
}

export function renderPlanningScreen(options: PlanOption[]): string {
  return options
    .map((option) => {
      const slices = option.posts.map((slice) => `${slice.index}. ${slice.topic}: ${slice.angle}`).join("\n");
      return `${option.postCount} ${postWord(option.postCount)}: ${option.title}\n${option.summary}\n${slices}`;
    })
    .join("\n\n");
}

export function renderPlanOptionsMessage(options: PlanOption[]): string {
  return `Готовы варианты разбивки. Выберите 1/2/3:\n\n${renderPlanningScreen(options)}`;
}

export function renderPlanOptionsHistory(options: PlanOption[]): string {
  return options.map((option) => `${option.optionId}:${option.title}`).join(", ");
}

export function planReplyMarkup() {
  return {
    inline_keyboard: planButtons().map((button) => [{ text: button.label, callback_data: button.action }])
  };
}

function postWord(count: number): string {
  if (count === 1) return "пост";
  return "поста";
}
