import type { ModelAdapters } from "../domain/modelContracts.js";
import type { AdapterMeta, AdapterResult, FormattingRevision, PlanOption, PreservationCheck } from "../domain/types.js";

const meta: AdapterMeta = { provider: "mock", modelLabel: "phase-3-mock" };

export class MockModelAdapters implements ModelAdapters {
  async transcribeSource(_input: Parameters<ModelAdapters["transcribeSource"]>[0]): Promise<AdapterResult<{ transcript: string }>> {
    return ok({ transcript: "Mock transcript from Telegram audio. It has enough material for a short Telegram post series." });
  }

  async transcribeEdit(_input: Parameters<ModelAdapters["transcribeEdit"]>[0]): Promise<AdapterResult<{ editText: string }>> {
    return ok({ editText: "Mock voice edit: make the current text clearer." });
  }

  async planSplit(_input: Parameters<ModelAdapters["planSplit"]>[0]): Promise<AdapterResult<{ options: PlanOption[] }>> {
    return ok({ options: buildPlanOptions() });
  }

  async revisePlan(input: { latestUserEdit: string }): Promise<AdapterResult<{ options: PlanOption[]; changeSummary: string }>> {
    const options = buildPlanOptions().map((option) => ({
      ...option,
      summary: `${option.summary} Revision note: ${input.latestUserEdit}`
    }));
    return ok({ options, changeSummary: "Mock plan options updated from edit." });
  }

  async generateDraft(input: Parameters<ModelAdapters["generateDraft"]>[0]): Promise<AdapterResult<{ draft: { fullText: string; title: string } }>> {
    const modeText = input.rewriteMode === "clean_up" ? "cleaned-up source voice" : "Telegram-ready post";
    return ok({
      draft: {
        title: `Mock draft ${input.postIndex}`,
        fullText: `Mock draft ${input.postIndex}: ${modeText}. This is a full draft generated from the selected plan.`
      }
    });
  }

  async reviseDraft(input: {
    currentDraft: string;
    latestUserEdit: string;
  }): Promise<AdapterResult<{ updatedDraft: { fullText: string }; appliedEditSummary: string }>> {
    return ok({
      updatedDraft: { fullText: `${input.currentDraft}\n\nApplied edit: ${input.latestUserEdit}` },
      appliedEditSummary: "Mock draft revision applied."
    });
  }

  async formatPost(input: Parameters<ModelAdapters["formatPost"]>[0]): Promise<AdapterResult<{ formattedText: string; formattingNotes: string[] }>> {
    const formattedText = input.formattingOption === "option_2" ? `? ${input.draftText}` : input.draftText;
    return ok({ formattedText, formattingNotes: [`Mock ${input.formattingOption} formatting.`] });
  }

  async reviseFormatting(input: Parameters<ModelAdapters["reviseFormatting"]>[0]): Promise<AdapterResult<FormattingRevision>> {
    if (/\b(word|wording|meaning|draft|semantic|text)\b/i.test(input.latestUserEdit)) {
      return ok({
        action: "route_to_draft",
        draftEditInstruction: input.latestUserEdit,
        editClassification: "semantic_or_wording_change",
        reason: "Mock classifier treats this as wording or meaning change."
      });
    }

    return ok({
      action: "updated_formatting",
      formattedText: `${input.formattedText}\n\nFormatting edit: ${input.latestUserEdit}`,
      editClassification: "formatting_only"
    });
  }

  async checkPreservation(input: Parameters<ModelAdapters["checkPreservation"]>[0]): Promise<AdapterResult<PreservationCheck>> {
    const normalizedDraft = normalizeForMockCheck(input.draftText);
    const normalizedFormatted = normalizeForMockCheck(input.formattedText);
    const passed = normalizedFormatted.includes(normalizedDraft);
    return ok({
      passed,
      severity: passed ? "none" : "major",
      reasons: passed ? [] : [{ code: "wording_changed", message: "Mock preservation check could not find the draft text inside the formatted text." }],
      suggestedAction: passed ? "accept" : "retry_formatting"
    });
  }
}

function ok<T>(value: T): AdapterResult<T> {
  return { ok: true, value, meta };
}

function buildPlanOptions(): PlanOption[] {
  return [1, 2, 3].map((count) => {
    const postCount = count as 1 | 2 | 3;
    return {
      optionId: count === 1 ? "one_post" : count === 2 ? "two_posts" : "three_posts",
      postCount,
      title: `${count} post${count === 1 ? "" : "s"}`,
      angle: "Mock planning angle",
      summary: `Split transcript into ${count} post${count === 1 ? "" : "s"}.`,
      posts: Array.from({ length: count }, (_, index) => ({
        index: (index + 1) as 1 | 2 | 3,
        topic: `Mock topic ${index + 1}`,
        angle: "Keep the original idea clear.",
        includes: ["core transcript idea"]
      }))
    };
  });
}

function normalizeForMockCheck(value: string): string {
  return value.replace(/^[?\-]\s*/gm, "").replace(/\s+/g, " ").trim();
}
