import { describe, expect, it, vi } from "vitest";
import { InMemoryCustomEmojiRepository } from "../src/repositories/inMemoryCustomEmojiRepository.js";
import { CustomEmojiSetupService, type IncomingTelegramEntity } from "../src/services/customEmojiSetupService.js";

const ownerId = "100";
const command = "/emoji_setup 📜 ⏸️ 🟠 🔅 🔥 🟰";

function entities(): IncomingTelegramEntity[] {
  const values = ["📜", "⏸️", "🟠", "🔅", "🔥", "🟰"];
  const result: IncomingTelegramEntity[] = [{ type: "bot_command", offset: 0, length: "/emoji_setup".length }];
  let offset = "/emoji_setup ".length;
  for (let index = 0; index < values.length; index += 1) {
    const alt = values[index]!;
    result.push({ type: "custom_emoji", offset, length: alt.length, custom_emoji_id: String(1001 + index) });
    offset += alt.length + (index === values.length - 1 ? 0 : 1);
  }
  return result;
}

function stickers() {
  return ["📜", "⏸️", "🟠", "🔅", "🔥", "🟰"].map((emoji, index) => ({
    type: "custom_emoji" as const,
    custom_emoji_id: String(1001 + index),
    emoji,
    set_name: index === 4 ? "owner_cta_pack" : "CRYPTUSinstrument"
  }));
}

