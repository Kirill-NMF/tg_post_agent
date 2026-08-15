import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AudioProcessor } from "../src/audio/ffmpegAudioProcessor.js";
import { TempAudioStorage } from "../src/audio/tempAudioStorage.js";
import type { PreparedAudio, TranscriptionAdapter } from "../src/domain/audioTypes.js";
import type { EnqueueJobInput, Job, JobFailure, JobId, RecoverStaleJobsInput } from "../src/domain/jobTypes.js";
import type { ModelAdapters } from "../src/domain/modelContracts.js";
import type { PlanOption, Project, ProjectId } from "../src/domain/types.js";
import { InMemoryJobRepository } from "../src/repositories/inMemoryJobRepository.js";
import type { JobRepository } from "../src/repositories/jobRepository.js";
import { InMemoryProjectRepository } from "../src/repositories/inMemoryProjectRepository.js";
import { JobWorker } from "../src/services/jobWorker.js";
import { ProjectService } from "../src/services/projectService.js";
import { createRevisePlanJobHandler } from "../src/services/revisePlanJobHandler.js";
import { createTranscribeEditAudioJobHandler } from "../src/services/transcribeEditAudioJobHandler.js";
import type { TelegramFileClientPort } from "../src/telegram/telegramFileClient.js";
import type { TelegramNotifier, TelegramSendMessageOptions } from "../src/telegram/telegramNotifier.js";

const userId = "100";
const chatId = "200";
const sourceTranscript = "Synthetic source notes must stay private.";
const voiceEdit = "Make the plan clearer.";

