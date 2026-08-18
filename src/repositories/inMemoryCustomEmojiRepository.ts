import { validateCompleteCustomEmojiMappings, type CustomEmojiConfiguration, type CustomEmojiMapping } from "../domain/customEmoji.js";
import type { CustomEmojiRepository } from "./customEmojiRepository.js";

export class InMemoryCustomEmojiRepository implements CustomEmojiRepository {
  private configuration?: CustomEmojiConfiguration;

  async get(): Promise<CustomEmojiConfiguration | undefined> {
    return this.configuration ? clone(this.configuration) : undefined;
  }

  async replaceAll(mappings: CustomEmojiMapping[]): Promise<CustomEmojiConfiguration> {
    const validated = validateCompleteCustomEmojiMappings(mappings);
    if (!validated) throw new Error("CUSTOM_EMOJI_MAPPING_INVALID");
    this.configuration = { mappings: validated, updatedAt: new Date() };
    return clone(this.configuration);
  }
}

function clone(configuration: CustomEmojiConfiguration): CustomEmojiConfiguration {
  return { mappings: configuration.mappings.map((item) => ({ ...item })), updatedAt: new Date(configuration.updatedAt) };
}
