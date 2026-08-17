import { describe, expect, it } from "vitest";
import { validatePrivateBenchmarkSelection } from "../src/evaluation/manusBenchmarkPolicy.js";

describe("private Manus benchmark selection", () => {
  it.each(["primary_option2_final", "generalization_7", "generalization_9"])("allows training gold %s in tuning mode", (goldId) => {
    expect(validatePrivateBenchmarkSelection({ mode: "tuning", goldId, candidateId: "candidate_01" })).toMatchObject({ ok: true, mode: "tuning", holdout: false });
  });

  it("refuses post_10 in tuning mode before candidate access", () => {
    expect(validatePrivateBenchmarkSelection({ mode: "tuning", goldId: "holdout_10", candidateId: "candidate_01" }))
      .toEqual({ ok: false, code: "MANUS_HOLDOUT_TUNING_FORBIDDEN" });
  });

  it("allows only post_10 in holdout mode", () => {
    expect(validatePrivateBenchmarkSelection({ mode: "holdout", goldId: "holdout_10", candidateId: "candidate_01" })).toMatchObject({ ok: true, mode: "holdout", holdout: true });
    expect(validatePrivateBenchmarkSelection({ mode: "holdout", goldId: "generalization_9", candidateId: "candidate_01" })).toEqual({ ok: false, code: "MANUS_HOLDOUT_ID_REQUIRED" });
  });

  it.each(["../escape", "candidate with spaces", "", "holdout_10"])("refuses unsafe or reserved candidate id %s", (candidateId) => {
    expect(validatePrivateBenchmarkSelection({ mode: "tuning", goldId: "primary_option2_final", candidateId })).toMatchObject({ ok: false });
  });
});
