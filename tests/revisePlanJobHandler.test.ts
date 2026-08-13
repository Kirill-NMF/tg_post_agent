import { describe, expect, it } from "vitest";
import type { Job } from "../src/domain/jobTypes.js";
import type { ModelAdapters } from "../src/domain/modelContracts.js";
import type { PlanOption, Project } from "../src/domain/types.js";
import { InMemoryJobRepository } from "../src/repositories/inMemoryJobRepository.js";
import { InMemoryProjectRepository } from "../src/repositories/inMemoryProjectRepository.js";
import { JobWorker } from "../src/services/jobWorker.js";
import { createRevisePlanJobHandler } from "../src/services/revisePlanJobHandler.js";
import type { TelegramNotifier } from "../src/telegram/telegramNotifier.js";

describe("REVISE_PLAN job handler", () => {
  it("keeps the current plan and notifies the active chat after a permanent provider error", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const notifier = new CapturingNotifier();
    const project = await seedProject(projects);
    const job = await jobs.enqueue({
      type: "REVISE_PLAN",
      projectId: project.id,
      payload: { latestUserEdit: "Make it shorter" }
    });
    const worker = new JobWorker(jobs, {
      REVISE_PLAN: createRevisePlanJobHandler({ projects, planning: permanentlyFailingPlanner(), notifier })
    });

    await worker.processOne({ workerId: "worker-1" });

    const saved = await projects.findById(project.id);
    const storedJob = await jobs.findById(job.id);
    expect(saved?.state).toBe("planning");
    expect(saved?.selectedPlan?.title).toBe("Current plan");
    expect(storedJob).toMatchObject({ status: "failed", errorCode: "GEMINI_PLAN_OUTPUT_INVALID" });
    expect(notifier.messages).toHaveLength(1);
    expect(notifier.messages[0]).toContain("\u0418\u0441\u0445\u043e\u0434\u043d\u044b\u0439 \u043f\u043b\u0430\u043d");
    expect(notifier.messages[0]).not.toContain("Stored source transcript");
    expect(notifier.messages[0]).not.toContain("HTTP_400");
  });

  it("turns an exhausted retryable provider timeout into one safe terminal recovery", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const notifier = new CapturingNotifier();
    const project = await seedProject(projects);
    const job = await jobs.enqueue({
      type: "REVISE_PLAN",
      projectId: project.id,
      payload: { latestUserEdit: "Make it shorter" },
      maxAttempts: 1
    });
    const worker = new JobWorker(jobs, {
      REVISE_PLAN: createRevisePlanJobHandler({ projects, planning: retryablyFailingPlanner(), notifier })
    });

    await worker.processOne({ workerId: "worker-1" });

    const saved = await projects.findById(project.id);
    const storedJob = await jobs.findById(job.id);
    expect(saved?.selectedPlan?.title).toBe("Current plan");
    expect(storedJob).toMatchObject({ status: "failed", errorCode: "PROVIDER_TIMEOUT" });
    expect(notifier.messages).toHaveLength(1);
    expect(notifier.messages[0]).toContain("Исходный план");
    expect(notifier.messages[0]).not.toContain("Stored source transcript");
  });
});

async function seedProject(projects: InMemoryProjectRepository): Promise<Project> {
  const selectedPlan = plan();
  const project: Project = {
    id: "project-1",
    telegramUserId: "100",
    chatId: "200",
    state: "planning",
    isActive: true,
    transcript: "Stored source transcript",
    planOptions: [selectedPlan],
    selectedPlan,
    posts: [],
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };
  await projects.save(project);
  return project;
}

function permanentlyFailingPlanner(): Pick<ModelAdapters, "revisePlan"> {
  return {
    async revisePlan() {
      return {
        ok: false,
        error: {
          code: "GEMINI_PLAN_OUTPUT_INVALID",
          message: "Provider request failed: HTTP_400.",
          retryable: false
        }
      };
    }
  };
}

function retryablyFailingPlanner(): Pick<ModelAdapters, "revisePlan"> {
  return {
    async revisePlan() {
      return { ok: false, error: { code: "PROVIDER_TIMEOUT", message: "Provider request timed out.", retryable: true } };
    }
  };
}

function plan(): PlanOption {
  return {
    optionId: "one_post",
    postCount: 1,
    title: "Current plan",
    angle: "Angle",
    summary: "Summary",
    posts: [{ index: 1, topic: "Topic", angle: "Angle", includes: ["Point"] }]
  };
}

class CapturingNotifier implements TelegramNotifier {
  readonly messages: string[] = [];

  async sendMessage(_chatId: string, text: string): Promise<void> {
    this.messages.push(text);
  }
}
