import assert from "node:assert/strict";
import test from "node:test";
import { recoverFailedDecorationScoped } from "./failed_decoration_recovery.mjs";

const marker = "tier2-correction-canary-v1";
function scope() {
  const now = new Date();
  return {
    project: {
      id: "project", telegramUserId: "7", chatId: "7", state: "formatted_editing", isActive: true,
      transcript: "private", selectedPlan: { optionId: "one", postCount: 1, title: "x", angle: "x", summary: "x", posts: [] },
      currentPostIndex: 1,
      posts: [{ id: "post", index: 1, planSlice: { index: 1, topic: "x", angle: "x", includes: [] }, currentDraft: "canonical", formattedText: "*canonical*", formattingOption: "option_2", draftVersion: 2 }],
      messages: [{ kind: "command", text: marker, createdAt: now }, { kind: "formatted_text", text: "*canonical*", createdAt: now }],
      createdAt: now, updatedAt: now,
    },
    latestFormatJob: { id: "job", type: "FORMAT_POST", status: "succeeded", projectId: "project", postId: "post", payload: { postIndex: 1, formattingOption: "option_2" }, attempts: 1, maxAttempts: 1, runAfter: now, createdAt: now, updatedAt: now },
    activeJobCount: 0,
    currentArtifactCount: 0,
  };
}

function input(overrides = {}) {
  const stored = scope();
  const evidence = [];
  return {
    stored, evidence,
    value: {
      accountId: "7", recipientId: "7", marker, expectedProjectId: "project", expectedPostId: "post", expectedFormatJobId: "job", expectedDraftVersion: 2,
      transaction: async (callback) => {
        const working = structuredClone(stored);
        working.save = async (project) => { working.project = structuredClone(project); };
        const result = await callback(working);
        stored.project = working.project;
        return result;
      },
      writeEvidence: async (value) => evidence.push(value),
      removeEvidence: async () => evidence.pop(),
      ...overrides,
    },
  };
}

test("exact zero-emoji marker scope recovers only the current representation", async () => {
  const fixture = input();
  const unrelated = { id: "other", index: 2, planSlice: { index: 2, topic: "x", angle: "x", includes: [] }, currentDraft: "other", formattedText: "other", draftVersion: 1 };
  fixture.stored.project.posts.push(unrelated);
  const transcript = fixture.stored.project.transcript;
  const unrelatedProject = { state: "planning" };
  const unrelatedJobs = [{ status: "queued" }];
  const unrelatedSnapshot = structuredClone({ unrelatedProject, unrelatedJobs });
  const messages = structuredClone(fixture.stored.project.messages);
  const result = await recoverFailedDecorationScoped(fixture.value);
  assert.deepEqual(result, { recovered: true, state: "draft_editing", draftVersionPreserved: true });
  assert.equal(fixture.stored.project.posts[0].currentDraft, "canonical");
  assert.equal(fixture.stored.project.posts[0].draftVersion, 2);
  assert.equal(fixture.stored.project.posts[0].formattedText, undefined);
  assert.deepEqual(fixture.stored.project.posts[1], unrelated);
  assert.equal(fixture.stored.project.transcript, transcript);
  assert.deepEqual(fixture.stored.project.messages, messages);
  assert.equal(fixture.evidence.length, 1);
  assert.deepEqual({ unrelatedProject, unrelatedJobs }, unrelatedSnapshot);
});

test("wrong scope and nonzero emoji refuse before save", async () => {
  const wrong = input({ accountId: "8" });
  await assert.rejects(() => recoverFailedDecorationScoped(wrong.value), /RECOVERY_SCOPE_INVALID/);
  assert.equal(wrong.stored.project.state, "formatted_editing");
  const emoji = input();
  emoji.stored.project.posts[0].formattedText = "canonical \u{1F600}";
  await assert.rejects(() => recoverFailedDecorationScoped(emoji.value), /RECOVERY_EMOJI_ALREADY_PRESENT/);
  assert.equal(emoji.stored.project.state, "formatted_editing");
});

test("private evidence failure rolls the transaction back and preserves unrelated state", async () => {
  const fixture = input({ writeEvidence: async () => { throw new Error("evidence_failed"); } });
  const snapshot = structuredClone(fixture.stored.project);
  await assert.rejects(() => recoverFailedDecorationScoped(fixture.value), /evidence_failed/);
  assert.deepEqual(fixture.stored.project, snapshot);
});

test("active jobs or current artifacts fail closed", async () => {
  const active = input(); active.stored.activeJobCount = 1;
  await assert.rejects(() => recoverFailedDecorationScoped(active.value), /RECOVERY_ACTIVE_JOB/);
  const artifact = input(); artifact.stored.currentArtifactCount = 1;
  await assert.rejects(() => recoverFailedDecorationScoped(artifact.value), /RECOVERY_CURRENT_ARTIFACT_PRESENT/);
});
