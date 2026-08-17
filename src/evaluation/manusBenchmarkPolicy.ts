export type PrivateBenchmarkMode = "tuning" | "holdout";

export type PrivateBenchmarkSelection = {
  mode: PrivateBenchmarkMode;
  goldId: string;
  candidateId: string;
};

const tuningGoldIds = new Set(["primary_option2_final", "generalization_7", "generalization_9"]);
const holdoutGoldId = "holdout_10";

export function validatePrivateBenchmarkSelection(input: PrivateBenchmarkSelection):
  | { ok: true; mode: PrivateBenchmarkMode; holdout: boolean; goldId: string; candidateId: string }
  | { ok: false; code: string } {
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/u.test(input.candidateId) || input.candidateId === holdoutGoldId || tuningGoldIds.has(input.candidateId)) {
    return { ok: false, code: "MANUS_CANDIDATE_ID_INVALID" };
  }
  if (input.mode === "tuning") {
    if (input.goldId === holdoutGoldId) return { ok: false, code: "MANUS_HOLDOUT_TUNING_FORBIDDEN" };
    if (!tuningGoldIds.has(input.goldId)) return { ok: false, code: "MANUS_TUNING_GOLD_ID_INVALID" };
    return { ok: true, mode: "tuning", holdout: false, goldId: input.goldId, candidateId: input.candidateId };
  }
  if (input.mode === "holdout") {
    if (input.goldId !== holdoutGoldId) return { ok: false, code: "MANUS_HOLDOUT_ID_REQUIRED" };
    return { ok: true, mode: "holdout", holdout: true, goldId: input.goldId, candidateId: input.candidateId };
  }
  return { ok: false, code: "MANUS_BENCHMARK_MODE_INVALID" };
}
