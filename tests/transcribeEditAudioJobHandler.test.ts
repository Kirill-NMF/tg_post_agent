import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AudioProcessor } from "../src/audio/ffmpegAudioProcessor.js";
import { TempAudioStorage } from "../src/audio/tempAudioStorage.js";
import type { AudioSourceMetadata, PreparedAudio, TranscriptionAdapter } from "../src/domain/audioTypes.js";
import type { EnqueueJobInput, Job, JobFailure, JobId, RecoverStaleJobsInput } from "../src/domain/jobTypes.js";
import type { PlanOption, Project, ProjectId } from "../src/domain/types.js";
import { InMemoryJobRepository } from "../src/repositories/inMemoryJobRepository.js";
import type { JobRepository } from "../src/repositories/jobRepository.js";
import { InMemoryProjectRepository } from "../src/repositories/inMemoryProjectRepository.js";
import { PermanentJobError } from "../src/services/jobWorker.js";
import { createTranscribeEditAudioJobHandler } from "../src/services/transcribeEditAudioJobHandler.js";
import type { TelegramFileClientPort } from "../src/telegram/telegramFileClient.js";

describe("TRANSCRIBE_EDIT_AUDIO job handler", () => {
  it("persists a planning edit before an immediately claimed plan revision can save", async () => {
    const projects = new InMemoryProjectRepository();
    const project = await seedProject(projects, "planning");
    const jobs = new InspectingJobs(async () => {
      const saved = await projects.findById(project.id);
      expect(saved?.messages.at(-1)).toMatchObject({ kind: "planning_edit", text: "Voice plan correction" });
      const revised = saved!;
      revised.planOptions![0]!.title = "Revised by fast follow-up";
      await projects.save(revised);
    });
    const storage = new TempAudioStorage({ baseDir: await mkdtemp(join(tmpdir(), "tg-edit-audio-")) });

    await createTranscribeEditAudioJobHandler(deps(projects, jobs, storage, fakeTranscription("Voice plan correction")))(
      editJob(project.id, "planning")
    );

    expect((await projects.findById(project.id))?.planOptions?.[0]?.title).toBe("Revised by fast follow-up");
    expect(await storage.listProjectWorkspaces(project.id)).toEqual([]);
  });

  it("persists draft_generating before an immediately claimed draft revision can run", async () => {
    const projects = new InMemoryProjectRepository();
    const project = await seedProject(projects, "draft_editing");
    const jobs = new InspectingJobs(async () => {
      const saved = await projects.findById(project.id);
      expect(saved?.state).toBe("draft_generating");
      expect(saved?.messages.at(-1)).toMatchObject({ kind: "draft_edit", text: "Voice draft correction" });
      const revised = saved!;
      revised.state = "draft_editing";
      revised.posts[0]!.currentDraft = "Revised by fast follow-up";
      await projects.save(revised);
    });
    const storage = new TempAudioStorage({ baseDir: await mkdtemp(join(tmpdir(), "tg-edit-audio-")) });

    await createTranscribeEditAudioJobHandler(deps(projects, jobs, storage, fakeTranscription("Voice draft correction")))(
      editJob(project.id, "draft_editing")
    );

    const saved = await projects.findById(project.id);
    expect(saved?.state).toBe("draft_editing");
    expect(saved?.posts[0]?.currentDraft).toBe("Revised by fast follow-up");
    expect(await storage.listProjectWorkspaces(project.id)).toEqual([]);
  });

  it("cleans temporary files when transcription fails or edit text is over the bound", async () => {
    const projects = new InMemoryProjectRepository();
    const project = await seedProject(projects, "planning");
    const jobs = new InspectingJobs();
    const storage = new TempAudioStorage({ baseDir: await mkdtemp(join(tmpdir(), "tg-edit-audio-")) });
    const handler = createTranscribeEditAudioJobHandler(deps(projects, jobs, storage, fakeTranscription("x".repeat(2001))));

    await expect(handler(editJob(project.id, "planning"))).rejects.toMatchObject({ code: "EDIT_TRANSCRIPT_INVALID" });
    expect(await storage.listProjectWorkspaces(project.id)).toEqual([]);
  });

  it("rejects stale projects and duration-bound inputs without applying edit history", async () => {
    const projects = new InMemoryProjectRepository();
    const project = await seedProject(projects, "planning");
    const jobs = new InspectingJobs();
    const storage = new TempAudioStorage({ baseDir: await mkdtemp(join(tmpdir(), "tg-edit-audio-")) });
    const stale = createTranscribeEditAudioJobHandler(deps(projects, jobs, storage, fakeTranscription("ignored")));

    await expect(stale(editJob(project.id, "draft_editing"))).rejects.toMatchObject({ code: "EDIT_AUDIO_STALE" });
    expect((await projects.findById(project.id))?.messages).toHaveLength(0);

    const long = createTranscribeEditAudioJobHandler(
      deps(projects, jobs, storage, fakeTranscription("ignored"), fakeProcessor(3601))
    );
    await expect(long({ ...editJob(project.id, "planning"), payload: { source: { ...source(), durationSeconds: 3601 }, stateAtEdit: "planning" } })).rejects.toBeInstanceOf(PermanentJobError);
    expect(await storage.listProjectWorkspaces(project.id)).toEqual([]);
  });
});

