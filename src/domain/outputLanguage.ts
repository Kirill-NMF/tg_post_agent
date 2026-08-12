import type { OutputLanguage } from "./types.js";

export const DEFAULT_OUTPUT_LANGUAGE = "ru" as OutputLanguage;

export class OutputLanguageMismatchError extends Error {
  readonly code = "OUTPUT_LANGUAGE_MISMATCH";

  constructor() {
    super("OUTPUT_LANGUAGE_MISMATCH");
    this.name = "OutputLanguageMismatchError";
  }
}

const languageNames: Record<string, string> = {
  ru: "\u0440\u0443\u0441\u0441\u043a\u0438\u0439",
  en: "\u0430\u043d\u0433\u043b\u0438\u0439\u0441\u043a\u0438\u0439",
  de: "\u043d\u0435\u043c\u0435\u0446\u043a\u0438\u0439",
  fr: "\u0444\u0440\u0430\u043d\u0446\u0443\u0437\u0441\u043a\u0438\u0439",
  es: "\u0438\u0441\u043f\u0430\u043d\u0441\u043a\u0438\u0439",
  it: "\u0438\u0442\u0430\u043b\u044c\u044f\u043d\u0441\u043a\u0438\u0439",
  pt: "\u043f\u043e\u0440\u0442\u0443\u0433\u0430\u043b\u044c\u0441\u043a\u0438\u0439",
  uk: "\u0443\u043a\u0440\u0430\u0438\u043d\u0441\u043a\u0438\u0439",
  pl: "\u043f\u043e\u043b\u044c\u0441\u043a\u0438\u0439"
};

export function resolveOutputLanguage(current: OutputLanguage | undefined, latestUserEdit: string): OutputLanguage {
  return explicitLanguageFromInstruction(latestUserEdit) ?? normalizeOutputLanguage(current) ?? DEFAULT_OUTPUT_LANGUAGE;
}

export function outputLanguageInstruction(value: OutputLanguage | undefined): string {
  const language = normalizeOutputLanguage(value) ?? DEFAULT_OUTPUT_LANGUAGE;
  const languageName = languageNames[language] ?? language;
  return [
    `\u042f\u0417\u042b\u041a \u0418\u0422\u041e\u0413\u041e\u0412\u041e\u0413\u041e \u0422\u0415\u041a\u0421\u0422\u0410: ${languageName} (${language}).`,
    "\u041e\u0431\u044b\u0447\u043d\u044b\u0435 \u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043a\u0438, \u043e\u0431\u044a\u044f\u0441\u043d\u0435\u043d\u0438\u044f, \u043f\u0443\u043d\u043a\u0442\u044b \u043f\u043b\u0430\u043d\u0430 \u0438 CTA \u043f\u0438\u0448\u0438 \u043d\u0430 \u044d\u0442\u043e\u043c \u044f\u0437\u044b\u043a\u0435.",
    "\u0421\u043e\u0445\u0440\u0430\u043d\u044f\u0439 \u0438\u043c\u0435\u043d\u0430, \u0431\u0440\u0435\u043d\u0434\u044b, URL, \u0446\u0438\u0442\u0430\u0442\u044b \u0438 \u043d\u0435\u0438\u0437\u0431\u0435\u0436\u043d\u044b\u0435 \u0442\u0435\u0445\u043d\u0438\u0447\u0435\u0441\u043a\u0438\u0435 \u0442\u0435\u0440\u043c\u0438\u043d\u044b \u0432 \u043e\u0440\u0438\u0433\u0438\u043d\u0430\u043b\u044c\u043d\u043e\u043c \u043d\u0430\u043f\u0438\u0441\u0430\u043d\u0438\u0438, \u043a\u043e\u0433\u0434\u0430 \u044d\u0442\u043e \u0443\u043c\u0435\u0441\u0442\u043d\u043e.",
    "\u041d\u0435 \u043f\u0435\u0440\u0435\u0432\u043e\u0434\u0438 \u0438\u0441\u0445\u043e\u0434\u043d\u0443\u044e \u0440\u0430\u0441\u0448\u0438\u0444\u0440\u043e\u0432\u043a\u0443 \u0446\u0435\u043b\u0438\u043a\u043e\u043c: \u044d\u0442\u043e \u0442\u0440\u0435\u0431\u043e\u0432\u0430\u043d\u0438\u0435 \u0442\u043e\u043b\u044c\u043a\u043e \u043a \u0441\u043e\u0437\u0434\u0430\u0432\u0430\u0435\u043c\u043e\u043c\u0443 \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\u0443."
  ].join(" ");
}

export function assertExpectedOutputLanguage(fields: Array<string | undefined>, value: OutputLanguage | undefined): void {
  if ((normalizeOutputLanguage(value) ?? DEFAULT_OUTPUT_LANGUAGE) !== "ru") return;
  const text = fields.filter((field): field is string => typeof field === "string").join(" ");
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  const cyrillic = (text.match(/[\u0400-\u04FF]/g) ?? []).length;
  if (latin >= 24 && latin / Math.max(1, latin + cyrillic) > 0.9) throw new OutputLanguageMismatchError();
}

function explicitLanguageFromInstruction(value: string): OutputLanguage | undefined {
  const normalized = value.trim().toLowerCase();
  const tagged = normalized.match(/(?:^|[\n.;])\s*(?:language|output language|\u044f\u0437\u044b\u043a(?:\s+\u043e\u0442\u0432\u0435\u0442\u0430|\s+\u043f\u043e\u0441\u0442\u0430|\s+\u0432\u044b\u0432\u043e\u0434\u0430)?)\s*[:=-]\s*([a-z]{2,3}(?:-[a-z0-9]{2,8})?)/iu);
  if (tagged?.[1]) return normalizeOutputLanguage(tagged[1]);
  const hasInstructionVerb = /(?:\u043f\u0438\u0448\u0438|\u043d\u0430\u043f\u0438\u0448\u0438|\u0441\u0434\u0435\u043b\u0430\u0439|\u043e\u0442\u0432\u0435\u0442\u044c|\u0432\u0435\u0440\u043d\u0438\u0441\u044c|write|respond|answer)/iu.test(normalized);
  if (!hasInstructionVerb) return undefined;
  if (/(?:\u0440\u0443\u0441\u0441\u043a|\brussian\b)/iu.test(normalized)) return "ru" as OutputLanguage;
  if (/(?:\u0430\u043d\u0433\u043b\u0438\u0439\u0441\u043a|\benglish\b)/iu.test(normalized)) return "en" as OutputLanguage;
  if (/(?:\u043d\u0435\u043c\u0435\u0446\u043a|\bgerman\b)/iu.test(normalized)) return "de" as OutputLanguage;
  if (/(?:\u0444\u0440\u0430\u043d\u0446\u0443\u0437\u0441\u043a|\bfrench\b)/iu.test(normalized)) return "fr" as OutputLanguage;
  if (/(?:\u0438\u0441\u043f\u0430\u043d\u0441\u043a|\bspanish\b)/iu.test(normalized)) return "es" as OutputLanguage;
  return undefined;
}

function normalizeOutputLanguage(value: unknown): OutputLanguage | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/.test(normalized) ? normalized as OutputLanguage : undefined;
}