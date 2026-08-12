import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { TranscriptionAdapter, TranscriptionInput, TranscriptionResult } from "../domain/audioTypes.js";
import { providerHttpError } from "./providerErrors.js";

export type OpenRouterTranscriptionRequest = (input: { filePath: string; model: string; apiKey: string }) => Promise<{ text?: unknown }>;

export class OpenRouterTranscriptionAdapter implements TranscriptionAdapter {
  private readonly model: string;
  private readonly request: OpenRouterTranscriptionRequest;

  constructor(private readonly config: { apiKey: string; model?: string; request?: OpenRouterTranscriptionRequest }) {
    this.model = config.model ?? "openai/whisper-large-v3";
    this.request = config.request ?? requestOpenRouterTranscription;
  }

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const chunks = [...input.chunks].sort((left, right) => left.index - right.index);
    const texts: string[] = [];
    for (const chunk of chunks) {
      const response = await this.request({ filePath: chunk.path, model: this.model, apiKey: this.config.apiKey });
      const text = typeof response.text === "string" ? response.text.trim() : "";
      if (!text) throw new Error("OpenRouter transcription returned empty transcript text.");
      texts.push(text);
    }
    const transcript = texts.join("\n\n").trim();
    if (!transcript) throw new Error("OpenRouter transcription returned empty transcript.");
    return {
      transcript,
      meta: { provider: "openrouter", modelLabel: this.model, chunkCount: chunks.length, durationSeconds: input.source.durationSeconds }
    };
  }
}

async function requestOpenRouterTranscription(input: { filePath: string; model: string; apiKey: string }): Promise<{ text?: unknown }> {
  const audio = await readFile(input.filePath);
  const response = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ input_audio: { data: audio.toString("base64"), format: audioFormat(input.filePath) }, model: input.model })
  });
  if (!response.ok) throw providerHttpError(response.status);
  return (await response.json()) as { text?: unknown };
}

function audioFormat(filePath: string): string {
  const extension = extname(filePath).slice(1).toLowerCase();
  if (extension === "mp3" || extension === "wav" || extension === "ogg" || extension === "webm" || extension === "m4a" || extension === "flac" || extension === "mp4") return extension;
  throw new Error("OpenRouter transcription input has an unsupported audio format.");
}
