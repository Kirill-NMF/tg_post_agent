import { eq } from "drizzle-orm";
import type { AppDb } from "../db/connection.js";
import { customEmojiSettings } from "../db/schema.js";
import { validateCompleteCustomEmojiMappings, type CustomEmojiConfiguration, type CustomEmojiMapping } from "../domain/customEmoji.js";
import type { CustomEmojiRepository } from "./customEmojiRepository.js";

const scope = "cryptus_option2";

export class PgCustomEmojiRepository implements CustomEmojiRepository {
  constructor(private readonly db: AppDb) {}

  async get(): Promise<CustomEmojiConfiguration | undefined> {
    const rows = await this.db.select().from(customEmojiSettings).where(eq(customEmojiSettings.scope, scope)).limit(1);
    const row = rows[0];
    if (!row || !row.enabled) return undefined;
    const mappings = validateCompleteCustomEmojiMappings(row.mappingsJson);
    if (!mappings) return undefined;
    return { mappings, updatedAt: row.updatedAt };
  }

  async replaceAll(mappings: CustomEmojiMapping[]): Promise<CustomEmojiConfiguration> {
    const validated = validateCompleteCustomEmojiMappings(mappings);
    if (!validated) throw new Error("CUSTOM_EMOJI_MAPPING_INVALID");
    const updatedAt = new Date();
    await this.db.insert(customEmojiSettings).values({ scope, mappingsJson: validated, enabled: true, updatedAt })
      .onConflictDoUpdate({ target: customEmojiSettings.scope, set: { mappingsJson: validated, enabled: true, updatedAt } });
    return { mappings: validated, updatedAt };
  }
}
