import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  atomicPrivateWrite,
  createSafeDiagnosticsLogger,
  createLedgeredSingleAttemptClient,
  validateTuningPreflight,
} from "./run-private-tuning-candidate.mjs";

const manifest = {
  holdout: "holdout_10",
  documents: [
    { id: "primary_option2_final", holdout: false, sha256: "gold-hash" },
    { id: "holdout_10", holdout: true, sha256: "holdout-hash" },
  ],
};

test("tuning preflight accepts only matching primary gold with budget and Claude route", () => {
  assert.equal(validateTuningPreflight({
    goldId: "primary_option2_final",
    manifest,
    formattedHash: "gold-hash",
    corpusPrivate: true,
    outputPrivate: true,
    ledger: { dailyBudget: 50, attemptedBillableOperations: 46, remainingBudget: 4, entries: [] },
    expectedLedgerSpent: 46,
    model: "anthropic/claude-sonnet-5",
    apiKeyPresent: true,
  }), null);
});

test("tuning preflight refuses holdout and hash mismatch before provider", () => {
  const common = {
    manifest,
    corpusPrivate: true,
    outputPrivate: true,
    ledger: { dailyBudget: 50, attemptedBillableOperations: 46, remainingBudget: 4, entries: [] },
    expectedLedgerSpent: 46,
    model: "anthropic/claude-sonnet-5",
    apiKeyPresent: true,
  };
  assert.equal(validateTuningPreflight({ ...common, goldId: "holdout_10", formattedHash: "holdout-hash" }), "MANUS_HOLDOUT_TUNING_FORBIDDEN");
  assert.equal(validateTuningPreflight({ ...common, goldId: "primary_option2_final", formattedHash: "wrong" }), "MANUS_GOLD_HASH_MISMATCH");
  assert.equal(validateTuningPreflight({ ...common, goldId: "primary_option2_final", formattedHash: "gold-hash", outputPrivate: false }), "MANUS_PRIVATE_PERMISSIONS_INVALID");
});

test("tuning preflight supports a later explicitly reconciled correction slot", () => {
  assert.equal(validateTuningPreflight({
    goldId: "primary_option2_final",
    manifest,
    formattedHash: "gold-hash",
    corpusPrivate: true,
    outputPrivate: true,
    ledger: { dailyBudget: 50, attemptedBillableOperations: 47, remainingBudget: 3, entries: [] },
    expectedLedgerSpent: 47,
    model: "anthropic/claude-sonnet-5",
    apiKeyPresent: true,
  }), null);
});

test("ledgered client reserves exactly one provider attempt and refuses a second call", async () => {
  const events = [];
  let calls = 0;
  const client = createLedgeredSingleAttemptClient({
    client: { async create() { calls += 1; return { output_text: "{}" }; } },
    reserve: async () => events.push("reserved"),
    complete: async (category) => events.push(category),
  });
  assert.deepEqual(await client.create({}), { output_text: "{}" });
  await assert.rejects(() => client.create({}), /MANUS_PROVIDER_ATTEMPT_LIMIT/);
  assert.equal(calls, 1);
  assert.deepEqual(events, ["reserved", "provider_success"]);
});

test("ledgered client records one terminal failure without retry", async () => {
  const events = [];
  let calls = 0;
  const client = createLedgeredSingleAttemptClient({
    client: { async create() { calls += 1; throw new Error("external"); } },
    reserve: async () => events.push("reserved"),
    complete: async (category) => events.push(category),
  });
  await assert.rejects(() => client.create({}), /external/);
  assert.equal(calls, 1);
  assert.deepEqual(events, ["reserved", "provider_failure"]);
});

test("ledger completion failure cannot be mislabeled as a provider failure", async () => {
  const events = [];
  const client = createLedgeredSingleAttemptClient({
    client: { async create() { return { output_text: "{}" }; } },
    reserve: async () => events.push("reserved"),
    complete: async (category) => { events.push(category); throw new Error("ledger sink"); },
  });
  await assert.rejects(() => client.create({}), /ledger sink/);
  assert.deepEqual(events, ["reserved", "provider_success"]);
  assert.equal(client.attemptedProviderCalls, 1);
});

test("private artifacts are atomically published with owner-only permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "manus-tuning-"));
  const path = join(directory, "candidate.txt");
  await atomicPrivateWrite(path, "private");
  assert.equal(await readFile(path, "utf8"), "private");
  assert.equal((await stat(path)).mode & 0o077, 0);
  await rm(directory, { recursive: true });
});

test("diagnostic logger retains only category-safe adapter fields", () => {
  const diagnostics = createSafeDiagnosticsLogger();
  diagnostics.logger.warn({
    event: "formatting_segment_request_failed",
    projectId: "private-id",
    modelLabel: "private-model",
    validationCode: "FORMAT_SEGMENT_PLAN_SCHEMA_INVALID",
    failureBoundary: "formatting_plan_validation",
    planValidationStage: "shape",
    parsedOperationCount: 7,
    anyEmojiDirective: true,
    responseByteLength: 999,
    rawResponse: "must-not-leak",
  });
  assert.deepEqual(diagnostics.snapshot(), {
    failureBoundary: "formatting_plan_validation",
    validationCode: "FORMAT_SEGMENT_PLAN_SCHEMA_INVALID",
    planValidationStage: "shape",
    parsedOperationCount: 7,
    anyEmojiDirective: true,
    responseByteLengthBucket: "256_1023",
  });
  assert.doesNotMatch(JSON.stringify(diagnostics.snapshot()), /private|raw|model/i);
});
