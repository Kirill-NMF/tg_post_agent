import type { BotButton } from "../domain/types.js";

export function draftActionButtons(formattingEnabled = false): BotButton[] {
  return formattingEnabled ? [{ label: "\u041e\u0444\u043e\u0440\u043c\u0438\u0442\u044c", action: "format:open" }] : [];
}

export function draftReplyMarkup(formattingEnabled = false) {
  return {
    inline_keyboard: draftActionButtons(formattingEnabled).map((button) => [{ text: button.label, callback_data: button.action }])
  };
}
