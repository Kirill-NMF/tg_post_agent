import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MockModelAdapters } from "../src/adapters/mockModelAdapters.js";
import { TempAudioStorage } from "../src/audio/tempAudioStorage.js";
import type { PreparedAudio, TranscriptionAdapter } from "../src/domain/audioTypes.js";
import type { EnqueueJobInput, Job } from "../src/domain/jobTypes.js";
import { InMemoryJobRepository } from "../src/repositories/inMemoryJobRepository.js";
import { InMemoryProjectRepository } from "../src/repositories/inMemoryProjectRepository.js";
import { JobWorker, PermanentJobError } from "../src/services/jobWorker.js";
import { ProjectService } from "../src/services/projectService.js";
import { createTranscribeAudioJobHandler } from "../src/services/transcribeAudioJobHandler.js";
import type { TelegramFileClientPort } from "../src/telegram/telegramFileClient.js";

describe("explicit source audio pool", () => {
  it("collects one or three mixed/forwarded parts and starts the batch exactly once", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new RecordingJobs();
    const service = new ProjectService(projects, new MockModelAdapters(), jobs, { sourceAudio: 1 });
    await service.start("user", "chat");

    for (const input of [
      { kind: "voice" as const, telegramFileId: "f30", telegramMessageId: "30" },
      { kind: "audio" as const, telegramFileId: "f10", telegramMessageId: "10", forwarded: true },
      { kind: "audio_document" as const, telegramFileId: "f20", telegramMessageId: "20", forwarded: true }
    ]) {
      const [collector] = await service.submitSourceAudio("user", input);
      expect(collector).toMatchObject({ kind: "message", buttons: [{ label: "Начать обработку" }] });
    }
    expect(jobs.enqueued).toHaveLength(0);
    const project = await projects.findActiveByTelegramUser("user");
    expect(project?.sourceAudioParts?.map((part) => part.telegramMessageId)).toEqual(["10", "20", "30"]);

    const first = await service.startSourceProcessing({
      telegramUserId: "user", chatId: "chat", projectId: project!.id, callbackQueryId: "callback-1", callbackMessageId: "99"
    });
    expect(first[0]).toMatchObject({ kind: "message", replyToMessageId: "99" });
    expect(jobs.enqueued.filter((job) => job.type === "TRANSCRIBE_AUDIO")).toHaveLength(3);
    expect((await projects.findById(project!.id))?.sourcePoolSealed).toBe(true);
    expect(await service.startSourceProcessing({
      telegramUserId: "user", chatId: "chat", projectId: project!.id, callbackQueryId: "callback-1", callbackMessageId: "99"
    })).toEqual([]);
  });

  it("combines independently completed transcripts in Telegram message order", async () => {
    const { projects, jobs, service, worker } = await batchFixture();
    const project = await projects.findActiveByTelegramUser("user");
    const transcriptionJobs = jobs.enqueued.filter((job) => job.type === "TRANSCRIBE_AUDIO");

    for (const job of [...transcriptionJobs].reverse()) {
      await worker.processOne({ workerId: "test", expectedJobId: job.id });
    }

    const updated = await projects.findById(project!.id);
    expect(updated).toMatchObject({ state: "planning", transcript: "transcript-10\n\ntranscript-20\n\ntranscript-30" });
    expect(jobs.enqueued.filter((job) => job.type === "PLAN_SPLIT")).toHaveLength(1);
  });

  it("preserves successful parts and retries only a failed part", async () => {
    let fail20 = true;
    const fixture = await batchFixture(async (fileId) => {
      if (fileId === "f20" && fail20) throw new PermanentJobError("EMPTY_TRANSCRIPT", "empty");
      return `transcript-${fileId.slice(1)}`;
    });
    const firstJobs = fixture.jobs.enqueued.filter((job) => job.type === "TRANSCRIBE_AUDIO");
    for (const job of firstJobs) await fixture.worker.processOne({ workerId: "test", expectedJobId: job.id });

    const project = await fixture.projects.findActiveByTelegramUser("user");
    expect(project?.sourceAudioParts?.map((part) => [part.telegramMessageId, part.status])).toEqual([
      ["10", "succeeded"], ["20", "failed"], ["30", "succeeded"]
    ]);
    fail20 = false;
    await fixture.service.startSourceProcessing({
      telegramUserId: "user", chatId: "chat", projectId: project!.id, callbackQueryId: "retry-callback", callbackMessageId: "99"
    });
    const allTranscriptionJobs = fixture.jobs.enqueued.filter((job) => job.type === "TRANSCRIBE_AUDIO");
    expect(allTranscriptionJobs).toHaveLength(4);
    await fixture.worker.processOne({ workerId: "test", expectedJobId: allTranscriptionJobs[3]!.id });
    expect(await fixture.projects.findById(project!.id)).toMatchObject({ state: "planning", transcript: "transcript-10\n\ntranscript-20\n\ntranscript-30" });
  });

  it("abandons an unstarted pool on /start and refuses audio after seal", async () => {
    const projects = new InMemoryProjectRepository();
    const jobs = new RecordingJobs();
    const service = new ProjectService(projects, new MockModelAdapters(), jobs);
    await service.start("user", "chat");
    await service.submitSourceAudio("user", { kind: "voice", telegramFileId: "old", telegramMessageId: "1" });
    const old = await projects.findActiveByTelegramUser("user");
    await service.start("user", "chat");
    expect((await projects.findById(old!.id))?.isActive).toBe(false);
    const current = await projects.findActiveByTelegramUser("user");
    expect(current?.sourceAudioParts).toEqual([]);

    await service.submitSourceAudio("user", { kind: "voice", telegramFileId: "new", telegramMessageId: "2" });
    await service.startSourceProcessing({ telegramUserId: "user", chatId: "chat", projectId: current!.id, callbackQueryId: "seal", callbackMessageId: "9" });
    const response = await service.submitSourceAudio("user", { kind: "voice", telegramFileId: "late", telegramMessageId: "3" });
    expect(response[0]).toMatchObject({ kind: "message" });
    expect((await projects.findById(current!.id))?.sourceAudioParts).toHaveLength(1);
  });
});

