import assert from "node:assert/strict";
import test from "node:test";
import { buildRewriteFixture, cleanupTargetMatches, syntheticFixtureTranscript, draftEnqueueGuard, heldDraftEnqueue, rollbackMatches, formatEnqueueGuard, heldFormatEnqueue, formatRollbackMatches, prepareHeldOption2 } from "./correction_fixture.mjs";

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

test("write-state rollback targets only the returned fixture job", () => {
  const fixture={id:"fixture"};
  assert.equal(rollbackMatches({projectId:"fixture",dedupeKey:"fixture:fixture:generate_draft"},fixture),true);
  assert.equal(rollbackMatches({projectId:"other",dedupeKey:"fixture:fixture:generate_draft"},fixture),false);
});

function draftFixture() {
 const fixture=buildRewriteFixture({accountId:"7",transcript:"x",marker:"tier2-correction-canary-v1",now:new Date("2026-01-01")});
 fixture.state="draft_editing"; fixture.posts[0].currentDraft="Canonical draft"; fixture.posts[0].draftVersion=2; return fixture;
}
test("format hold requires the current editable version and produces a future one-attempt option2 job", () => {
 const fixture=draftFixture(), now=new Date("2026-01-01T00:00:00Z");
 assert.equal(formatEnqueueGuard({fixture,accountId:"7",expectedDraftVersion:2,activeFormatJobCount:0}),null);
 assert.equal(formatEnqueueGuard({fixture,accountId:"7",expectedDraftVersion:1,activeFormatJobCount:0}),"draft_version_stale");
 assert.equal(formatEnqueueGuard({fixture,accountId:"7",expectedDraftVersion:2,activeFormatJobCount:1}),"format_job_already_active");
 const hold=heldFormatEnqueue(now); assert.equal(hold.maxAttempts,1); assert.equal(hold.runAfter.getTime()-now.getTime(),900000);
});
test("format rollback scope cannot match an unrelated marker job", () => {
 const fixture=draftFixture();
 assert.equal(formatRollbackMatches({projectId:fixture.id,dedupeKey:"fixture:"+fixture.id+":format:option_2"},fixture),true);
 assert.equal(formatRollbackMatches({projectId:"other",dedupeKey:"fixture:"+fixture.id+":format:option_2"},fixture),false);
 assert.equal(formatRollbackMatches({projectId:fixture.id,dedupeKey:"project:"+fixture.id+":format:option_2"},fixture),false);
});

function fixtureRepositories(fixture) {
 let stored=fixture, created=[];
 return {
  projects:{async findActiveByTelegramUser(user){return user===stored.telegramUserId?stored:undefined;},async findById(id){return id===stored.id?stored:undefined;},async save(value){stored=value;}},
  jobs:{async enqueue(input){const job={id:"exact-format-job",...input};created.push(job);return job;}},
  stored:()=>stored, created
 };
}
test("Option2 preparation uses production transitions and persists a held exact job", async () => {
 const fixture=draftFixture(), repo=fixtureRepositories(fixture), states=[];
 const result=await prepareHeldOption2({projects:repo.projects,jobs:repo.jobs,fixture,accountId:"7",expectedDraftVersion:2,activeFormatJobCount:0,now:new Date("2026-01-01T00:00:00Z"),writePrivateState:async(value)=>states.push(value),cancelExactJob:async()=>assert.fail("unexpected rollback")});
 assert.equal(repo.stored().state,"formatting"); assert.equal(repo.created.length,1); assert.equal(repo.created[0].type,"FORMAT_POST");
 assert.equal(repo.created[0].payload.formattingOption,"option_2"); assert.equal(repo.created[0].maxAttempts,1); assert.equal(repo.created[0].runAfter.getTime()-Date.parse("2026-01-01T00:00:00Z"),900000);
 assert.equal(states[0].formattingOption,"option_2"); assert.equal(states[0].draftVersion,2); assert.equal(result.job.id,"exact-format-job");
});
test("Option2 private-state failure cancels only the exact job and restores editable state", async () => {
 const fixture=draftFixture(), repo=fixtureRepositories(fixture), cancelled=[];
 await assert.rejects(()=>prepareHeldOption2({projects:repo.projects,jobs:repo.jobs,fixture,accountId:"7",expectedDraftVersion:2,activeFormatJobCount:0,writePrivateState:async()=>{throw new Error("state_write_failed");},cancelExactJob:async(job,current)=>cancelled.push([job.id,current.id])}),/state_write_failed/);
 assert.equal(repo.stored().state,"draft_editing"); assert.deepEqual(cancelled,[["exact-format-job",fixture.id]]);
});