describe("Stage 2 planning correction workflows", () => {
  it("delivers exactly one revised plan after TRANSCRIBE_EDIT_AUDIO hands off to REVISE_PLAN", async () => {
    const setup = await createWorkflow(successfulPlanner());

    const acknowledgement = await setup.service.handleEditAudio(userId, source());
    expect(acknowledgement[0]).toMatchObject({ kind: "message" });
    expect(await setup.worker.processOne({ workerId: "worker-1" })).toMatchObject({ status: "succeeded" });
    expect(await setup.worker.processOne({ workerId: "worker-1" })).toMatchObject({ status: "succeeded" });

    const project = await setup.projects.findById("project-1");
    expect(setup.jobs.enqueued.map((job) => job.type)).toEqual(["TRANSCRIBE_EDIT_AUDIO", "REVISE_PLAN"]);
    expect(setup.planner.latestEdit).toBe(voiceEdit);
    expect(project).toMatchObject({
      state: "planning",
      planOptions: [{ title: "Revised plan" }]
    });
    expect(project?.messages.map((item) => item.kind)).toEqual(["planning_edit", "plan_options"]);
    expect(await setup.storage.listProjectWorkspaces("project-1")).toEqual([]);
    expect(setup.notifier.messages).toHaveLength(1);
    expect(setup.notifier.messages[0]).toMatchObject({
      chatId,
      options: { reply_markup: { inline_keyboard: [[{ callback_data: "plan:recommended" }]] } }
    });
    expect(setup.notifier.messages[0]?.text).toContain("\u0420\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0443\u044e");
    expect(allDeliveredText(setup.notifier)).not.toContain(sourceTranscript);
    expect(allDeliveredText(setup.notifier)).not.toContain(voiceEdit);
  });

  it("delivers one safe recovery and keeps the original plan when REVISE_PLAN fails permanently", async () => {
    const setup = await createWorkflow(permanentlyFailingPlanner());

    await setup.service.handleEditAudio(userId, source());
    await setup.worker.processOne({ workerId: "worker-1" });
    const revision = await setup.worker.processOne({ workerId: "worker-1" });

    const project = await setup.projects.findById("project-1");
    const revisionJob = setup.jobs.enqueued.find((job) => job.type === "REVISE_PLAN");
    expect(revision).toMatchObject({ status: "failed" });
    expect(await setup.jobs.findById(revisionJob!.id)).toMatchObject({
      status: "failed",
      errorCode: "GEMINI_PLAN_OUTPUT_INVALID"
    });
    expect(project).toMatchObject({ state: "planning", planOptions: [{ title: "Original plan" }] });
    expect(await setup.storage.listProjectWorkspaces("project-1")).toEqual([]);
    expect(setup.notifier.messages).toHaveLength(1);
    expect(setup.notifier.messages[0]?.text).toContain("\u0418\u0441\u0445\u043e\u0434\u043d\u044b\u0439 \u043f\u043b\u0430\u043d");
    expect(allDeliveredText(setup.notifier)).not.toContain(sourceTranscript);
    expect(allDeliveredText(setup.notifier)).not.toContain(voiceEdit);
    expect(allDeliveredText(setup.notifier)).not.toContain("HTTP_400");
  });

  it("sends one retry notice and one terminal recovery when edit-audio retries are exhausted", async () => {
    const setup = await createWorkflow(successfulPlanner(), unavailableTranscription());

    await setup.service.handleEditAudio(userId, source());
    expect(await setup.worker.processOne({ workerId: "worker-1" })).toMatchObject({ status: "retry_scheduled" });

    const editJob = setup.jobs.enqueued[0]!;
    const firstRetry = await setup.jobs.findById(editJob.id);
    expect(firstRetry?.status).toBe("retry_scheduled");
    await setup.worker.processOne({ workerId: "worker-1", now: new Date(firstRetry!.runAfter.getTime() + 1) });

    const secondRetry = await setup.jobs.findById(editJob.id);
    expect(secondRetry?.status).toBe("retry_scheduled");
    await setup.worker.processOne({ workerId: "worker-1", now: new Date(secondRetry!.runAfter.getTime() + 1) });

    const finalJob = await setup.jobs.findById(editJob.id);
    expect(finalJob).toMatchObject({ status: "failed", errorCode: "EDIT_AUDIO_TRANSCRIPTION_FAILED" });
    expect(setup.jobs.enqueued.map((job) => job.type)).toEqual(["TRANSCRIBE_EDIT_AUDIO"]);
    expect(setup.notifier.messages).toHaveLength(2);
    expect(await setup.storage.listProjectWorkspaces("project-1")).toEqual([]);
    expect(setup.notifier.messages[0]?.text).toContain("\u041f\u043e\u0432\u0442\u043e\u0440\u044e");
    expect(setup.notifier.messages[1]?.text).toContain("\u0422\u0435\u043a\u0443\u0449\u0438\u0439 \u043f\u043b\u0430\u043d");
    expect(allDeliveredText(setup.notifier)).not.toContain(sourceTranscript);
  });

  it("delivers a revised plan for a text correction through the production job path", async () => {
    const setup = await createWorkflow(successfulPlanner());

    const response = await setup.service.revisePlan(userId, voiceEdit);
    expect(response[0]).toMatchObject({ kind: "message" });
    expect(setup.jobs.enqueued.map((job) => job.type)).toEqual(["REVISE_PLAN"]);
    expect(await setup.worker.processOne({ workerId: "worker-1" })).toMatchObject({ status: "succeeded" });

    const project = await setup.projects.findById("project-1");
    expect(setup.planner.latestEdit).toBe(voiceEdit);
    expect(project?.planOptions?.[0]?.title).toBe("Revised plan");
    await setup.service.choosePlan(userId, "recommended");
    expect((await setup.projects.findById("project-1"))?.selectedPlan?.title).toBe("Revised plan");
    expect(setup.notifier.messages).toHaveLength(1);
    expect(setup.notifier.messages[0]?.options?.reply_markup?.inline_keyboard[0]?.[0]?.callback_data).toBe("plan:recommended");
  });

  it("delivers a safe recovery for a permanent text-correction failure without changing the plan", async () => {
    const setup = await createWorkflow(permanentlyFailingPlanner());

    await setup.service.revisePlan(userId, voiceEdit);
    expect(await setup.worker.processOne({ workerId: "worker-1" })).toMatchObject({ status: "failed" });

    const project = await setup.projects.findById("project-1");
    expect(project?.planOptions?.[0]?.title).toBe("Original plan");
    expect(project?.state).toBe("planning");
    expect(setup.notifier.messages).toHaveLength(1);
    expect(setup.notifier.messages[0]?.text).toContain("\u0418\u0441\u0445\u043e\u0434\u043d\u044b\u0439 \u043f\u043b\u0430\u043d");
    expect(allDeliveredText(setup.notifier)).not.toContain(sourceTranscript);
    expect(allDeliveredText(setup.notifier)).not.toContain(voiceEdit);
  });
});

async function createWorkflow(planner: PlanningFake, transcription: TranscriptionAdapter = successfulTranscription()) {
  const projects = new InMemoryProjectRepository();
  const jobs = new RecordingJobs();
  const notifier = new CapturingNotifier();
  const storage = new TempAudioStorage({ baseDir: await mkdtemp(join(tmpdir(), "tg-stage2-workflow-")) });
  await projects.save(seedProject());

  const worker = new JobWorker(jobs, {
    TRANSCRIBE_EDIT_AUDIO: createTranscribeEditAudioJobHandler({
      projects,
      jobs,
      telegramFiles: fakeFiles(),
      audioProcessor: fakeProcessor(),
      transcription,
      storage,
      notifier
    }),
    REVISE_PLAN: createRevisePlanJobHandler({ projects, planning: planner, notifier })
  });

  const service = new ProjectService(projects, {} as ModelAdapters, jobs);
  return { projects, jobs, notifier, worker, service, planner, storage };
}

