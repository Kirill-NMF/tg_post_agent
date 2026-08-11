import { describe, expect, it } from "vitest";
import { MockModelAdapters } from "../src/adapters/mockModelAdapters.js";
import { InMemoryProjectRepository } from "../src/repositories/inMemoryProjectRepository.js";
import { ProjectService } from "../src/services/projectService.js";
import type { BotResponse } from "../src/domain/types.js";

function service() {
  const repository = new InMemoryProjectRepository();
  return {
    repository,
    projects: new ProjectService(repository, new MockModelAdapters())
  };
}

describe("ProjectService mock state machine", () => {
  it("runs the main audio-to-final-post path without Telegram network", async () => {
    const { projects } = service();

    expect(message(projects.start("100", "200")[0]).text).toContain("Send a voice");
    const planning = await projects.submitSourceAudio("100", { kind: "voice", telegramFileId: "voice-file-id" });
    expect(message(planning[0]).text).toContain("one_post");
    expect(projects.getActiveProject("100")?.state).toBe("planning");

    const rewrite = await projects.choosePlan("100", "two_posts");
    expect(message(rewrite[0]).buttons?.map((button) => button.action)).toEqual(["rewrite:clean_up", "rewrite:make_post"]);

    const draft = await projects.chooseRewriteMode("100", "make_post");
    expect(message(draft[0]).text).toContain("Mock draft 1");
    expect(projects.getActiveProject("100")?.state).toBe("draft_editing");

    const revised = await projects.reviseDraft("100", "shorten intro");
    expect(message(revised[0]).text).toContain("Applied edit: shorten intro");

    const formatChoice = projects.openFormatChoice("100");
    expect(message(formatChoice[0]).buttons?.map((button) => button.action)).toEqual(["format:option_1", "format:option_2"]);

    const formatted = await projects.formatCurrentPost("100", "option_2");
    expect(message(formatted[0]).text).toContain("Mock draft 1");
    expect(projects.getActiveProject("100")?.state).toBe("formatted_editing");

    const final = projects.finalizeCurrentPost("100");
    expect(final).toHaveLength(2);
    expect(final[1]).toMatchObject({ kind: "document", filename: "post-1.txt" });
    expect(final[0]?.kind === "message" ? final[0].buttons?.[0]?.action : undefined).toBe("series:next");
  });

  it("supports mock next post flow for series", async () => {
    const { projects } = service();

    projects.start("100", "200");
    await projects.submitSourceAudio("100", { kind: "voice", telegramFileId: "voice-file-id" });
    await projects.choosePlan("100", "two_posts");
    await projects.chooseRewriteMode("100", "make_post");
    projects.openFormatChoice("100");
    await projects.formatCurrentPost("100", "option_1");
    projects.finalizeCurrentPost("100");

    const next = await projects.startNextPost("100");
    expect(message(next[0]).text).toContain("Mock draft 2");
    expect(projects.getActiveProject("100")?.currentPostIndex).toBe(2);
    expect(projects.getActiveProject("100")?.state).toBe("draft_editing");
  });

  it("routes voice edits through the current state stub transcription", async () => {
    const { projects } = service();

    projects.start("100", "200");
    await projects.submitSourceAudio("100", { kind: "voice", telegramFileId: "voice-file-id" });
    await projects.choosePlan("100", "one_post");
    await projects.chooseRewriteMode("100", "make_post");

    const edited = await projects.handleEditAudio("100", { kind: "voice", telegramFileId: "edit-file-id" });
    expect(message(edited[0]).text).toContain("Mock voice edit");
  });
});

function message(response: BotResponse | undefined) {
  if (!response || response.kind !== "message") throw new Error("Expected message response.");
  return response;
}