describe("CustomEmojiSetupService", () => {
  it("orders realistic Telegram custom-emoji entities by UTF-16 source offsets", async () => {
    const repository = new InMemoryCustomEmojiRepository();
    const service = new CustomEmojiSetupService({ ownerTelegramId: ownerId, repository });
    const text = "/emoji_setup@tgpost_rewrite_bot  📜\n⏸️  🟠 🔅  🔥 🟰";
    const values = ["📜", "⏸️", "🟠", "🔅", "🔥", "🟰"];
    const custom = values.map((alt, index) => ({
      type: "custom_emoji",
      offset: text.indexOf(alt),
      length: alt.length,
      custom_emoji_id: String(1001 + index)
    } satisfies IncomingTelegramEntity));
    const realisticEntities: IncomingTelegramEntity[] = [
      { type: "bot_command", offset: 0, length: "/emoji_setup@tgpost_rewrite_bot".length },
      custom[2]!, custom[0]!, custom[5]!, custom[1]!, custom[4]!, custom[3]!
    ];

    const result = await service.configure(
      { telegramUserId: ownerId, text, entities: realisticEntities },
      vi.fn().mockResolvedValue(stickers())
    );

    expect(result).toMatchObject({ ok: true, code: "EMOJI_SETUP_SAVED" });
    expect((await repository.get())?.mappings.map((mapping) => mapping.role)).toEqual([
      "post_title", "section_title", "list_item", "copy_block", "cta", "audience_question"
    ]);
  });

  it("rejects every non-owner before resolving or storing custom emoji", async () => {
    const repository = new InMemoryCustomEmojiRepository();
    const resolve = vi.fn();
    const service = new CustomEmojiSetupService({ ownerTelegramId: ownerId, repository });

    const result = await service.configure({ telegramUserId: "101", text: command, entities: entities() }, resolve);

    expect(result).toEqual({ ok: false, code: "EMOJI_SETUP_FORBIDDEN", message: expect.any(String) });
    expect(resolve).not.toHaveBeenCalled();
    expect(await repository.get()).toBeUndefined();
  });

  it("requires exactly six ordered custom entities and no ambiguous extras", async () => {
    const repository = new InMemoryCustomEmojiRepository();
    const resolve = vi.fn().mockResolvedValue(stickers());
    const service = new CustomEmojiSetupService({ ownerTelegramId: ownerId, repository });

    const five = entities().slice(0, -1);
    await expect(service.configure({ telegramUserId: ownerId, text: command, entities: five }, resolve))
      .resolves.toMatchObject({ ok: false, code: "EMOJI_SETUP_ENTITY_COUNT_INVALID" });

    const ambiguous = [...entities(), { type: "bold", offset: 13, length: 2 }];
    await expect(service.configure({ telegramUserId: ownerId, text: command, entities: ambiguous }, resolve))
      .resolves.toMatchObject({ ok: false, code: "EMOJI_SETUP_ENTITIES_AMBIGUOUS" });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("assigns all six roles positionally and persists each sticker actual alt", async () => {
    const repository = new InMemoryCustomEmojiRepository();
    const service = new CustomEmojiSetupService({ ownerTelegramId: ownerId, repository });
    const actualAlts = ["🧾", "⏯️", "🔘", "💡", "▶️", "🟰"];
    const actualCommand = `/emoji_setup ${actualAlts.join(" ")}`;
    let offset = "/emoji_setup ".length;
    const actualEntities: IncomingTelegramEntity[] = [{ type: "bot_command", offset: 0, length: "/emoji_setup".length }];
    for (let index = 0; index < actualAlts.length; index += 1) {
      const alt = actualAlts[index]!;
      actualEntities.push({ type: "custom_emoji", offset, length: alt.length, custom_emoji_id: String(1001 + index) });
      offset += alt.length + (index === actualAlts.length - 1 ? 0 : 1);
    }
    const resolved = actualAlts.map((emoji, index) => ({
      type: "custom_emoji" as const,
      custom_emoji_id: String(1001 + index),
      emoji,
      set_name: `owner_pack_${index + 1}`
    }));

    const result = await service.configure(
      { telegramUserId: ownerId, text: actualCommand, entities: actualEntities },
      vi.fn().mockResolvedValue(resolved)
    );

    expect(result).toMatchObject({ ok: true, code: "EMOJI_SETUP_SAVED" });
    expect((await repository.get())?.mappings.map((mapping) => [mapping.role, mapping.alt, mapping.setName])).toEqual([
      ["post_title", "🧾", "owner_pack_1"],
      ["section_title", "⏯️", "owner_pack_2"],
      ["list_item", "🔘", "owner_pack_3"],
      ["copy_block", "💡", "owner_pack_4"],
      ["cta", "▶️", "owner_pack_5"],
      ["audience_question", "🟰", "owner_pack_6"]
    ]);
  });

  it("stores nothing when a resolved sticker is missing, mismatched, or has an invalid fixed alt", async () => {
    const repository = new InMemoryCustomEmojiRepository();
    const service = new CustomEmojiSetupService({ ownerTelegramId: ownerId, repository });
    const invalid = stickers();
    invalid[2] = { ...invalid[2]!, emoji: "🔴" };

    const result = await service.configure(
      { telegramUserId: ownerId, text: command, entities: entities() },
      vi.fn().mockResolvedValue(invalid)
    );

    expect(result).toMatchObject({ ok: false, code: "EMOJI_SETUP_ENTITY_ALT_MISMATCH" });
    expect(await repository.get()).toBeUndefined();
  });

  it("atomically replaces the complete mapping instead of merging roles", async () => {
    const repository = new InMemoryCustomEmojiRepository();
    const service = new CustomEmojiSetupService({ ownerTelegramId: ownerId, repository });
    await service.configure({ telegramUserId: ownerId, text: command, entities: entities() }, vi.fn().mockResolvedValue(stickers()));
    const replacement = stickers().map((item, index) => ({ ...item, custom_emoji_id: String(2001 + index) }));
    let replacementIndex = 0;
    const replacementEntities = entities().map((entity) => entity.type === "custom_emoji" ? { ...entity, custom_emoji_id: String(2001 + replacementIndex++) } : entity);

    await service.configure({ telegramUserId: ownerId, text: command, entities: replacementEntities }, vi.fn().mockResolvedValue(replacement));

    expect((await repository.get())?.mappings.map((mapping) => mapping.customEmojiId)).toEqual(replacement.map((item) => item.custom_emoji_id));
  });
});
