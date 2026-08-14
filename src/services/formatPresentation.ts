import type { BotButton, Project } from "../domain/types.js";

export function formatChoiceButtons(): BotButton[] {
  return [
    { label: "Telegram", action: "format:option_1" },
    { label: "Telegram + emoji", action: "format:option_2" }
  ];
}

export function finalActionButtons(project: Project): BotButton[] {
  const buttons: BotButton[] = [
    { label: "\u0412\u043d\u0435\u0441\u0442\u0438 \u043f\u0440\u0430\u0432\u043a\u0443", action: "format:edit" },
    { label: "\u0413\u043e\u0442\u043e\u0432\u043e", action: "final:accept" }
  ];
  const post = project.posts.find((item) => item.index === project.currentPostIndex);
  if (post && project.selectedPlan && post.index < project.selectedPlan.postCount) {
    buttons.push({ label: "\u0414\u0435\u043b\u0430\u0442\u044c \u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0438\u0439 \u043f\u043e\u0441\u0442", action: "series:next" });
  }
  return buttons;
}

export function formattedReplyMarkup(project: Project) {
  return { inline_keyboard: finalActionButtons(project).map((button) => [{ text: button.label, callback_data: button.action }]) };
}
