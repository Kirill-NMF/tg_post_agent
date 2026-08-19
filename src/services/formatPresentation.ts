import type { BotButton, Project } from "../domain/types.js";
import { bindDone, bindFormat, canBindArtifactProjectId } from "./artifactCallback.js";

export function formatChoiceButtons(binding?: { projectId: string; postIndex: number; draftVersion: number }): BotButton[] {
  const bound = binding && canBindArtifactProjectId(binding.projectId) ? binding : undefined;
  return [
    { label: "Telegram", action: bound ? bindFormat(bound.projectId, bound.postIndex, bound.draftVersion, "option_1") : "format:option_1" },
    { label: "Telegram + emoji", action: bound ? bindFormat(bound.projectId, bound.postIndex, bound.draftVersion, "option_2") : "format:option_2" }
  ];
}

export function finalActionButtons(project: Project): BotButton[] {
  const post = project.posts.find((item) => item.index === project.currentPostIndex);
  const buttons: BotButton[] = [
    { label: "\u0412\u043d\u0435\u0441\u0442\u0438 \u043f\u0440\u0430\u0432\u043a\u0443", action: "format:edit" },
    { label: "\u0413\u043e\u0442\u043e\u0432\u043e", action: post && canBindArtifactProjectId(project.id) ? bindDone(project.id, post.index, post.draftVersion ?? 1) : "final:accept" }
  ];
  if (post && project.selectedPlan && post.index < project.selectedPlan.postCount) {
    buttons.push({ label: "\u0414\u0435\u043b\u0430\u0442\u044c \u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0438\u0439 \u043f\u043e\u0441\u0442", action: "series:next" });
  }
  return buttons;
}

export function formattedReplyMarkup(project: Project) {
  return { inline_keyboard: finalActionButtons(project).map((button) => [{ text: button.label, callback_data: button.action }]) };
}
