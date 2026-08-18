import { describe, expect, it } from "vitest";
import {
  CRYPTUS_OPTION2_PROMPT_VERSION,
  buildCryptusOption2Prompt,
  validateCryptusOption2Candidate,
} from "../src/domain/cryptusOption2.js";

const ownerAcceptanceDraft = `### Ваша личная деревня «крепостных» для контента
У каждого уважающего себя предпринимателя должна быть своя деревня «крепостных». Именно так я вижу использование ИИ-агентов.
Вот конкретный пример. Недавно я создал себе ИИ-агента, который генерирует обложки для постов в стиле трэп-альбомов. А теперь давайте сравним затраты «до» и «после»:
Раньше: 5 дней работы и ~3000 рублей за одну обложку. Сейчас: 30 минут и 500 рублей.
С текстами история не менее крутая. Я могу просто надиктовать свои мысли, а ИИ перепишет их в стиле любого автора. В итоге за 40 минут я получаю мегасочный пост непревзойденного уровня, на который раньше ушёл бы целый день кропотливой работы.
Контент можно делать просто жирнющий, в разы быстрее и дешевле.
Почему бы этим не воспользоваться?`;

const validOwnerCandidate = `📜 **Ваша личная деревня «крепостных» для контента**

У каждого уважающего себя предпринимателя должна быть своя деревня «крепостных». Именно так я вижу использование ИИ-агентов.

Вот конкретный пример. Недавно я создал себе ИИ-агента, который генерирует обложки для постов в стиле трэп-альбомов. А теперь давайте сравним затраты «до» и «после»:

🟠 **Раньше:** 5 дней работы и ~3000 рублей за одну обложку.

🟠 **Сейчас:** 30 минут и 500 рублей.

С текстами история не менее крутая. Я могу просто надиктовать свои мысли, а ИИ перепишет их в стиле любого автора. В итоге за 40 минут я получаю мегасочный пост непревзойденного уровня, на который раньше ушёл бы целый день кропотливой работы.

🔥 **Контент можно делать просто жирнющий, в разы быстрее и дешевле.**

➡️ **Почему бы этим не воспользоваться?**`;

const validOwnerCandidateWithoutOptionalCta = validOwnerCandidate.replace(
  "🔥 **Контент можно делать просто жирнющий, в разы быстрее и дешевле.**",
  "Контент можно делать просто жирнющий, в разы быстрее и дешевле."
);