class RecordingJobs extends InMemoryJobRepository {
  readonly enqueued: Job[] = [];

  override async enqueue(input: EnqueueJobInput): Promise<Job> {
    const job = await super.enqueue(input);
    if (!this.enqueued.some((item) => item.id === job.id)) this.enqueued.push(job);
    return job;
  }
}

async function batchFixture(transcriptFor: (fileId: string) => Promise<string> = async (fileId) => `transcript-${fileId.slice(1)}`) {
  const projects = new InMemoryProjectRepository();
  const jobs = new RecordingJobs();
  const service = new ProjectService(projects, new MockModelAdapters(), jobs, { sourceAudio: 1 });
  await service.start("user", "chat");
  for (const [messageId, fileId] of [["30", "f30"], ["10", "f10"], ["20", "f20"]] as const) {
    await service.submitSourceAudio("user", { kind: "voice", telegramFileId: fileId, telegramMessageId: messageId });
  }
  const project = await projects.findActiveByTelegramUser("user");
  await service.startSourceProcessing({ telegramUserId: "user", chatId: "chat", projectId: project!.id, callbackQueryId: "start", callbackMessageId: "99" });
  const storage = new TempAudioStorage({ baseDir: await mkdtemp(join(tmpdir(), "source-pool-")) });
  const worker = new JobWorker(jobs, {
    TRANSCRIBE_AUDIO: createTranscribeAudioJobHandler({
      projects,
      telegramFiles: fakeTelegramFileClient(),
      audioProcessor: fakeAudioProcessor(),
      transcription: { async transcribe(input) { return { transcript: await transcriptFor(input.source.telegramFileId), meta: { provider: "whisper", modelLabel: "fake", chunkCount: 1 } }; } } satisfies TranscriptionAdapter,
      storage,
      jobs,
      planSplitJobMaxAttempts: 1
    })
  });
  return { projects, jobs, service, worker };
}

function fakeTelegramFileClient(): TelegramFileClientPort {
  return { async downloadFile({ fileId, targetPath }) { await writeFile(targetPath, fileId); return { fileId, filePath: "private/audio", sizeBytes: fileId.length }; } };
}

function fakeAudioProcessor() {
  return { async prepareForTranscription({ sourcePath }: { sourcePath: string; workspaceDir: string }): Promise<PreparedAudio> {
    return { chunks: [{ index: 0, path: sourcePath }], probe: { durationSeconds: 1, codecName: "opus", formatName: "ogg" }, wasNormalized: false };
  } };
}
