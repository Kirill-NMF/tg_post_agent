import { describe, expect, it } from "vitest";
import type { CustomEmojiConfiguration } from "../src/domain/customEmoji.js";
import { renderCryptusTelegramText } from "../src/telegram/cryptusTelegramRenderer.js";
import { applySegmentFormattingPlan, deriveCanonicalSegments } from "../src/domain/formatting.js";

function configuration(): CustomEmojiConfiguration {
  const roles = ["post_title", "section_title", "list_item", "copy_block", "cta", "audience_question"] as const;
  const alts = ["📜", "⏸️", "🟠", "🔅", "🔥", "🟰"];
  return {
    mappings: roles.map((role, index) => ({ role, customEmojiId: String(1001 + index), alt: alts[index]!, setName: `set_${index + 1}` })),
    updatedAt: new Date(0)
  };
}

describe("renderCryptusTelegramText", () => {
  it("accepts bold markup emitted by the source-backed Option 2 renderer", () => {
    const canonicalDraft = "Главный заголовок\n\nОбычный абзац.";
    const segments = deriveCanonicalSegments(canonicalDraft);
    const formatted = applySegmentFormattingPlan(canonicalDraft, "option_2", [
      { id: "block_1", kind: "markdown_span", style: "bold" },
      { id: "block_1", kind: "emoji_insertion", position: "before", emoji: "📜" },
    ], segments);

    expect(formatted).toMatchObject({ ok: true });
    if (!formatted.ok) return;
    const transport = renderCryptusTelegramText(formatted.text, configuration());
    expect(transport.entities.filter((entity) => entity.type === "bold")).toHaveLength(1);
    expect(transport.entities.filter((entity) => entity.type === "custom_emoji")).toHaveLength(1);
  });

  it("renders the strict bold/code subset with UTF-16 offsets and no literal delimiters", () => {
    const canonical = "📜 **ЗАГОЛОВОК**\n🔅 `код 🚀`\n🔥 **Действуйте**\n➡️ **Вопрос?**";
    const rendered = renderCryptusTelegramText(canonical, configuration());

    expect(rendered.text).toBe("📜 ЗАГОЛОВОК\n🔅 код 🚀\n🔥 Действуйте\n🟰 Вопрос?");
    expect(rendered.entities).toContainEqual({ type: "bold", offset: 3, length: 9 });
    expect(rendered.entities).toContainEqual({ type: "code", offset: 16, length: 6 });
    expect(rendered.entities).toContainEqual({ type: "custom_emoji", offset: 0, length: 2, custom_emoji_id: "1001" });
    expect(rendered.entities).toContainEqual({ type: "custom_emoji", offset: 37, length: 2, custom_emoji_id: "1006" });
    expect(rendered.usedCustomEmoji).toBe(true);
    expect(canonical).toContain("➡️");
  });

  it("uses ordinary Unicode markers with bold/code entities when mapping is missing", () => {
    const rendered = renderCryptusTelegramText("📜 **Заголовок**\n➡️ **Вопрос?**");

    expect(rendered.text).toBe("📜 Заголовок\n➡️ Вопрос?");
    expect(rendered.entities.every((entity) => entity.type !== "custom_emoji")).toBe(true);
    expect(rendered.usedCustomEmoji).toBe(false);
  });

  it("replaces every canonical role marker with its positional mapping actual alt", () => {
    const arbitrary = configuration();
    const actualAlts = ["🧾", "⏯️", "🔘", "💡", "▶️", "🟰"];
    arbitrary.mappings = arbitrary.mappings.map((mapping, index) => ({ ...mapping, alt: actualAlts[index]! }));
    const canonical = "📜 **Заголовок**\n⏸️ **СЕКЦИЯ**\n🟠 **Пункт**\n🔅 `код`\n🔥 **CTA**\n➡️ **Вопрос?**";

    const rendered = renderCryptusTelegramText(canonical, arbitrary);

    expect(rendered.text).toBe("🧾 Заголовок\n⏯️ СЕКЦИЯ\n🔘 Пункт\n💡 код\n▶️ CTA\n🟰 Вопрос?");
    expect(rendered.entities.filter((entity) => entity.type === "custom_emoji")).toHaveLength(6);
    expect(rendered.entities.filter((entity) => entity.type === "custom_emoji").map((entity) => entity.length)).toEqual(
      actualAlts.map((alt) => alt.length)
    );
    expect(rendered.usedCustomEmoji).toBe(true);
    expect(canonical).toBe("📜 **Заголовок**\n⏸️ **СЕКЦИЯ**\n🟠 **Пункт**\n🔅 `код`\n🔥 **CTA**\n➡️ **Вопрос?**");
  });

  it("preserves VS16/surrogate lengths and never places a custom entity inside code", () => {
    const rendered = renderCryptusTelegramText("📜 **A🚀B**\n🔅 `➡️ literal`", configuration());
    const bold = rendered.entities.find((entity) => entity.type === "bold");
    const code = rendered.entities.find((entity) => entity.type === "code");
    const custom = rendered.entities.filter((entity) => entity.type === "custom_emoji");

    expect(bold).toMatchObject({ offset: 3, length: 4 });
    expect(code).toMatchObject({ offset: 11, length: 10 });
    expect(custom).toHaveLength(2);
    expect(custom.some((entity) => entity.offset >= code!.offset && entity.offset < code!.offset + code!.length)).toBe(false);
  });

  it("rejects malformed, duplicate, or overlapping strict markup", () => {
    expect(() => renderCryptusTelegramText("📜 **broken")).toThrow("CRYPTUS_TELEGRAM_MARKUP_INVALID");
    expect(() => renderCryptusTelegramText("📜 **bold `nested`**")).toThrow("CRYPTUS_TELEGRAM_MARKUP_INVALID");
  });
});
