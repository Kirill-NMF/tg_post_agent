import { describe, expect, it } from "vitest";
import {
  annotateGold,
  buildStyleProfile,
  calibrateStyleThreshold,
  deformatGold,
  evaluateManusStyle,
  restoreGoldFormatting,
  tokenizeLexical,
} from "../src/evaluation/manusStyleEvaluator.js";

const gold = [
  "📜 **ГЛАВНЫЙ ЗАГОЛОВОК**",
  "",
  "Вводный абзац.",
  "",
  "⏸️ **РАЗДЕЛ**",
  "",
  "🟠 **Первый:** пункт.",
  "",
  "🔅 `Скопируйте этот пример.`",
  "",
  "🔥 **Сделайте шаг.**",
  "",
  "➡️ **Что выберете?**",
].join("\n");

describe("Manus style gold deformatter", () => {
  it("removes presentation anchors without lexical loss and restores exact gold", () => {
    const result = deformatGold(gold);
    expect(result.plainText).not.toMatch(/[📜⏸🟠🔅🔥➡]/u);
    expect(result.plainText).not.toContain("**");
    expect(result.plainText).not.toContain("`");
    expect(restoreGoldFormatting(result.plainText, result.anchorMap)).toBe(gold);
    expect(tokenizeLexical(result.plainText).map((token) => token.toLocaleLowerCase("ru"))).toEqual(
      tokenizeLexical(gold).map((token) => token.toLocaleLowerCase("ru")),
    );
  });

  it("is idempotent for the neutral plain representation", () => {
    const once = deformatGold(gold).plainText;
    const twice = deformatGold(once).plainText;
    expect(twice).toBe(once);
  });

  it("removes composed emoji plus dash anchors in one deterministic pass", () => {
    const source = "🟠 💡 — Пункт с составным якорем.";
    const once = deformatGold(source);
    expect(deformatGold(once.plainText).plainText).toBe(once.plainText);
    expect(restoreGoldFormatting(once.plainText, once.anchorMap)).toBe(source);
  });

  it("handles empty and unformatted input", () => {
    expect(deformatGold("").plainText).toBe("");
    expect(deformatGold("Один абзац.").plainText).toBe("Один абзац.");
  });
});

describe("Manus style annotations", () => {
  it("extracts every benchmark role at lexical indices", () => {
    const roles = new Set(annotateGold(gold).map((anchor) => anchor.role));
    expect(roles).toEqual(new Set([
      "main_heading",
      "section_heading",
      "primary_list",
      "bold_span",
      "prompt_code",
      "cta",
      "audience_question",
      "paragraph_boundary",
    ]));
  });

  it("treats a limited non-role leading emoji as semantic accent", () => {
    const anchors = annotateGold("**ЗАГОЛОВОК**\n\n💡 **Мысль**");
    expect(anchors.some((anchor) => anchor.role === "semantic_accent")).toBe(true);
  });

  it("keeps known reference contradictions measurable instead of silently merging them", () => {
    const primary = annotateGold("**ГЛАВНЫЙ ЗАГОЛОВОК**\n\n🔅 `Пример.`\n\n— Пункт.");
    const later = annotateGold("**Главный заголовок**\n\n💡 **Акцент**\n\n🔅 `Пример один.`\n🔅 `Пример два.`");
    expect(primary.filter((anchor) => anchor.role === "main_heading")).toHaveLength(1);
    expect(later.filter((anchor) => anchor.role === "semantic_accent")).toHaveLength(1);
    expect(later.filter((anchor) => anchor.role === "prompt_code").length).toBeGreaterThan(primary.filter((anchor) => anchor.role === "prompt_code").length);
    expect(primary.filter((anchor) => anchor.role === "nested_list")).toHaveLength(1);
    expect(later.filter((anchor) => anchor.role === "bold_span")).toHaveLength(2);
  });
});

