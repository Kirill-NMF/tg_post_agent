import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { OpenAITranscriptionAdapter } from "../src/adapters/openAITranscriptionAdapter.js";

describe("OpenAITranscriptionAdapter", () => {
  it("transcribes chunks in order and concatenates non-empty text", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tg-transcription-"));
    const first = join(dir, "chunk-000.mp3");
    const second = join(dir, "chunk-001.mp3");
    await writeFile(first, "first");
    await writeFile(second, "second");
    const calls: string[] = [];
    const adapter = new OpenAITranscriptionAdapter({
      apiKey: "test-key",
      model: "whisper-1",
      request: async ({ filePath }) => {
        calls.push(filePath);
        return { text: filePath.endsWith("000.mp3") ? "First part." : "Second part." };
      }
    });

    const result = await adapter.transcribe({
      projectId: "project-1",
      jobId: "job-1",
      source: { kind: "source_audio", telegramFileId: "file-1" },
      chunks: [
        { index: 0, path: first },
        { index: 1, path: second }
      ]
    });

    expect(calls).toEqual([first, second]);
    expect(result.transcript).toBe("First part.\n\nSecond part.");
    expect(result.meta).toMatchObject({ provider: "whisper", modelLabel: "whisper-1", chunkCount: 2 });
  });

  it("rejects empty transcript text from the provider", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tg-transcription-"));
    const filePath = join(dir, "chunk-000.mp3");
    await writeFile(filePath, "empty");
    const adapter = new OpenAITranscriptionAdapter({
      apiKey: "test-key",
      model: "whisper-1",
      request: async () => ({ text: "   " })
    });

    await expect(
      adapter.transcribe({
        projectId: "project-1",
        jobId: "job-1",
        source: { kind: "source_audio", telegramFileId: "file-1" },
        chunks: [{ index: 0, path: filePath }]
      })
    ).rejects.toThrow("empty transcript");
  });
});