function deps(
  projects: InMemoryProjectRepository,
  jobs: JobRepository,
  storage: TempAudioStorage,
  transcription: TranscriptionAdapter,
  audioProcessor: AudioProcessor = fakeProcessor(10)
) {
  return { projects, jobs, storage, transcription, audioProcessor, telegramFiles: fakeFiles() };
}

function editJob(projectId: string, stateAtEdit: "planning" | "draft_editing"): Job {
  const now = new Date();
  return {
    id: "edit-job-1",
    type: "TRANSCRIBE_EDIT_AUDIO",
    status: "running",
    projectId,
    payload: { source: source(), stateAtEdit },
    attempts: 1,
    maxAttempts: 3,
    runAfter: now,
    createdAt: now,
    updatedAt: now
  };
}

function source(): AudioSourceMetadata {
  return { kind: "edit_audio", telegramFileId: "telegram-edit-file", durationSeconds: 10, sizeBytes: 10 };
}

async function seedProject(projects: InMemoryProjectRepository, state: "planning" | "draft_editing"): Promise<Project> {
  const selectedPlan = plan();
  const project: Project = {
    id: "project-1",
    telegramUserId: "100",
    chatId: "200",
    state,
    isActive: true,
    transcript: "Stored source transcript",
    planOptions: [selectedPlan],
    selectedPlan,
    rewriteMode: "make_post",
    currentPostIndex: 1,
    posts: [{ id: "post-1", index: 1, planSlice: selectedPlan.posts[0]!, currentDraft: "Current draft" }],
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };
  await projects.save(project);
  return project;
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

function fakeFiles(): TelegramFileClientPort {
  return {
    async downloadFile({ targetPath }) {
      await writeFile(targetPath, "audio");
      return { fileId: "telegram-edit-file", filePath: "voice.ogg", sizeBytes: 5 };
    }
  };
}

function fakeProcessor(durationSeconds: number): AudioProcessor {
  return {
    async prepareForTranscription({ sourcePath }): Promise<PreparedAudio> {
      return { chunks: [{ index: 0, path: sourcePath }], probe: { durationSeconds }, wasNormalized: false };
    }
  };
}

function fakeTranscription(transcript: string): TranscriptionAdapter {
  return {
    async transcribe() {
      return { transcript, meta: { provider: "whisper", modelLabel: "whisper-1", chunkCount: 1 } };
    }
  };
}

class InspectingJobs implements JobRepository {
  private readonly inner = new InMemoryJobRepository();

  constructor(private readonly onEnqueue?: (input: EnqueueJobInput) => Promise<void>) {}

  async enqueue(input: EnqueueJobInput) {
    await this.onEnqueue?.(input);
    return this.inner.enqueue(input);
  }

  findById(jobId: JobId) {
    return this.inner.findById(jobId);
  }

  claimNextDue(input: { workerId: string; now?: Date }) {
    return this.inner.claimNextDue(input);
  }

  markSucceeded(jobId: JobId, result?: Record<string, unknown>) {
    return this.inner.markSucceeded(jobId, result);
  }

  markFailed(jobId: JobId, failure: JobFailure, now?: Date) {
    return this.inner.markFailed(jobId, failure, now);
  }

  cancelQueuedForProject(projectId: ProjectId) {
    return this.inner.cancelQueuedForProject(projectId);
  }

  recoverStaleRunning(input: RecoverStaleJobsInput) {
    return this.inner.recoverStaleRunning(input);
  }
}