describe("Manus style evaluator", () => {
  it("passes the gold and exposes exact-byte equality only as a diagnostic", () => {
    const result = evaluateManusStyle(deformatGold(gold).plainText, gold, gold);
    expect(result.pass).toBe(true);
    expect(result.hardGates).toMatchObject({
      lexicalSequenceExact: true,
      punctuationPreserved: true,
      markdownBalanced: true,
      forbiddenStylesZero: true,
      inventedHashtagZero: true,
      inventedCtaZero: true,
      inventedQuestionZero: true,
      explicitProductContract: true,
    });
    expect(result.diagnostics.exactByteEquality).toBe(true);
    expect(result.weightedStyleScore).toBe(1);
  });

  it.each([
    ["word mutation", gold.replace("Первый", "Другой"), "lexicalSequenceExact"],
    ["punctuation mutation", gold.replace("абзац.", "абзац!"), "punctuationPreserved"],
    ["forbidden italic", gold.replace("Вводный", "_Вводный_"), "forbiddenStylesZero"],
    ["forbidden spoiler", gold.replace("Вводный", "||Вводный||"), "forbiddenStylesZero"],
    ["invented hashtag", gold + "\n#новый", "inventedHashtagZero"],
    ["invented CTA role", gold.replace("📜", "🔥"), "inventedCtaZero"],
    ["invalid emoji-like anchor", gold.replace("📜", "🏴󠁧󠁢󠁥󠁮󠁧󠁿"), "forbiddenEmojiCategoriesZero"],
  ])("rejects %s", (_name, candidate, gate) => {
    const result = evaluateManusStyle(deformatGold(gold).plainText, gold, candidate);
    expect(result.hardGates[gate as keyof typeof result.hardGates]).toBe(false);
    expect(result.pass).toBe(false);
  });

  it("rejects unbalanced Telegram Markdown", () => {
    const result = evaluateManusStyle(deformatGold(gold).plainText, gold, gold.replace("**ГЛАВНЫЙ ЗАГОЛОВОК**", "**ГЛАВНЫЙ ЗАГОЛОВОК"));
    expect(result.hardGates.markdownBalanced).toBe(false);
    expect(result.pass).toBe(false);
  });

  it("cannot pass a high-similarity candidate that violates the explicit owner product contract", () => {
    const invalid = gold
      .replace("📜 **", "✨### *")
      .replace("**\n\nВводный", "*\n\n*Вводный*")
      + "\n🎉";
    const result = evaluateManusStyle(deformatGold(gold).plainText, gold, invalid, 0);

    expect(result.hardGates.explicitProductContract).toBe(false);
    expect(result.diagnostics.productContractCode).toBeDefined();
    expect(result.pass).toBe(false);
  });

  it("penalizes random emoji, wrong roles, over-density, and missing headings", () => {
    const plain = deformatGold(gold).plainText;
    const noisy = gold.replace("📜", "🟠").replace("Вводный", "💡 Вводный").replace("**ГЛАВНЫЙ ЗАГОЛОВОК**", "ГЛАВНЫЙ ЗАГОЛОВОК");
    const result = evaluateManusStyle(plain, gold, noisy);
    expect(result.metrics.emojiRole.f1).toBeLessThan(1);
    expect(result.metrics.heading.f1).toBeLessThan(1);
    expect(result.metrics.emojiDensityDeviationPer100Words).toBeGreaterThan(0);
    expect(result.weightedStyleScore).toBeLessThan(1);
  });

  it("measures heading case separately from lexical preservation", () => {
    const candidate = gold.replace("ГЛАВНЫЙ ЗАГОЛОВОК", "Главный заголовок");
    const result = evaluateManusStyle(deformatGold(gold).plainText, gold, candidate);
    expect(result.hardGates.lexicalSequenceExact).toBe(true);
    expect(result.metrics.headingCaseAccuracy).toBeLessThan(1);
  });

  it("calibrates a bounded leave-one-out threshold and keeps holdout outside tuning", () => {
    const training = [gold, gold.replace("🟠", "🟠\n🟠"), gold.replace("🔅", "💡")].map((text) => buildStyleProfile(text));
    const calibration = calibrateStyleThreshold(training, "holdout_post_10");
    expect(calibration.trainingCount).toBe(3);
    expect(calibration.holdoutId).toBe("holdout_post_10");
    expect(calibration.threshold).toBeGreaterThanOrEqual(0.65);
    expect(calibration.threshold).toBeLessThanOrEqual(0.95);
  });
});
