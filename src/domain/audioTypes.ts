import type { JobId } from "./jobTypes.js";
import type { ProjectId } from "./types.js";

export type AudioKind = "source_audio" | "edit_audio";

export type AudioSourceMetadata = {
  kind: AudioKind;
  telegramFileId: string;
  originalFileName?: string;
  mimeType?: string;
  durationSeconds?: number;
  sizeBytes?: number;
};

export type TelegramDownloadedFile = {
  fileId: string;
  filePath: string;
  sizeBytes?: number;
};

export type AudioProbe = {
  durationSeconds?: number;
  codecName?: string;
  formatName?: string;
};

export type AudioChunk = {
  index: number;
  path: string;
};

export type PreparedAudio = {
  chunks: AudioChunk[];
  probe: AudioProbe;
  wasNormalized: boolean;
};

export type TranscriptionInput = {
  projectId: ProjectId;
  jobId: JobId;
  source: AudioSourceMetadata;
  chunks: AudioChunk[];
};

export type TranscriptionResult = {
  transcript: string;
  languageDetected?: "ru" | "en" | "mixed" | "unknown";
  meta: {
    provider: "whisper";
    modelLabel: string;
    chunkCount: number;
    durationSeconds?: number;
  };
};

export type TranscriptionAdapter = {
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
};
