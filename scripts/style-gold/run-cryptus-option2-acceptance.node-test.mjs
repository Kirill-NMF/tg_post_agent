import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { validateAcceptancePreflight } from "./run-cryptus-option2-acceptance.mjs";

const valid = {
  apiKeyPresent: true,
  model: "anthropic/claude-sonnet-5",
  privateDirectoriesReady: true,
  expectedSpent: 55,
  expectedCap: 60,
  ledger: { attemptedBillableOperations: 55, dailyBudget: 60, remainingBudget: 5 },
};

test("acceptance preflight requires the exact owner-authorized ledger and Claude route", () => {
  assert.equal(validateAcceptancePreflight(valid), null);
  assert.equal(validateAcceptancePreflight({ ...valid, model: "other" }), "CRYPTUS_PROVIDER_MODEL_MISMATCH");
  assert.equal(validateAcceptancePreflight({ ...valid, expectedSpent: 54 }), "CRYPTUS_LEDGER_PRECONDITION_FAILED");
  assert.equal(validateAcceptancePreflight({ ...valid, privateDirectoriesReady: false }), "CRYPTUS_PRIVATE_PERMISSIONS_INVALID");
});

test("acceptance runner is physically bounded to one final-text call with fallback disabled", async () => {
  const source = await readFile(new URL("./run-cryptus-option2-acceptance.mjs", import.meta.url), "utf8");
  assert.match(source, /createLedgeredSingleAttemptClient/u);
  assert.match(source, /formatOption2FinalText/u);
  assert.match(source, /allow_fallbacks:\s*false/u);
  assert.match(source, /maxAttempts:\s*1/u);
  assert.doesNotMatch(source, /formatOption2Segments/u);
});
