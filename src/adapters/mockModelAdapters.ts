import type { ModelAdapters } from "../domain/modelContracts.js";
import type { AdapterMeta, AdapterResult, FormattingRevision, PlanningResult, PreservationCheck } from "../domain/types.js";

const meta: AdapterMeta = { provider: "mock", modelLabel: "phase-3-mock" };

export class MockModelAdapters implements ModelAdapters {
  async transcribeSource(): Promise<AdapterResult<{ transcript: string }>> { return ok({ transcript: "Mock transcript from Telegram audio. It contains one coherent idea for a Telegram post." }); }
  async transcribeEdit(): Promise<AdapterResult<{ editText: string }>> { return ok({ editText: "Mock voice edit: make the current text clearer." }); }
  async planSplit(_input: Parameters<ModelAdapters["planSplit"]>[0]): Promise<AdapterResult<PlanningResult>> { return ok(singlePostRecommendation()); }
  async revisePlan(input: Parameters<ModelAdapters["revisePlan"]>[0]): Promise<AdapterResult<PlanningResult & { changeSummary: string }>> {
    const base = singlePostRecommendation();
    return ok({ ...base, recommendation: { ...base.recommendation, rationale: base.recommendation.rationale + " Учтена правка: " + input.latestUserEdit }, changeSummary: "Mock plan recommendation updated from edit." });
  }
  async generateDraft(input: Parameters<ModelAdapters["generateDraft"]>[0]): Promise<AdapterResult<{ draft: { fullText: string; title: string } }>> {
    const modeText = input.rewriteMode === "clean_up" ? "cleaned-up source voice" : "Telegram-ready post";
    return ok({ draft: { title: "Mock draft " + input.postIndex, fullText: "Mock draft " + input.postIndex + ": " + modeText + ". This is a full draft generated from the selected plan." } });
  }
  async reviseDraft(input: { currentDraft: string; latestUserEdit: string }): Promise<AdapterResult<{ updatedDraft: { fullText: string }; appliedEditSummary: string }>> {
    return ok({ updatedDraft: { fullText: input.currentDraft + "\n\nApplied edit: " + input.latestUserEdit }, appliedEditSummary: "Mock draft revision applied." });
  }
  async formatPost(input: Parameters<ModelAdapters["formatPost"]>[0]): Promise<AdapterResult<{ formattedText: string; formattingNotes: string[] }>> { return ok({ formattedText: input.formattingOption === "option_2" ? "✨ " + input.draftText : input.draftText, formattingNotes: ["Mock " + input.formattingOption + " formatting."] }); }
  async reviseFormatting(input: Parameters<ModelAdapters["reviseFormatting"]>[0]): Promise<AdapterResult<FormattingRevision>> {
    if (/\b(word|wording|meaning|draft|semantic|text)\b/i.test(input.latestUserEdit)) return ok({ action: "route_to_draft", draftEditInstruction: input.latestUserEdit, editClassification: "semantic_or_wording_change", reason: "Mock classifier treats this as wording or meaning change." });
    return ok({ action: "updated_formatting", formattedText: input.formattedText + "\n\nFormatting edit: " + input.latestUserEdit, editClassification: "formatting_only" });
  }
  async checkPreservation(input: Parameters<ModelAdapters["checkPreservation"]>[0]): Promise<AdapterResult<PreservationCheck>> {
    const passed = normalize(input.formattedText).includes(normalize(input.draftText));
    return ok({ passed, severity: passed ? "none" : "major", reasons: passed ? [] : [{ code: "wording_changed", message: "Mock preservation check could not find the draft text inside the formatted text." }], suggestedAction: passed ? "accept" : "retry_formatting" });
  }
}
function singlePostRecommendation(): PlanningResult { return { options: [{ optionId: "recommended", postCount: 1, title: "Один цельный пост", angle: "Главная мысль", summary: "Материал представляет одну завершённую мысль.", posts: [{ index: 1, topic: "Главная мысль", angle: "Дать полный ответ в одном посте.", includes: ["core transcript idea"] }] }], recommendation: { recommendedOptionId: "recommended", rationale: "Это одна связная мысль с единым выводом; деление не улучшит чтение.", confidence: "high" } }; }
function ok<T>(value: T): AdapterResult<T> { return { ok: true, value, meta }; }
function normalize(value: string): string { return value.replace(/^[✨•\-]\s*/gm, "").replace(/\s+/g, " ").trim(); }
