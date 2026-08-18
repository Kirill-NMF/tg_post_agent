import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgCustomEmojiRepository } from "../src/repositories/pgCustomEmojiRepository.js";
import { openTestDatabase, type TestDatabaseHandle } from "./helpers/postgres.js";

const describeWithPostgres = process.env.TEST_DATABASE_URL ? describe : describe.skip;
let database: TestDatabaseHandle;

describeWithPostgres("PgCustomEmojiRepository", () => {
  beforeAll(async () => {
    const opened = await openTestDatabase(process.env);
    if (!opened) throw new Error("TEST_DATABASE_URL is required for Postgres integration tests.");
    database = opened;
  });
  afterAll(async () => database?.close());
  beforeEach(async () => database.clean());

  it("atomically replaces and reloads one complete six-role mapping after migrations", async () => {
    const repository = new PgCustomEmojiRepository(database.db);
    await repository.replaceAll(mappings(1001));
    await repository.replaceAll(mappings(2001));

    const reloaded = await new PgCustomEmojiRepository(database.db).get();

    expect(reloaded?.mappings).toEqual(mappings(2001));
    expect(reloaded?.mappings).toHaveLength(6);
  });

  it("rejects an incomplete replacement and preserves the prior complete mapping", async () => {
    const repository = new PgCustomEmojiRepository(database.db);
    await repository.replaceAll(mappings(1001));

    await expect(repository.replaceAll(mappings(2001).slice(0, 5))).rejects.toThrow("CUSTOM_EMOJI_MAPPING_INVALID");

    expect((await repository.get())?.mappings).toEqual(mappings(1001));
  });
});

function mappings(firstId: number) {
  const roles = ["post_title", "section_title", "list_item", "copy_block", "cta", "audience_question"] as const;
  const alts = ["📜", "⏸️", "🟠", "🔅", "🔥", "🟰"];
  return roles.map((role, index) => ({ role, customEmojiId: String(firstId + index), alt: alts[index]!, setName: `fixture_set_${index + 1}` }));
}
