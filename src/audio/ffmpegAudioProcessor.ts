import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AudioProbe, PreparedAudio } from "../domain/audioTypes.js";

export type AudioProcessor = {
  prepareForTranscription(input: { sourcePath: string; workspaceDir: string }): Promise<PreparedAudio>;
};

export type FfmpegAudioProcessorConfig = {
  ffmpegPath?: string;
  ffprobePath?: string;
  chunkDurationSeconds?: number;
};

export class FfmpegAudioProcessor implements AudioProcessor {
  private readonly ffmpegPath: string;
  private readonly ffprobePath: string;
  private readonly chunkDurationSeconds: number;

  constructor(config: FfmpegAudioProcessorConfig = {}) {
    this.ffmpegPath = config.ffmpegPath ?? "ffmpeg";
    this.ffprobePath = config.ffprobePath ?? "ffprobe";
    this.chunkDurationSeconds = config.chunkDurationSeconds ?? 20 * 60;
  }

  async prepareForTranscription(input: { sourcePath: string; workspaceDir: string }): Promise<PreparedAudio> {
    const probe = await this.probe(input.sourcePath);
    const normalizedPath = join(input.workspaceDir, "normalized.mp3");
    await run(this.ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      input.sourcePath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "64k",
      normalizedPath
    ]);

    if ((probe.durationSeconds ?? 0) > this.chunkDurationSeconds) {
      const chunkPattern = join(input.workspaceDir, "chunk-%03d.mp3");
      await run(this.ffmpegPath, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        normalizedPath,
        "-f",
        "segment",
        "-segment_time",
        String(this.chunkDurationSeconds),
        "-reset_timestamps",
        "1",
        "-c",
        "copy",
        chunkPattern
      ]);
      const chunks = (await readdir(input.workspaceDir))
        .filter((name) => /^chunk-\d{3}\.mp3$/.test(name))
        .sort()
        .map((name, index) => ({ index, path: join(input.workspaceDir, name) }));
      return { chunks, probe, wasNormalized: true };
    }

    return { chunks: [{ index: 0, path: normalizedPath }], probe, wasNormalized: true };
  }

  private async probe(sourcePath: string): Promise<AudioProbe> {
    const { stdout } = await run(this.ffprobePath, [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      sourcePath
    ]);
    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string; format_name?: string };
      streams?: Array<{ codec_type?: string; codec_name?: string }>;
    };
    const audioStream = parsed.streams?.find((stream) => stream.codec_type === "audio");
    const durationSeconds = parsed.format?.duration ? Number(parsed.format.duration) : undefined;
    return {
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : undefined,
      codecName: audioStream?.codec_name,
      formatName: parsed.format?.format_name
    };
  }
}

function run(file: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${file} failed: ${stderr || error.message}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
