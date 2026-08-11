import { describe, expect, it } from "vitest";
import type { ModelAdapters } from "../src/domain/modelContracts.js";
import type { PlanOption } from "../src/domain/types.js";
import { InMemoryJobRepository } from "../src/repositories/inMemoryJobRepository.js";
import { InMemoryProjectRepository } from "../src/repositories/inMemoryProjectRepository.js";
import { JobWorker } from "../src/services/jobWorker.js";
import { createPlanSplitJobHandler } from "../src/services/planSplitJobHandler.js";
import type { TelegramNotifier, TelegramSendMessageOptions } from "../src/telegram/telegramNotifier.js";

describe("PLAN_SPLIT job handler", () => {
  it("persists plan options and sends selection buttons without leaking transcript", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const notifier = new CapturingNotifier();
    const project = await seedProject(projects, "REAL TRANSCRIPT");
    await jobs.enqueue({ type: "PLAN_SPLIT", projectId: project.id, payload: {} });
    const worker = new JobWorker(jobs, {
      PLAN_SPLIT: createPlanSplitJobHandler({ projects, planning: fakePlanningAdapter(planOptions()), notifier })
    });

    const processed = await worker.processOne({ workerId: "worker-1" });

    expect(processed).toMatchObject({ processed: true, status: "succeeded" });
    const updated = await projects.findById(project.id);
    expect(updated?.state).toBe("planning");
    expect(updated?.planOptions?.map((option) => option.optionId)).toEqual(["one_post", "two_posts", "three_posts"]);
    expect(updated?.messages.at(-1)?.kind).toBe("plan_options");
    expect(notifier.messages).toHaveLength(1);
    expect(notifier.messages[0]?.text).not.toContain("REAL TRANSCRIPT");
    expect(notifier.messages[0]?.options?.reply_markup?.inline_keyboard.flat().map((button) => button.callback_data)).toEqual([
      "plan:one_post",
      "plan:two_posts",
      "plan:three_posts"
    ]);
  });

  it("preserves plan and state when notification fails after persistence", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const notifier = new CapturingNotifier(new Error("telegram failed"));
    const project = await seedProject(projects, "REAL TRANSCRIPT");
    const job = await jobs.enqueue({ type: "PLAN_SPLIT", projectId: project.id, payload: {} });
    const worker = new JobWorker(jobs, {
      PLAN_SPLIT: createPlanSplitJobHandler({ projects, planning: fakePlanningAdapter(planOptions()), notifier })
    });

    await worker.processOne({ workerId: "worker-1" });

    const updated = await projects.findById(project.id);
    const storedJob = await jobs.findById(job.id);
    expect(updated?.state).toBe("planning");
    expect(updated?.planOptions).toHaveLength(3);
    expect(storedJob?.status).toBe("succeeded");
    expect(storedJob?.result?.notificationStatus).toBe("failed");
  });

  it("fails safely when project is inactive or transcript is missing", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const project = await seedProject(projects);
    const job = await jobs.enqueue({ type: "PLAN_SPLIT", projectId: project.id, payload: {} });
    const worker = new JobWorker(jobs, {
      PLAN_SPLIT: createPlanSplitJobHandler({ projects, planning: fakePlanningAdapter(planOptions()) })
    });

    const processed = await worker.processOne({ workerId: "worker-1" });
    const storedJob = await jobs.findById(job.id);

    expect(processed).toMatchObject({ processed: true, status: "failed" });
    expect(storedJob?.errorCode).toBe("PLAN_TRANSCRIPT_MISSING");

    const inactiveProjects = new InMemoryProjectRepository();
    const inactiveJobs = new InMemoryJobRepository();
    const inactiveProject = await seedProject(inactiveProjects, "REAL TRANSCRIPT", false);
    const inactiveJob = await inactiveJobs.enqueue({ type: "PLAN_SPLIT", projectId: inactiveProject.id, payload: {} });
    const inactiveWorker = new JobWorker(inactiveJobs, {
      PLAN_SPLIT: createPlanSplitJobHandler({ projects: inactiveProjects, planning: fakePlanningAdapter(planOptions()) })
    });

    await inactiveWorker.processOne({ workerId: "worker-1" });
    expect((await inactiveJobs.findById(inactiveJob.id))?.errorCode).toBe("PROJECT_NOT_ACTIVE");
  });
});

async function seedProject(projects: InMemoryProjectRepository, transcript?: string, isActive = true) {
  const project = {
    id: "project-1",
    telegramUserId: "100",
    chatId: "200",
    state: "planning" as const,
    isActive,
    transcript,
    posts: [],
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };
  await projects.save(project);
  return project;
}

function fakePlanningAdapter(options: PlanOption[]): Pick<ModelAdapters, "planSplit"> {
  return {
    async planSplit() {
      return { ok: true, value: { options }, meta: { provider: "gemini", modelLabel: "gemini-2.5-pro" } };
    }
  };
}

function planOptions(): PlanOption[] {
  return [
    option("one_post", 1),
    option("two_posts", 2),
    option("three_posts", 3)
  ];
}

function option(optionId: "one_post" | "two_posts" | "three_posts", postCount: 1 | 2 | 3): PlanOption {
  return {
    optionId,
    postCount,
    title: `${postCount} пост`,
    angle: "Угол",
    summary: "Сводка",
    posts: Array.from({ length: postCount }, (_, index) => ({
      index: (index + 1) as 1 | 2 | 3,
      topic: `Тема ${index + 1}`,
      angle: `Угол ${index + 1}`,
      includes: [`Пункт ${index + 1}`]
    }))
  };
}

class CapturingNotifier implements TelegramNotifier {
  readonly messages: Array<{ chatId: string; text: string; options?: TelegramSendMessageOptions }> = [];

  constructor(private readonly error?: Error) {}

  async sendMessage(chatId: string, text: string, options?: TelegramSendMessageOptions): Promise<void> {
    this.messages.push({ chatId, text, options });
    if (this.error) throw this.error;
  }
}
