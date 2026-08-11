import { execFile } from "node:child_process";
import { mkdtemp, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { FfmpegAudioProcessor } from "../src/audio/ffmpegAudioProcessor.js";

const execFileAsync = promisify(execFile);

describe("FfmpegAudioProcessor", () => {
  it("normalizes generated synthetic audio and returns ordered chunks", async () => {
    if (!(await hasFfmpeg())) return;

    const dir = await mkdtemp(join(tmpdir(), "tg-audio-processor-"));
    const sourcePath = join(dir, "source.wav");
    await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=16000", "-t", "1.2", sourcePath]);

    const processor = new FfmpegAudioProcessor({ chunkDurationSeconds: 0.5 });
    const result = await processor.prepareForTranscription({ sourcePath, workspaceDir: dir });

    expect(result.probe.durationSeconds ?? 0).toBeGreaterThan(0);
    expect(result.wasNormalized).toBe(true);
    expect(result.chunks.length).toBeGreaterThan(1);
    for (const chunk of result.chunks) {
      await expect(stat(chunk.path)).resolves.toMatchObject({ isFile: expect.any(Function) });
    }
    expect(result.chunks.map((chunk) => chunk.index)).toEqual(result.chunks.map((_, index) => index));
  });
});

async function hasFfmpeg(): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", ["-version"]);
    await execFileAsync("ffprobe", ["-version"]);
    return true;
  } catch {
    return false;
  }
}
