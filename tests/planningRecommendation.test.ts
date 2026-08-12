import { describe, expect, it } from "vitest";
import { MockModelAdapters } from "../src/adapters/mockModelAdapters.js";
import type { ModelAdapters } from "../src/domain/modelContracts.js";
import type { PlanningResult } from "../src/domain/types.js";
import { InMemoryProjectRepository } from "../src/repositories/inMemoryProjectRepository.js";
import { ProjectService } from "../src/services/projectService.js";
import { planButtons } from "../src/services/planningPresentation.js";

describe("planning recommendation UX", () => {
  it("hides the alternatives control for one coherent thesis", () => {
    expect(planButtons(singlePlan()).map((button) => button.action)).toEqual(["plan:recommended"]);
  });

  it("reveals and selects a meaningful alternative only after the user asks", async () => {
    const repository = new InMemoryProjectRepository();
    const projects = new ProjectService(repository, new SeriesPlanningModels());
    await projects.start("100", "200");
    const initial = await projects.submitSourceAudio("100", { kind: "voice", telegramFileId: "voice" });
    expect(message(initial[0]).text).toContain("Рекомендую: 3 поста");
    expect(message(initial[0]).buttons?.map((button) => button.action)).toEqual(["plan:recommended", "plan:show_alternatives"]);

    const blocked = await projects.choosePlan("100", "alternative_2");
    expect(message(blocked[0]).text).toContain("Сначала откройте");

    const alternatives = await projects.showPlanAlternatives("100");
    expect(message(alternatives[0]).buttons?.map((button) => button.action)).toEqual(["plan:alternative_2", "plan:alternative_3"]);

    const selected = await projects.choosePlan("100", "alternative_2");
    expect(message(selected[0]).text).toContain("режим");
    expect((await projects.getActiveProject("100"))?.selectedPlan?.postCount).toBe(1);
  });

  it("enqueues a production text correction without calling the mock planning adapter", async () => {
    const repository = new InMemoryProjectRepository();
    const { InMemoryJobRepository } = await import("../src/repositories/inMemoryJobRepository.js");
    const jobs = new InMemoryJobRepository();
    const projects = new ProjectService(repository, new SeriesPlanningModels(), jobs);
    await projects.start("100", "200");
    const project = await projects.getActiveProject("100");
    if (!project) throw new Error("Expected active project.");
    const plan = seriesPlan();
    project.state = "planning";
    project.transcript = "Stored transcript";
    project.planOptions = plan.options;
    project.planRecommendation = plan.recommendation;
    await repository.save(project);
    const response = await projects.revisePlan("100", "Оставь один пост.");
    expect(message(response[0]).text).toContain("обновляю рекомендацию");
    expect((await repository.findActiveByTelegramUser("100"))?.messages.at(-1)).toMatchObject({ kind: "planning_edit", text: "Оставь один пост." });
    expect(await jobs.claimNextDue({ workerId: "worker-1" })).toMatchObject({ type: "REVISE_PLAN", payload: { latestUserEdit: "Оставь один пост." } });
  });

  it("regenerates the recommendation contract after a planning correction", async () => {
    const repository = new InMemoryProjectRepository();
    const projects = new ProjectService(repository, new SeriesPlanningModels());
    await projects.start("100", "200");
    await projects.submitSourceAudio("100", { kind: "voice", telegramFileId: "voice" });
    const response = await projects.revisePlan("100", "Оставь один пост, это одна история.");
    const project = await projects.getActiveProject("100");
    expect(message(response[0]).text).toContain("Рекомендую: 1 пост");
    expect(project?.planRecommendation).toMatchObject({ recommendedOptionId: "recommended" });
    expect(project?.planOptions).toHaveLength(1);
    expect(project?.planAlternativesRevealed).toBe(false);
  });
});

class SeriesPlanningModels extends MockModelAdapters {
  override async planSplit(_input: Parameters<ModelAdapters["planSplit"]>[0]) { return ok(seriesPlan()); }
  override async revisePlan(_input: Parameters<ModelAdapters["revisePlan"]>[0]) { return ok({ ...singlePlan(), changeSummary: "Updated." }); }
}

function singlePlan(): PlanningResult {
  return { options: [plan("recommended", 1, "Одна история")], recommendation: { recommendedOptionId: "recommended", rationale: "Одна история с единым выводом.", confidence: "high" } };
}
function seriesPlan(): PlanningResult {
  return { options: [plan("recommended", 3, "Три самостоятельных тезиса"), plan("alternative_2", 1, "Один обзор"), plan("alternative_3", 2, "Две части")], recommendation: { recommendedOptionId: "recommended", rationale: "Каждая часть имеет свой хук и завершённую пользу.", confidence: "medium" } };
}
function plan(optionId:string, postCount:1|2|3,title:string) { return { optionId, postCount, title, angle:"Угол", summary:"Самостоятельная польза.", posts:Array.from({length:postCount},(_,index)=>({index:(index+1) as 1|2|3,topic:"Тема "+(index+1),angle:"Угол",includes:["Польза"]}))}; }
function ok<T>(value:T) { return { ok:true as const, value, meta:{provider:"mock" as const,modelLabel:"test"} }; }
function message(value: Awaited<ReturnType<ProjectService["start"]>>[number] | undefined) { if (!value || value.kind !== "message") throw new Error("Expected message"); return value; }
