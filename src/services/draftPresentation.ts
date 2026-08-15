import type { BotButton } from "../domain/types.js";

export function draftActionButtons(formattingEnabled = false, draftVersion = 1): BotButton[] {
  if (!formattingEnabled) return [];
  return [
    { label: "\u041e\u0444\u043e\u0440\u043c\u0438\u0442\u044c", action: "format:open" },
    { label: "\u041f\u043e\u0447\u0438\u0441\u0442\u0438\u0442\u044c \u0437\u0430\u043d\u043e\u0432\u043e", action: "draft:rerun:clean_up:" + draftVersion },
    { label: "\u0421\u0434\u0435\u043b\u0430\u0442\u044c \u043f\u043e\u0441\u0442 \u0437\u0430\u043d\u043e\u0432\u043e", action: "draft:rerun:make_post:" + draftVersion }
  ];
}

export function draftReplyMarkup(formattingEnabled = false, draftVersion = 1) {
  return {
    inline_keyboard: draftActionButtons(formattingEnabled, draftVersion).map((button) => [{ text: button.label, callback_data: button.action }])
  };
}

export function draftGenerationRetryMarkup(rewriteMode: "clean_up" | "make_post", sourceDraftVersion?: number) {
  const label = rewriteMode === "clean_up" ? "Повторить: Почистить" : "Повторить: Сделать пост";
  const action = sourceDraftVersion ? "draft:rerun:" + rewriteMode + ":" + sourceDraftVersion : "rewrite:" + rewriteMode;
  return { inline_keyboard: [[{ text: label, callback_data: action }]] };
}
