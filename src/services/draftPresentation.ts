import type { BotButton } from "../domain/types.js";
import { bindOpenFormat, bindRerun, canBindArtifactProjectId } from "./artifactCallback.js";

export function draftActionButtons(formattingEnabled = false, draftVersion = 1, binding?: { projectId: string; postIndex: number }): BotButton[] {
  if (!formattingEnabled) return [];
  const bound = binding && canBindArtifactProjectId(binding.projectId) ? binding : undefined;
  return [
    { label: "\u041e\u0444\u043e\u0440\u043c\u0438\u0442\u044c", action: bound ? bindOpenFormat(bound.projectId, bound.postIndex, draftVersion) : "format:open" },
    { label: "\u041f\u043e\u0447\u0438\u0441\u0442\u0438\u0442\u044c \u0437\u0430\u043d\u043e\u0432\u043e", action: bound ? bindRerun(bound.projectId, bound.postIndex, draftVersion, "clean_up") : "draft:rerun:clean_up:" + draftVersion },
    { label: "\u0421\u0434\u0435\u043b\u0430\u0442\u044c \u043f\u043e\u0441\u0442 \u0437\u0430\u043d\u043e\u0432\u043e", action: bound ? bindRerun(bound.projectId, bound.postIndex, draftVersion, "make_post") : "draft:rerun:make_post:" + draftVersion }
  ];
}

export function draftReplyMarkup(formattingEnabled = false, draftVersion = 1, binding?: { projectId: string; postIndex: number }) {
  return {
    inline_keyboard: draftActionButtons(formattingEnabled, draftVersion, binding).map((button) => [{ text: button.label, callback_data: button.action }])
  };
}

export function draftGenerationRetryMarkup(rewriteMode: "clean_up" | "make_post", sourceDraftVersion?: number) {
  const label = rewriteMode === "clean_up" ? "Повторить: Почистить" : "Повторить: Сделать пост";
  const action = sourceDraftVersion ? "draft:rerun:" + rewriteMode + ":" + sourceDraftVersion : "rewrite:" + rewriteMode;
  return { inline_keyboard: [[{ text: label, callback_data: action }]] };
}
