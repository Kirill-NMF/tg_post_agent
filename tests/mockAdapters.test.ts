import { describe, expect, it } from "vitest";
import { MockModelAdapters } from "../src/adapters/mockModelAdapters.js";

describe("MockModelAdapters", () => {
  it("returns exactly one/two/three plan options", async () => {
    const adapters = new MockModelAdapters();
    const result = await adapters.planSplit({ projectId: "p1", transcript: "source", planningHistory: [] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.options.map((option) => option.postCount)).toEqual([1, 2, 3]);
    expect(result.value.options.map((option) => option.optionId)).toEqual(["one_post", "two_posts", "three_posts"]);
  });

  it("routes wording formatting edits back to draft", async () => {
    const adapters = new MockModelAdapters();
    const result = await adapters.reviseFormatting({
      projectId: "p1",
      draftText: "draft",
      formattedText: "draft",
      latestUserEdit: "change wording",
      formattingOption: "option_1"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.action).toBe("route_to_draft");
  });

  it("uses a readable Option 2 marker that does not look like encoding corruption", async () => {
    const adapters = new MockModelAdapters();
    const result = await adapters.formatPost({
      projectId: "p1",
      draftText: "draft",
      formattingOption: "option_2"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.formattedText).toMatch(/^✨ draft/);
    expect(result.value.formattedText).not.toMatch(/\?{2,}|�|Р |Гђ|Г‘/);
  });
});
