import { describe, expect, it } from "vitest";
import { GeminiPlanningAdapter, type GeminiPlanningClient } from "../src/adapters/geminiPlanningAdapter.js";
import type { Logger, LogFields } from "../src/observability/logger.js";

describe("GeminiPlanningAdapter", () => {
  it("accepts one coherent thesis as the only recommended plan", async () => {
    const adapter = new GeminiPlanningAdapter({ client: fakeClient(singleOutput()), model: "gemini-2.5-pro" });
    const result = await adapter.planSplit({ projectId: "project-1", transcript: "source transcript", planningHistory: [] });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.value.options).toHaveLength(1);
    expect(result.value.recommendation).toMatchObject({ recommendedOptionId: "recommended", confidence: "high" });
    expect(result.value.options[0]).toMatchObject({ postCount: 1, optionId: "recommended" });
  });
  it("accepts a meaningful series with alternatives", async () => {
    const adapter = new GeminiPlanningAdapter({ client: fakeClient(seriesOutput()), model: "gemini-2.5-pro" });
    const result = await adapter.planSplit({ projectId: "project-1", transcript: "three independent theses", planningHistory: [] });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.value.options.map((item) => item.postCount)).toEqual([3, 1, 2]);
    expect(result.value.recommendation.recommendedOptionId).toBe("recommended");
  });
  it("rejects malformed JSON", async () => {
    const adapter = new GeminiPlanningAdapter({ client: fakeClient("{not json"), model: "gemini-2.5-pro" });
    await expect(adapter.planSplit({ projectId: "project-1", transcript: "source transcript", planningHistory: [] })).resolves.toMatchObject({ ok: false, error: { code: "GEMINI_PLAN_OUTPUT_INVALID", retryable: false } });
  });
  it("rejects invented duplicate alternatives and wrong post slice count", async () => {
    const duplicate = JSON.parse(seriesOutput()); duplicate.alternatives[0].post_count = 3; duplicate.alternatives[0].posts = [slice(1), slice(2), slice(3)];
    const duplicateResult = await new GeminiPlanningAdapter({ client: fakeClient(JSON.stringify(duplicate)), model: "gemini-2.5-pro" }).planSplit({ projectId: "project-1", transcript: "source transcript", planningHistory: [] });
    expect(duplicateResult).toMatchObject({ ok: false, error: { retryable: false } });
    const wrong = JSON.parse(singleOutput()); wrong.recommended.posts = [slice(1), slice(2)];
    const wrongResult = await new GeminiPlanningAdapter({ client: fakeClient(JSON.stringify(wrong)), model: "gemini-2.5-pro" }).planSplit({ projectId: "project-1", transcript: "source transcript", planningHistory: [] });
    expect(wrongResult).toMatchObject({ ok: false, error: { retryable: false } });
  });
  it("does not log transcript, prompt, user correction, or raw model output", async () => {
    const logger = new CapturingLogger(); const adapter = new GeminiPlanningAdapter({ client: fakeClient(singleOutput("LEAKY MODEL TITLE")), model: "gemini-2.5-pro", logger });
    await adapter.planSplit({ projectId: "project-1", transcript: "SECRET TRANSCRIPT", planningHistory: ["SECRET HISTORY"] });
    const logs = JSON.stringify(logger.entries);
    expect(logs).not.toContain("SECRET TRANSCRIPT"); expect(logs).not.toContain("SECRET HISTORY"); expect(logs).not.toContain("LEAKY MODEL TITLE");
  });
});
function fakeClient(output: string): GeminiPlanningClient { return { async create() { return { output_text: output }; } }; }
function singleOutput(title = "Один пост"): string { return JSON.stringify({ recommended: plan(1, title), rationale: "Одна завершённая мысль.", confidence: "high", alternatives: [] }); }
function seriesOutput(): string { return JSON.stringify({ recommended: plan(3, "Три самостоятельных тезиса"), rationale: "Каждый тезис даёт самостоятельную пользу.", confidence: "medium", alternatives: [plan(1, "Один обзор"), plan(2, "Две связанные части")] }); }
function plan(count: 1|2|3,title:string){return{post_count:count,title,angle:"Угол",summary:"Краткая понятная польза.",posts:Array.from({length:count},(_,i)=>slice((i+1) as 1|2|3))};}
function slice(index:1|2|3){return{index,topic:"Тема "+index,angle:"Угол "+index,includes:["Пункт "+index],excludes:["Не включать "+index]};}
class CapturingLogger implements Logger { readonly entries:Array<{level:string;fields:LogFields;message:string}>=[]; info(fields:LogFields,message:string){this.entries.push({level:"info",fields,message});} warn(fields:LogFields,message:string){this.entries.push({level:"warn",fields,message});} error(fields:LogFields,message:string){this.entries.push({level:"error",fields,message});} }
