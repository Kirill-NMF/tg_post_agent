import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { MockModelAdapters } from "../src/adapters/mockModelAdapters.js";
import type { PreparedAudio, TranscriptionAdapter } from "../src/domain/audioTypes.js";
import { InMemoryJobRepository } from "../src/repositories/inMemoryJobRepository.js";
import { InMemoryProjectRepository } from "../src/repositories/inMemoryProjectRepository.js";
import { JobWorker, PermanentJobError } from "../src/services/jobWorker.js";
import { ProjectService } from "../src/services/projectService.js";
import { createTranscribeAudioJobHandler } from "../src/services/transcribeAudioJobHandler.js";
import { TempAudioStorage } from "../src/audio/tempAudioStorage.js";
import type { TelegramFileClientPort } from "../src/telegram/telegramFileClient.js";

describe("TRANSCRIBE_AUDIO job handler", () => {
  it("stores transcript, moves project to planning, and cleans temp files without exposing transcript in enqueue response", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "tg-transcribe-job-"));
    const storage = new TempAudioStorage({ baseDir });
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const service = new ProjectService(projects, new MockModelAdapters(), jobs);
    await service.start("100", "200");

    const response = await service.submitSourceAudio("100", { kind: "voice", telegramFileId: "telegram-file-1", durationSeconds: 3, sizeBytes: 1000 });

    expect(response[0]).toMatchObject({ kind: "message" });
    expect(response[0]?.kind === "message" ? response[0].text : "").not.toContain("real transcript");
    const active = await projects.findActiveByTelegramUser("100");
    expect(active?.state).toBe("transcribing");

    const worker = new JobWorker(jobs, {
      TRANSCRIBE_AUDIO: createTranscribeAudioJobHandler({
        projects,
        telegramFiles: fakeTelegramFileClient("downloaded audio"),
        audioProcessor: fakeAudioProcessor(),
        transcription: fakeTranscription("real transcript text"),
        storage
      })
    });
    const processed = await worker.processOne({ workerId: "worker-1" });

    expect(processed.processed).toBe(true);
    const updated = await projects.findActiveByTelegramUser("100");
    expect(updated).toMatchObject({ state: "planning", transcript: "real transcript text" });
    await expect(stat(join(baseDir, updated?.id ?? "", "missing"))).rejects.toThrow();
    await expect(stat(baseDir)).resolves.toBeDefined();
  });

  it("cleans temp files and returns project to awaiting_audio on permanent failure", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "tg-transcribe-job-"));
    const storage = new TempAudioStorage({ baseDir });
    const projects = new InMemoryProjectRepository();
    const jobs = new InMemoryJobRepository();
    const service = new ProjectService(projects, new MockModelAdapters(), jobs);
    await service.start("100", "200");
    await service.submitSourceAudio("100", { kind: "audio", telegramFileId: "telegram-file-1" });

    const worker = new JobWorker(jobs, {
      TRANSCRIBE_AUDIO: createTranscribeAudioJobHandler({
        projects,
        telegramFiles: fakeTelegramFileClient("downloaded audio"),
        audioProcessor: fakeAudioProcessor(),
        transcription: {
          async transcribe() {
            throw new PermanentJobError("EMPTY_TRANSCRIPT", "Provider returned empty transcript.");
          }
        },
        storage
      })
    });

    const processed = await worker.processOne({ workerId: "worker-1" });

    expect(processed).toMatchObject({ processed: true, status: "failed" });
    const updated = await projects.findActiveByTelegramUser("100");
    expect(updated?.state).toBe("awaiting_audio");
    expect(updated?.transcript).toBeUndefined();
    const entries = await storage.listProjectWorkspaces(updated?.id ?? "");
    expect(entries).toEqual([]);
  });
});

function fakeTelegramFileClient(content: string): TelegramFileClientPort {
  return {
    async downloadFile({ targetPath }) {
      await writeFile(targetPath, content);
      return { fileId: "telegram-file-1", filePath: "voice/file.oga", sizeBytes: Buffer.byteLength(content) };
    }
  };
}

function fakeAudioProcessor() {
  return {
    async prepareForTranscription({ sourcePath }: { sourcePath: string; workspaceDir: string }): Promise<PreparedAudio> {
      return {
        chunks: [{ index: 0, path: sourcePath }],
        probe: { durationSeconds: 1, codecName: "opus", formatName: "ogg" },
        wasNormalized: false
      };
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