describe("CRYPTUS_MEDIA Option 2 final-text contract", () => {
  it("stores one versioned fixed prompt and appends the draft under the POST delimiter", () => {
    const prompt = buildCryptusOption2Prompt("Черновик.");

    expect(CRYPTUS_OPTION2_PROMPT_VERSION).toBe("cryptus_media_option2_v3");
    expect(prompt).toContain("Правила форматирования (Опция 2: CRYPTUS_MEDIA)");
    expect(prompt).toContain("Курсив запрещён.");
    expect(prompt).toContain("Раньше:");
    expect(prompt).toContain("Сейчас:");
    expect(prompt).toContain("(-, *, •, нумерацию)");
    expect(prompt).toContain("использовать только ➡️");
    expect(prompt).toContain("не добавлять 🔥");
    expect(prompt).toContain("Не добавлять другие эмодзи, Markdown-заголовки (#/##/###)");
    expect(prompt.endsWith('POST:\n"""\nЧерновик.\n"""')).toBe(true);
  });

  it("accepts the owner-equivalent form without inventing an optional CTA role", () => {
    expect(validateCryptusOption2Candidate(ownerAcceptanceDraft, validOwnerCandidateWithoutOptionalCta)).toMatchObject({
      ok: true,
      lexicalSequenceExact: true,
      punctuationPreserved: true,
      comparisonListValid: true,
      finalQuestionValid: true,
    });
  });

  it("accepts the owner fixture with bold scroll title, comparison anchors, and final arrow question", () => {
    expect(validateCryptusOption2Candidate(ownerAcceptanceDraft, validOwnerCandidate)).toEqual({
      ok: true,
      lexicalSequenceExact: true,
      punctuationPreserved: true,
      titleValid: true,
      finalQuestionValid: true,
      comparisonListValid: true,
      allowedEmojiOnly: true,
      markdownValid: true,
    });
  });

  it("treats source list markers as replaceable formatting anchors", () => {
    const source = `### Заголовок

- Первый пункт.
* Второй пункт.
1. Третий пункт.

Почему?`;
    const candidate = `📜 **Заголовок**

🟠 **Первый** пункт.
🟠 **Второй** пункт.
🟠 **Третий** пункт.

➡️ **Почему?**`;

    expect(validateCryptusOption2Candidate(source, candidate)).toMatchObject({
      ok: true,
      lexicalSequenceExact: true,
      punctuationPreserved: true,
    });
  });

  it("treats source bullet markers as replaceable formatting anchors in a production-shaped draft", () => {
    const source = `Заголовок

Вводный абзац сохраняет исходные слова и пунктуацию.

• Первый пункт остаётся первым.
• Второй пункт остаётся вторым.
• Третий пункт остаётся третьим.
• Четвёртый пункт остаётся четвёртым.

Обычный завершающий абзац остаётся без изменений.

Почему это важно?`;
    const candidate = `📜 **Заголовок**

Вводный абзац сохраняет исходные слова и пунктуацию.

🟠 **Первый** пункт остаётся первым.
🟠 **Второй** пункт остаётся вторым.
🟠 **Третий** пункт остаётся третьим.
🟠 **Четвёртый** пункт остаётся четвёртым.

Обычный завершающий абзац остаётся без изменений.

➡️ **Почему это важно?**`;

    expect(validateCryptusOption2Candidate(source, candidate)).toMatchObject({
      ok: true,
      lexicalSequenceExact: true,
      punctuationPreserved: true,
    });
  });

  it("keeps a bullet that is lexical punctuation inside a line", () => {
    const source = `Заголовок

Этот символ • остаётся частью предложения.

Почему?`;
    const candidate = `📜 **Заголовок**

Этот символ остаётся частью предложения.

➡️ **Почему?**`;

    expect(validateCryptusOption2Candidate(source, candidate)).toEqual({
      ok: false,
      code: "FORMAT_OPTION2_LEXICAL_PRESERVATION_FAILED",
    });
  });

  it("allows a reversible uppercase transform only for an isolated section heading", () => {
    const source = `Главный заголовок

Вводный абзац сохраняется без изменений.

Раздел о практике

Основной абзац сохраняется без изменений.

Почему это важно?`;
    const candidate = `📜 **Главный заголовок**

Вводный абзац сохраняется без изменений.

⏸️ **РАЗДЕЛ О ПРАКТИКЕ**

Основной абзац сохраняется без изменений.

➡️ **Почему это важно?**`;

    expect(validateCryptusOption2Candidate(source, candidate)).toMatchObject({
      ok: true,
      lexicalSequenceExact: true,
      punctuationPreserved: true,
    });
  });

  it("rejects an uppercase transform of an isolated ordinary sentence", () => {
    const source = `Главный заголовок

Это короткое предложение.

Основной абзац сохраняется без изменений.

Почему?`;
    const candidate = `📜 **Главный заголовок**

ЭТО КОРОТКОЕ ПРЕДЛОЖЕНИЕ.

Основной абзац сохраняется без изменений.

➡️ **Почему?**`;

    expect(validateCryptusOption2Candidate(source, candidate)).toEqual({
      ok: false,
      code: "FORMAT_OPTION2_LEXICAL_PRESERVATION_FAILED",
    });
  });

  it.each([
    ["missing scroll title", validOwnerCandidate.replace("📜 ", ""), "FORMAT_OPTION2_TITLE_INVALID"],
    ["remaining heading marker", validOwnerCandidate.replace("📜 **", "📜 **### "), "FORMAT_OPTION2_MARKDOWN_HEADING_FORBIDDEN"],
    ["compact heading marker", validOwnerCandidate.replace("📜 **", "📜 **###"), "FORMAT_OPTION2_MARKDOWN_HEADING_FORBIDDEN"],
    ["single-star italic", validOwnerCandidate.replace("У каждого", "*У каждого*"), "FORMAT_OPTION2_ITALIC_FORBIDDEN"],
    ["underscore italic", validOwnerCandidate.replace("У каждого", "_У каждого_"), "FORMAT_OPTION2_ITALIC_FORBIDDEN"],
    ["unapproved expressive emoji", validOwnerCandidate + "\n🎉", "FORMAT_OPTION2_EMOJI_FORBIDDEN"],
    ["changed source word", validOwnerCandidate.replace("предпринимателя", "автора"), "FORMAT_OPTION2_LEXICAL_PRESERVATION_FAILED"],
    ["omitted source word", validOwnerCandidate.replace("уважающего себя ", ""), "FORMAT_OPTION2_LEXICAL_PRESERVATION_FAILED"],
    ["reordered source words", validOwnerCandidate.replace("5 дней работы", "работы 5 дней"), "FORMAT_OPTION2_LEXICAL_PRESERVATION_FAILED"],
    ["comment outside post", validOwnerCandidate + "\nГотово.", "FORMAT_OPTION2_LEXICAL_PRESERVATION_FAILED"],
    ["comparison without orange anchors", validOwnerCandidate.replaceAll("🟠 ", ""), "FORMAT_OPTION2_COMPARISON_LIST_INVALID"],
    ["comparison value with extra bold", validOwnerCandidate.replace("**Раньше:** 5 дней", "**Раньше:** **5 дней**"), "FORMAT_OPTION2_COMPARISON_LIST_INVALID"],
    ["combined CTA and direct-question roles", validOwnerCandidate.replace("➡️ **Почему", "🔥 ➡️ **Почему"), "FORMAT_OPTION2_TERMINAL_ROLE_CONFLICT"],
    ["combined terminal roles across bold delimiter", validOwnerCandidate.replace("➡️ **Почему", "🔥 **➡️ Почему"), "FORMAT_OPTION2_TERMINAL_ROLE_CONFLICT"],
    ["question without arrow", validOwnerCandidate.replace("➡️ ", ""), "FORMAT_OPTION2_FINAL_QUESTION_INVALID"],
  ])("rejects %s", (_label, candidate, code) => {
    expect(validateCryptusOption2Candidate(ownerAcceptanceDraft, candidate)).toEqual({ ok: false, code });
  });

  it("rejects the owner-visible failure class before any style score can pass", () => {
    const bad = validOwnerCandidate
      .replace("📜 **", "✨### *")
      .replace("**\n\nУ каждого", "*\n\n*У каждого*")
      .replace("➡️ **Почему", "**Почему")
      + "\n🎉";

    expect(validateCryptusOption2Candidate(ownerAcceptanceDraft, bad)).toMatchObject({ ok: false });
  });
});
