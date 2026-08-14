import { describe, expect, it } from "vitest";
import { MockModelAdapters } from "../src/adapters/mockModelAdapters.js";
import type { PlanOption, Project } from "../src/domain/types.js";
import { InMemoryJobRepository } from "../src/repositories/inMemoryJobRepository.js";
import { InMemoryProjectRepository } from "../src/repositories/inMemoryProjectRepository.js";
import { ProjectService } from "../src/services/projectService.js";

describe("Stage 3 public flow", () => {
  it("opens the two public options and durably queues formatting exactly once", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const service = new ProjectService(projects, new MockModelAdapters(), jobs, undefined, true);
    const project = await seedDraft(projects);

    const choice = await service.openFormatChoice("user-1");
    expect(choice[0]).toMatchObject({
      kind: "message",
      buttons: [
        { label: "Telegram", action: "format:option_1" },
        { label: "Telegram + emoji", action: "format:option_2" }
      ]
    });
    expect((await projects.findById(project.id))?.state).toBe("format_choice");

    await service.formatCurrentPost("user-1", "option_1");
    const queued = await jobs.claimNextDue({ workerId: "worker-1" });
    expect(queued).toMatchObject({ type: "FORMAT_POST", payload: { postIndex: 1, formattingOption: "option_1" } });
    expect((await projects.findById(project.id))?.state).toBe("formatting");

    const stale = await service.formatCurrentPost("user-1", "option_1");
    expect(stale[0]).toMatchObject({ kind: "message" });
    expect(await jobs.claimNextDue({ workerId: "worker-2" })).toBeUndefined();
  });

  it("routes formatted text corrections back through draft revision and invalidates stale completion", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const service = new ProjectService(projects, new MockModelAdapters(), jobs, undefined, true);
    const project = await seedDraft(projects, "formatted_editing");
    project.posts[0].formattedText = "*Canonical draft*";
    project.posts[0].formattingOption = "option_1";
    await projects.save(project);

    const instruction = await service.openFormattedCorrection("user-1");
    expect(instruction[0]).toMatchObject({ kind: "message" });

    await service.reviseFormatting("user-1", "change one sentence");
    const updated = await projects.findById(project.id);
    expect(updated?.state).toBe("draft_generating");
    expect(updated?.posts[0]?.formattedText).toBeUndefined();
    expect((await jobs.claimNextDue({ workerId: "worker-1" }))?.type).toBe("REVISE_DRAFT");

    const staleFinish = await service.finalizeCurrentPost("user-1");
    expect(staleFinish[0]).toMatchObject({ kind: "message" });
  });

  it("routes formatted voice corrections to edit transcription and blocks stale completion", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const service = new ProjectService(projects, new MockModelAdapters(), jobs, undefined, true);
    const project = await seedDraft(projects, "formatted_editing");
    project.posts[0].formattedText = "*Canonical draft*";
    project.posts[0].formattingOption = "option_2";
    await projects.save(project);

    const acknowledgement = await service.handleEditAudio("user-1", { kind: "voice", telegramFileId: "synthetic-edit" });
    expect(acknowledgement[0]).toMatchObject({ kind: "message" });
    expect((await projects.findById(project.id))?.state).toBe("draft_generating");
    expect((await projects.findById(project.id))?.posts[0]?.formattedText).toBeUndefined();
    expect((await jobs.claimNextDue({ workerId: "worker-1" }))?.type).toBe("TRANSCRIBE_EDIT_AUDIO");

    const staleFinish = await service.finalizeCurrentPost("user-1");
    expect(staleFinish[0]).toMatchObject({ kind: "message" });
  });

  it("sends only the text artifact when finalizing a formatted post", async () => {
    const projects = new InMemoryProjectRepository();
    const service = new ProjectService(projects, new MockModelAdapters(), undefined, undefined, true);
    const project = await seedDraft(projects, "formatted_editing");
    project.posts[0].formattedText = "*Canonical draft*";
    await projects.save(project);

    const terminal = await service.finalizeCurrentPost("user-1");
    expect(terminal).toEqual([{ kind: "document", filename: "post-1.txt", content: "*Canonical draft*", caption: expect.any(String) }]);
    expect((await projects.findById(project.id))?.state).toBe("done");

    const staleSecondFinish = await service.finalizeCurrentPost("user-1");
    expect(staleSecondFinish[0]).toMatchObject({ kind: "message" });
    expect(staleSecondFinish).not.toContainEqual(expect.objectContaining({ kind: "document" }));
  });
});

async function seedDraft(repository: InMemoryProjectRepository, state: Project["state"] = "draft_editing"): Promise<Project> {
  const selectedPlan: PlanOption = {
    optionId: "one_post",
    postCount: 1,
    title: "Synthetic",
    angle: "Synthetic",
    summary: "Synthetic",
    posts: [{ index: 1, topic: "Synthetic", angle: "Synthetic", includes: ["Synthetic"] }]
  };
  const project: Project = {
    id: "stage3-project",
    telegramUserId: "user-1",
    chatId: "chat-1",
    state,
    isActive: true,
    transcript: "Synthetic transcript",
    selectedPlan,
    rewriteMode: "make_post",
    currentPostIndex: 1,
    posts: [{ id: "post-1", index: 1, planSlice: selectedPlan.posts[0], currentDraft: "Canonical draft" }],
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };
  await repository.save(project);
  return project;
}
