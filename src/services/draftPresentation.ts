import type { BotButton } from "../domain/types.js";

export function draftActionButtons(formattingEnabled = false, draftVersion = 1): BotButton[] {
  if (!formattingEnabled) return [];
  return [
    { label: "\u041e\u0444\u043e\u0440\u043c\u0438\u0442\u044c", action: "format:open" },
    { label: "\u0421\u0433\u0435\u043d\u0435\u0440\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u0437\u0430\u043d\u043e\u0432\u043e", action: "draft:regenerate:" + draftVersion }
  ];
}

export function draftReplyMarkup(formattingEnabled = false, draftVersion = 1) {
  return {
    inline_keyboard: draftActionButtons(formattingEnabled, draftVersion).map((button) => [{ text: button.label, callback_data: button.action }])
  };
}
