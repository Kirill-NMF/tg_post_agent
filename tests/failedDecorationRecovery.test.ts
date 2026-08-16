import { describe, expect, it } from "vitest";
import type { Job } from "../src/domain/jobTypes.js";
import type { Project } from "../src/domain/types.js";
import { failedDecorationRecoveryGuard, invalidateFailedDecoration } from "../src/domain/failedDecorationRecovery.js";
import { InMemoryProjectRepository } from "../src/repositories/inMemoryProjectRepository.js";
import { MockModelAdapters } from "../src/adapters/mockModelAdapters.js";
import { ProjectService } from "../src/services/projectService.js";

const marker = "tier2-correction-canary-v1";

function projectFixture(): Project {
  return {
    id: "project", telegramUserId: "7", chatId: "7", state: "formatted_editing", isActive: true,
    transcript: "private transcript",
    selectedPlan: { optionId: "one", postCount: 1, title: "fixture", angle: "fixture", summary: "fixture", posts: [{ index: 1, topic: "fixture", angle: "fixture", includes: ["fixture"] }] },
    rewriteMode: "clean_up", currentPostIndex: 1,
    posts: [{ id: "post", index: 1, planSlice: { index: 1, topic: "fixture", angle: "fixture", includes: ["fixture"] }, currentDraft: "Canonical draft", draftVersion: 4, formattedText: "*Canonical draft*", formattingOption: "option_2" }],
    messages: [
      { kind: "command", text: marker, createdAt: new Date("2026-01-01T00:00:00Z") },
      { kind: "formatted_text", text: "*Canonical draft*", createdAt: new Date("2026-01-01T00:01:00Z") }
    ],
    createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:01:00Z")
  };
}

function succeededFormatJob(projectId = "project", postId = "post"): Job {
  const now = new Date("2026-01-01T00:01:00Z");
  return { id: "format-job", type: "FORMAT_POST", status: "succeeded", projectId, postId, payload: { postIndex: 1, formattingOption: "option_2" }, attempts: 1, maxAttempts: 1, runAfter: now, createdAt: now, updatedAt: now };
}

describe("failed decoration recovery", () => {
  it("accepts only the exact authorized marker scope with zero permitted emoji", () => {
    expect(failedDecorationRecoveryGuard({ project: projectFixture(), accountId: "7", recipientId: "7", marker, expectedProjectId: "project", expectedPostId: "post", expectedDraftVersion: 4, latestFormatJob: succeededFormatJob(), expectedFormatJobId: "format-job", activeJobCount: 0 })).toBeNull();
  });

  it("refuses wrong scope, active jobs, failed jobs, and an existing ordinary emoji", () => {
    const base = { project: projectFixture(), accountId: "7", recipientId: "7", marker, expectedProjectId: "project", expectedPostId: "post", expectedDraftVersion: 4, latestFormatJob: succeededFormatJob(), expectedFormatJobId: "format-job", activeJobCount: 0 };
    expect(failedDecorationRecoveryGuard({ ...base, accountId: "8" })).toBe("RECOVERY_SCOPE_INVALID");
    expect(failedDecorationRecoveryGuard({ ...base, activeJobCount: 1 })).toBe("RECOVERY_ACTIVE_JOB");
    expect(failedDecorationRecoveryGuard({ ...base, latestFormatJob: { ...base.latestFormatJob, status: "failed" } })).toBe("RECOVERY_FORMAT_JOB_INVALID");
    expect(failedDecorationRecoveryGuard({ ...base, expectedFormatJobId: "other" })).toBe("RECOVERY_FORMAT_JOB_INVALID");
    const punctuation = projectFixture(); punctuation.posts[0].formattedText = "\u2014 Canonical draft";
    expect(failedDecorationRecoveryGuard({ ...base, project: punctuation })).toBeNull();
    const decorated = projectFixture(); decorated.posts[0].formattedText = "Canonical draft \u{1F600}";
    expect(failedDecorationRecoveryGuard({ ...base, project: decorated })).toBe("RECOVERY_EMOJI_ALREADY_PRESENT");
  });

  it("invalidates only the stale current representation and preserves canonical inputs and history", () => {
    const project = projectFixture();
    const unrelated = { id: "post-2", index: 2 as const, planSlice: { index: 2 as const, topic: "other", angle: "other", includes: ["other"] }, currentDraft: "Other draft", formattedText: "Other formatted", finalText: "Other final", draftVersion: 2 };
    project.posts.push(unrelated);
    const transcript = project.transcript;
    const selectedPlan = structuredClone(project.selectedPlan);
    const messages = structuredClone(project.messages);
    invalidateFailedDecoration(project, "post", 4);
    expect(project.state).toBe("draft_editing");
    expect(project.posts[0]).toMatchObject({ currentDraft: "Canonical draft", draftVersion: 4 });
    expect(project.posts[0].formattedText).toBeUndefined();
    expect(project.posts[0].finalText).toBeUndefined();
    expect(project.posts[0].formattingOption).toBeUndefined();
    expect(project.transcript).toBe(transcript);
    expect(project.selectedPlan).toEqual(selectedPlan);
    expect(project.messages).toEqual(messages);
    expect(project.posts[1]).toEqual(unrelated);
  });

  it("fails before mutation for a stale draft version", () => {
    const project = projectFixture();
    expect(() => invalidateFailedDecoration(project, "post", 3)).toThrow("RECOVERY_DRAFT_VERSION_STALE");
    expect(project.state).toBe("formatted_editing");
    expect(project.posts[0].formattedText).toBe("*Canonical draft*");
  });

  it("finalizes the recovered current version to exactly one txt artifact", async () => {
    const projects = new InMemoryProjectRepository();
    const project = projectFixture();
    invalidateFailedDecoration(project, "post", 4);
    project.state = "formatted_editing";
    project.posts[0].formattedText = "\u{1F600} Canonical draft";
    project.posts[0].formattingOption = "option_2";
    await projects.save(project);
    const service = new ProjectService(projects, new MockModelAdapters(), undefined, undefined, true);
    const first = await service.finalizeCurrentPost("7");
    const second = await service.finalizeCurrentPost("7");
    expect(first).toEqual([{ kind: "document", filename: "post-1.txt", content: "\u{1F600} Canonical draft", caption: expect.any(String) }]);
    expect(second).not.toContainEqual(expect.objectContaining({ kind: "document" }));
  });

  it("does not mutate when persistence fails before transaction commit", async () => {
    const stored = projectFixture(); const snapshot = structuredClone(stored);
    await expect((async () => { const working = structuredClone(stored); invalidateFailedDecoration(working, "post", 4); throw new Error("persist_failed"); })()).rejects.toThrow("persist_failed");
    expect(stored).toEqual(snapshot);
  });
});
