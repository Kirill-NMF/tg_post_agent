import assert from "node:assert/strict";
import test from "node:test";
import { buildRewriteFixture, cleanupTargetMatches, syntheticFixtureTranscript, draftEnqueueGuard, heldDraftEnqueue } from "./correction_fixture.mjs";

test("builds a marker-scoped rewrite-mode project with source isolation", () => {
  const fixture = buildRewriteFixture({ accountId: "7", transcript: "PRIVATE_SOURCE", marker: "marker", now: new Date("2026-01-01") });
  assert.equal(fixture.state, "rewrite_mode");
  assert.equal(fixture.chatId, "7");
  assert.equal(fixture.telegramUserId, "7");
  assert.ok(fixture.selectedPlan);
  assert.equal(fixture.posts.length, 1);
  assert.equal(fixture.rewriteMode, "clean_up");
  assert.equal(fixture.messages.at(-1)?.text, "marker");
  assert.equal(JSON.stringify({ state: fixture.state, hasPlan: Boolean(fixture.selectedPlan) }).includes("PRIVATE_SOURCE"), false);
});

test("fails closed for an invalid account or transcript", () => {
  assert.throws(() => buildRewriteFixture({ accountId: "bad", transcript: "x", marker: "marker", now: new Date() }));
  assert.throws(() => buildRewriteFixture({ accountId: "7", transcript: "", marker: "marker", now: new Date() }));
});

test("cleanup targets only the exact account, marker, and fixture id", () => {
  assert.equal(cleanupTargetMatches({ projectId: "p", marker: "m", accountId: "7" }, { projectId: "p", marker: "m", accountId: "7" }), true);
  assert.equal(cleanupTargetMatches({ projectId: "p", marker: "m", accountId: "7" }, { projectId: "other", marker: "m", accountId: "7" }), false);
});

test("synthetic transcript is explicit test-only and creates a valid rewrite fixture", () => {
  const previous = process.env.TG_POST_AGENT_SYNTHETIC_FIXTURE;
  delete process.env.TG_POST_AGENT_SYNTHETIC_FIXTURE;
  assert.throws(() => syntheticFixtureTranscript());
  process.env.TG_POST_AGENT_SYNTHETIC_FIXTURE = "true";
  const fixture = buildRewriteFixture({ accountId: "7", transcript: syntheticFixtureTranscript(), marker: "marker", now: new Date() });
  assert.equal(fixture.state, "rewrite_mode"); assert.ok(fixture.transcript.includes("\n\n")); assert.ok(fixture.selectedPlan);
  if (previous === undefined) delete process.env.TG_POST_AGENT_SYNTHETIC_FIXTURE; else process.env.TG_POST_AGENT_SYNTHETIC_FIXTURE = previous;
});

test("draft enqueue refuses non-marker, wrong-state, and duplicate fixtures", () => {
  const fixture = buildRewriteFixture({ accountId: "7", transcript: "x", marker: "tier2-correction-canary-v1", now: new Date() });
  assert.equal(draftEnqueueGuard({ fixture, accountId: "7", activeDraftJobCount: 0 }), null);
  assert.equal(draftEnqueueGuard({ fixture, accountId: "8", activeDraftJobCount: 0 }), "fixture_invalid");
  assert.equal(draftEnqueueGuard({ fixture: { ...fixture, state: "planning" }, accountId: "7", activeDraftJobCount: 0 }), "fixture_invalid");
  assert.equal(draftEnqueueGuard({ fixture, accountId: "7", activeDraftJobCount: 1 }), "draft_job_already_active");
});

test("held draft enqueue is future-due and one-attempt", () => {
  const now = new Date("2026-01-01T00:00:00Z"), hold = heldDraftEnqueue(now);
  assert.equal(hold.maxAttempts, 1); assert.equal(hold.runAfter.getTime() - now.getTime(), 900000);
});
