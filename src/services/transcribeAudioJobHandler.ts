import type { AudioProcessor } from "../audio/ffmpegAudioProcessor.js";
import type { TempAudioStorage } from "../audio/tempAudioStorage.js";
import type { AudioSourceMetadata, TranscriptionAdapter } from "../domain/audioTypes.js";
import type { Job } from "../domain/jobTypes.js";
import type { Logger } from "../observability/logger.js";
import type { ProjectRepository } from "../repositories/projectRepository.js";
import type { TelegramFileClientPort } from "../telegram/telegramFileClient.js";
import { PermanentJobError, RetryableJobError, type JobHandler } from "./jobWorker.js";

export type TranscribeAudioJobPayload = {
  source: AudioSourceMetadata;
};

export type TranscribeAudioJobHandlerDeps = {
  projects: ProjectRepository;
  telegramFiles: TelegramFileClientPort;
  audioProcessor: AudioProcessor;
  transcription: TranscriptionAdapter;
  storage: TempAudioStorage;
  logger?: Logger;
};

export function createTranscribeAudioJobHandler(deps: TranscribeAudioJobHandlerDeps): JobHandler {
  return async (job: Job) => {
    if (job.type !== "TRANSCRIBE_AUDIO") throw new PermanentJobError("UNEXPECTED_JOB_TYPE", "Handler received an unexpected job type.");
    if (!job.projectId) throw new PermanentJobError("MISSING_PROJECT_ID", "Transcription job is missing project id.");
    const payload = parseTranscribePayload(job.payload);
    const project = await deps.projects.findById(job.projectId);
    if (!project || !project.isActive) throw new PermanentJobError("PROJECT_NOT_ACTIVE", "Project is no longer active.");

    let workspaceDir: string | undefined;
    try {
      const workspace = await deps.storage.createJobWorkspace({ projectId: job.projectId, jobId: job.id });
      workspaceDir = workspace.dir;
      deps.logger?.info({ event: "audio_transcription_download_started", jobId: job.id, projectId: job.projectId }, "audio download started");

      const downloaded = await deps.telegramFiles.downloadFile({ fileId: payload.source.telegramFileId, targetPath: workspace.sourcePath });
      const prepared = await deps.audioProcessor.prepareForTranscription({ sourcePath: workspace.sourcePath, workspaceDir: workspace.dir });
      deps.logger?.info(
        { event: "audio_transcription_prepared", jobId: job.id, projectId: job.projectId, chunkCount: prepared.chunks.length, durationSeconds: prepared.probe.durationSeconds },
        "audio prepared"
      );

      const result = await deps.transcription.transcribe({
        projectId: job.projectId,
        jobId: job.id,
        source: {
          ...payload.source,
          durationSeconds: payload.source.durationSeconds ?? prepared.probe.durationSeconds,
          sizeBytes: payload.source.sizeBytes ?? downloaded.sizeBytes
        },
        chunks: prepared.chunks
      });

      project.transcript = result.transcript;
      project.state = "planning";
      await deps.projects.save(project);
      deps.logger?.info(
        { event: "audio_transcription_saved", jobId: job.id, projectId: job.projectId, chunkCount: result.meta.chunkCount, transcriptLength: result.transcript.length },
        "audio transcript saved"
      );

      return {
        provider: result.meta.provider,
        modelLabel: result.meta.modelLabel,
        chunkCount: result.meta.chunkCount,
        durationSeconds: result.meta.durationSeconds,
        transcriptLength: result.transcript.length
      };
    } catch (error) {
      if (error instanceof PermanentJobError) {
        project.state = "awaiting_audio";
        await deps.projects.save(project);
        throw error;
      }
      if (error instanceof RetryableJobError) throw error;
      const classified = classifyTranscriptionError(error);
      if (classified instanceof PermanentJobError) {
        project.state = "awaiting_audio";
        await deps.projects.save(project);
      }
      throw classified;
    } finally {
      if (workspaceDir) await deps.storage.cleanup(workspaceDir);
    }
  };
}

function parseTranscribePayload(payload: Record<string, unknown>): TranscribeAudioJobPayload {
  const source = payload.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new PermanentJobError("INVALID_TRANSCRIBE_PAYLOAD", "Transcription job payload is missing source metadata.");
  }
  const candidate = source as Record<string, unknown>;
  if (candidate.kind !== "source_audio" && candidate.kind !== "edit_audio") {
    throw new PermanentJobError("INVALID_AUDIO_KIND", "Transcription job source kind is invalid.");
  }
  if (typeof candidate.telegramFileId !== "string" || candidate.telegramFileId.trim() === "") {
    throw new PermanentJobError("INVALID_TELEGRAM_FILE_ID", "Transcription job source is missing Telegram file id.");
  }
  return {
    source: {
      kind: candidate.kind,
      telegramFileId: candidate.telegramFileId,
      originalFileName: optionalString(candidate.originalFileName),
      mimeType: optionalString(candidate.mimeType),
      durationSeconds: optionalNumber(candidate.durationSeconds),
      sizeBytes: optionalNumber(candidate.sizeBytes)
    }
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function classifyTranscriptionError(error: unknown): Error {
  const message = error instanceof Error ? error.message : "Unknown transcription failure.";
  if (/too large|file_path|invalid|empty transcript/i.test(message)) {
    return new PermanentJobError("TRANSCRIPTION_INPUT_FAILED", safeMessage(message));
  }
  return new RetryableJobError("TRANSCRIPTION_TEMPORARY_FAILURE", safeMessage(message));
}

function safeMessage(message: string): string {
  return message.replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[redacted]").slice(0, 500);
}
