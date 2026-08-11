import type { TelegramUserId } from "../domain/types.js";

export class TelegramAuthService {
  constructor(private readonly allowedTelegramIds: ReadonlySet<TelegramUserId>) {}

  isAllowed(telegramUserId: TelegramUserId): boolean {
    return this.allowedTelegramIds.has(telegramUserId);
  }
}
