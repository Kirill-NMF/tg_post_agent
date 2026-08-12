import { describe, expect, it } from "vitest";
import { MockModelAdapters } from "../src/adapters/mockModelAdapters.js";
import type { PlanOption, Project } from "../src/domain/types.js";
import { InMemoryJobRepository } from "../src/repositories/inMemoryJobRepository.js";
import { InMemoryProjectRepository } from "../src/repositories/inMemoryProjectRepository.js";
import { ProjectService } from "../src/services/projectService.js";

describe("output language project preference", () => {
  it("persists an explicit draft-edit language instruction before queueing the revision", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const service = new ProjectService(projects, new MockModelAdapters(), jobs);
    const project = seedProject();
    await projects.save(project);

    await service.reviseDraft("100", "\u041f\u0438\u0448\u0438 \u043f\u043e\u0441\u0442 \u043f\u043e-\u0430\u043d\u0433\u043b\u0438\u0439\u0441\u043a\u0438.");

    expect((await projects.findById(project.id))?.outputLanguage).toBe("en");
    expect(await jobs.claimNextDue({ workerId: "worker" })).toMatchObject({ type: "REVISE_DRAFT", projectId: project.id });
  });
});

function seedProject(): Project {
  const selectedPlan: PlanOption = { optionId: "recommended", postCount: 1, title: "Plan", angle: "Angle", summary: "Summary", posts: [{ index: 1, topic: "Topic", angle: "Angle", includes: ["Point"] }] };
  return { id: "project-1", telegramUserId: "100", chatId: "200", state: "draft_editing", isActive: true, transcript: "source", selectedPlan, rewriteMode: "make_post", posts: [{ id: "post-1", index: 1, planSlice: selectedPlan.posts[0], currentDraft: "Current draft" }], currentPostIndex: 1, messages: [], createdAt: new Date(), updatedAt: new Date() };
}