function seedProject(): Project {
  const original = plan("Original plan");
  return {
    id: "project-1",
    telegramUserId: userId,
    chatId,
    state: "planning",
    isActive: true,
    transcript: sourceTranscript,
    planOptions: [original],
    planRecommendation: { recommendedOptionId: "recommended", rationale: "Existing rationale", confidence: "high" },
    posts: [],
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

function source() {
  return { kind: "voice" as const, telegramFileId: "synthetic-edit-audio", durationSeconds: 10, sizeBytes: 10 };
}

function plan(title: string): PlanOption {
  return {
    optionId: "recommended",
    postCount: 1,
    title,
    angle: "Angle",
    summary: "Summary",
    posts: [{ index: 1, topic: "Topic", angle: "Angle", includes: ["Point"] }]
  };
}

type PlanningFake = Pick<ModelAdapters, "revisePlan"> & { latestEdit?: string };

function successfulPlanner(): PlanningFake {
  return {
    async revisePlan(input) {
      this.latestEdit = input.latestUserEdit;
      const revised = plan("Revised plan");
      return {
        ok: true,
        value: {
          options: [revised],
          recommendation: { recommendedOptionId: "recommended", rationale: "Updated rationale", confidence: "high" }
        },
        meta: { provider: "mock", modelLabel: "planning-fake" }
      };
    }
  };
}

function permanentlyFailingPlanner(): PlanningFake {
  return {
    async revisePlan() {
      return {
        ok: false,
        error: { code: "GEMINI_PLAN_OUTPUT_INVALID", message: "Provider request failed: HTTP_400.", retryable: false }
      };
    }
  };
}

function successfulTranscription(): TranscriptionAdapter {
  return {
    async transcribe() {
      return { transcript: voiceEdit, meta: { provider: "openrouter", modelLabel: "transcription-fake", chunkCount: 1 } };
    }
  };
}

function unavailableTranscription(): TranscriptionAdapter {
  return {
    async transcribe() {
      throw new Error("synthetic transient provider failure");
    }
  };
}

function fakeFiles(): TelegramFileClientPort {
  return {
    async downloadFile({ targetPath }) {
      await writeFile(targetPath, "synthetic audio");
      return { fileId: "synthetic-edit-audio", filePath: "synthetic.ogg", sizeBytes: 10 };
    }
  };
}

function fakeProcessor(): AudioProcessor {
  return {
    async prepareForTranscription({ sourcePath }): Promise<PreparedAudio> {
      return { chunks: [{ index: 0, path: sourcePath }], probe: { durationSeconds: 10 }, wasNormalized: false };
    }
  };
}

class CapturingNotifier implements TelegramNotifier {
  readonly messages: Array<{ chatId: string; text: string; options?: TelegramSendMessageOptions }> = [];

  async sendMessage(chatId: string, text: string, options?: TelegramSendMessageOptions): Promise<void> {
    this.messages.push({ chatId, text, options });
  }
}

class RecordingJobs implements JobRepository {
  readonly enqueued: Job[] = [];
  private readonly inner = new InMemoryJobRepository();

  async enqueue(input: EnqueueJobInput): Promise<Job> {
    const job = await this.inner.enqueue(input);
    this.enqueued.push(job);
    return job;
  }

  findById(jobId: JobId): Promise<Job | undefined> {
    return this.inner.findById(jobId);
  }

  claimNextDue(input: { workerId: string; now?: Date }): Promise<Job | undefined> {
    return this.inner.claimNextDue(input);
  }

  claimDueById(input: { jobId: JobId; workerId: string; now?: Date }): Promise<Job | undefined> {
    return this.inner.claimDueById(input);
  }

  markSucceeded(jobId: JobId, result?: Record<string, unknown>): Promise<Job> {
    return this.inner.markSucceeded(jobId, result);
  }

  markFailed(jobId: JobId, failure: JobFailure, now?: Date): Promise<Job> {
    return this.inner.markFailed(jobId, failure, now);
  }

  cancelQueuedForProject(projectId: ProjectId): Promise<number> {
    return this.inner.cancelQueuedForProject(projectId);
  }

  recoverStaleRunning(input: RecoverStaleJobsInput): Promise<number> {
    return this.inner.recoverStaleRunning(input);
  }
}

function allDeliveredText(notifier: CapturingNotifier): string {
  return notifier.messages.map((message) => message.text).join("\n");
}
