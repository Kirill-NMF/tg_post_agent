import assert from "node:assert/strict";
import test from "node:test";
import { buildRewriteFixture, cleanupTargetMatches } from "./correction_fixture.mjs";

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
