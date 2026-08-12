import { describe, expect, it } from "vitest";
import { GeminiPlanningAdapter, type GeminiPlanningClient } from "../src/adapters/geminiPlanningAdapter.js";
import type { Logger, LogFields } from "../src/observability/logger.js";

describe("GeminiPlanningAdapter", () => {
  it("maps valid structured JSON to exactly three plan options", async () => {
    const adapter = new GeminiPlanningAdapter({ client: fakeClient(validOutput()), model: "gemini-2.5-pro" });

    const result = await adapter.planSplit({ projectId: "project-1", transcript: "source transcript", planningHistory: [] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta).toMatchObject({ provider: "gemini", modelLabel: "gemini-2.5-pro" });
    expect(result.value.options.map((option) => option.optionId)).toEqual(["one_post", "two_posts", "three_posts"]);
    expect(result.value.options.map((option) => option.postCount)).toEqual([1, 2, 3]);
    expect(result.value.options[1]?.posts).toHaveLength(2);
  });

  it("rejects malformed JSON", async () => {
    const adapter = new GeminiPlanningAdapter({ client: fakeClient("{not json"), model: "gemini-2.5-pro" });

    const result = await adapter.planSplit({ projectId: "project-1", transcript: "source transcript", planningHistory: [] });

    expect(result).toMatchObject({ ok: false, error: { code: "GEMINI_PLAN_OUTPUT_INVALID", retryable: false } });
  });

  it("rejects missing or duplicate option ids", async () => {
    const duplicated = validPlan();
    duplicated.options[1] = { ...duplicated.options[1], option_id: "one_post", post_count: 1, posts: [duplicated.options[1].posts[0]] };
    const adapter = new GeminiPlanningAdapter({ client: fakeClient(JSON.stringify(duplicated)), model: "gemini-2.5-pro" });

    const result = await adapter.planSplit({ projectId: "project-1", transcript: "source transcript", planningHistory: [] });

    expect(result).toMatchObject({ ok: false, error: { retryable: false } });
  });

  it("rejects wrong post_count and post slice count", async () => {
    const invalid = validPlan();
    invalid.options[2] = { ...invalid.options[2], post_count: 3, posts: invalid.options[2].posts.slice(0, 2) };
    const adapter = new GeminiPlanningAdapter({ client: fakeClient(JSON.stringify(invalid)), model: "gemini-2.5-pro" });

    const result = await adapter.planSplit({ projectId: "project-1", transcript: "source transcript", planningHistory: [] });

    expect(result).toMatchObject({ ok: false, error: { retryable: false } });
  });

  it("does not log transcript, prompt, or raw model output", async () => {
    const logger = new CapturingLogger();
    const adapter = new GeminiPlanningAdapter({ client: fakeClient(validOutput("LEAKY MODEL TITLE")), model: "gemini-2.5-pro", logger });

    await adapter.planSplit({ projectId: "project-1", transcript: "SECRET TRANSCRIPT", planningHistory: ["SECRET HISTORY"] });

    const logs = JSON.stringify(logger.entries);
    expect(logs).not.toContain("SECRET TRANSCRIPT");
    expect(logs).not.toContain("SECRET HISTORY");
    expect(logs).not.toContain("LEAKY MODEL TITLE");
  });
});

function fakeClient(output: string): GeminiPlanningClient {
  return {
    async create() {
      return { output_text: output };
    }
  };
}

function validOutput(title = "Один пост"): string {
  const plan = validPlan();
  plan.options[0].title = title;
  return JSON.stringify(plan);
}

function validPlan() {
  return {
    options: [
      {
        option_id: "one_post",
        post_count: 1,
        title: "Один пост",
        angle: "Главная идея",
        summary: "Один связный пост по всему материалу",
        posts: [slice(1)]
      },
      {
        option_id: "two_posts",
        post_count: 2,
        title: "Два поста",
        angle: "Проблема и решение",
        summary: "Материал делится на две части",
        posts: [slice(1), slice(2)]
      },
      {
        option_id: "three_posts",
        post_count: 3,
        title: "Три поста",
        angle: "Серия",
        summary: "Материал делится на три части",
        posts: [slice(1), slice(2), slice(3)]
      }
    ]
  };
}

function slice(index: 1 | 2 | 3) {
  return {
    index,
    topic: `Тема ${index}`,
    angle: `Угол ${index}`,
    includes: [`Пункт ${index}`],
    excludes: [`Не включать ${index}`]
  };
}

class CapturingLogger implements Logger {
  readonly entries: Array<{ level: string; fields: LogFields; message: string }> = [];

  info(fields: LogFields, message: string): void {
    this.entries.push({ level: "info", fields, message });
  }

  warn(fields: LogFields, message: string): void {
    this.entries.push({ level: "warn", fields, message });
  }

  error(fields: LogFields, message: string): void {
    this.entries.push({ level: "error", fields, message });
  }
}
