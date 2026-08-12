import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { providerHttpError } from "./providerErrors.js";
import type { AudioChunk, TranscriptionAdapter, TranscriptionInput, TranscriptionResult } from "../domain/audioTypes.js";

export type OpenAITranscriptionRequest = (input: { filePath: string; model: string; apiKey: string }) => Promise<{ text?: unknown }>;

export type OpenAITranscriptionAdapterConfig = {
  apiKey: string;
  model?: string;
  request?: OpenAITranscriptionRequest;
};

export class OpenAITranscriptionAdapter implements TranscriptionAdapter {
  private readonly model: string;
  private readonly request: OpenAITranscriptionRequest;

  constructor(private readonly config: OpenAITranscriptionAdapterConfig) {
    this.model = config.model ?? "whisper-1";
    this.request = config.request ?? requestOpenAITranscription;
  }

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const chunks = [...input.chunks].sort((left, right) => left.index - right.index);
    const texts: string[] = [];
    for (const chunk of chunks) {
      const response = await this.request({ filePath: chunk.path, model: this.model, apiKey: this.config.apiKey });
      const text = typeof response.text === "string" ? response.text.trim() : "";
      if (!text) throw new Error("OpenAI transcription returned empty transcript text.");
      texts.push(text);
    }

    const transcript = texts.join("\n\n").trim();
    if (!transcript) throw new Error("OpenAI transcription returned empty transcript.");
    return {
      transcript,
      meta: {
        provider: "whisper",
        modelLabel: this.model,
        chunkCount: chunks.length,
        durationSeconds: input.source.durationSeconds
      }
    };
  }
}

async function requestOpenAITranscription(input: { filePath: string; model: string; apiKey: string }): Promise<{ text?: unknown }> {
  const form = new FormData();
  form.append("model", input.model);
  form.append("file", new Blob([await readFile(input.filePath)]), basename(input.filePath));

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${input.apiKey}` },
    body: form
  });
  if (!response.ok) throw providerHttpError(response.status);
  return (await response.json()) as { text?: unknown };
}
