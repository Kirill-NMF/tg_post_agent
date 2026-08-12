import type { BotButton } from "../domain/types.js";

export function draftActionButtons(): BotButton[] {
  return [{ label: "Оформить", action: "format:open" }];
}

export function draftReplyMarkup() {
  return {
    inline_keyboard: draftActionButtons().map((button) => [{ text: button.label, callback_data: button.action }])
  };
}
