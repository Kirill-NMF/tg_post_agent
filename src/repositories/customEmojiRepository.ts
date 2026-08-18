import type { CustomEmojiConfiguration, CustomEmojiMapping } from "../domain/customEmoji.js";

export type CustomEmojiRepository = {
  get(): Promise<CustomEmojiConfiguration | undefined>;
  replaceAll(mappings: CustomEmojiMapping[]): Promise<CustomEmojiConfiguration>;
};
