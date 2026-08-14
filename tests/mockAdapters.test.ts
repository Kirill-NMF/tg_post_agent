import { describe, expect, it } from "vitest";
import { MockModelAdapters } from "../src/adapters/mockModelAdapters.js";

describe("MockModelAdapters", () => {
  it("recommends one coherent post without invented alternatives", async () => {
    const adapters = new MockModelAdapters();
    const result = await adapters.planSplit({ projectId: "p1", transcript: "source", planningHistory: [] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.options.map((option) => option.postCount)).toEqual([1]);
    expect(result.value.recommendation).toMatchObject({ recommendedOptionId: "recommended", confidence: "high" });
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

  it("returns an anchored Option 2 decoration plan instead of replacement text", async () => {
    const adapters = new MockModelAdapters();
    const result = await adapters.formatPost({
      projectId: "p1",
      draftText: "draft",
      formattingOption: "option_2"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decorationPlan).toMatchObject({
      option: "option_2",
      operations: [{ kind: "emoji_insertion", anchor: { text: "draft", occurrence: 0 }, position: "before" }]
    });
    expect("formattedText" in result.value).toBe(false);
  });

});
