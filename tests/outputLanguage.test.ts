import { describe, expect, it } from "vitest";
import {
  DEFAULT_OUTPUT_LANGUAGE,
  assertExpectedOutputLanguage,
  resolveOutputLanguage
} from "../src/domain/outputLanguage.js";

describe("Stage 2 output language policy", () => {
  it("defaults to Russian and changes only for an explicit user instruction", () => {
    expect(resolveOutputLanguage(undefined, "Mixed EN/RU source mentions a brand.")).toBe(DEFAULT_OUTPUT_LANGUAGE);
    expect(resolveOutputLanguage(undefined, "\u041f\u0438\u0448\u0438 \u043f\u043e\u0441\u0442 \u043f\u043e-\u0430\u043d\u0433\u043b\u0438\u0439\u0441\u043a\u0438.")).toBe("en");
    expect(resolveOutputLanguage("en", "\u0412\u0435\u0440\u043d\u0438\u0441\u044c \u043a \u0440\u0443\u0441\u0441\u043a\u043e\u043c\u0443 \u044f\u0437\u044b\u043a\u0443.")).toBe("ru");
    expect(resolveOutputLanguage("ru", "Language: de")).toBe("de");
  });

  it("rejects clearly Latin-script output for the default Russian policy without retrying it", () => {
    expect(() => assertExpectedOutputLanguage(["This is a complete English plan with a clear hook and payoff."], "ru")).toThrow(
      "OUTPUT_LANGUAGE_MISMATCH"
    );
    expect(() => assertExpectedOutputLanguage(["\u041d\u0430\u0437\u0432\u0430\u043d\u0438\u0435 \u0431\u0440\u0435\u043d\u0434\u0430 OpenRouter. \u041e\u0431\u044b\u0447\u043d\u043e\u0435 \u043e\u0431\u044a\u044f\u0441\u043d\u0435\u043d\u0438\u0435 \u043d\u0430 \u0440\u0443\u0441\u0441\u043a\u043e\u043c."], "ru")).not.toThrow();
    expect(() => assertExpectedOutputLanguage(["A complete English response"], "en")).not.toThrow();
  });
});