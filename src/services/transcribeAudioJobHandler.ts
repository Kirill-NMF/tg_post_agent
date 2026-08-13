import type { AudioProcessor } from "../audio/ffmpegAudioProcessor.js";
import type { TempAudioStorage } from "../audio/tempAudioStorage.js";
import type { AudioSourceMetadata, TranscriptionAdapter } from "../domain/audioTypes.js";
import type { Job } from "../domain/jobTypes.js";
import type { Logger } from "../observability/logger.js";
import type { JobRepository } from "../repositories/jobRepository.js";
import type { ProjectRepository } from "../repositories/projectRepository.js";
import type { TelegramFileClientPort } from "../telegram/telegramFileClient.js";
import type { TelegramNotifier } from "../telegram/telegramNotifier.js";
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
  jobs?: JobRepository;
  notifier?: TelegramNotifier;
  logger?: Logger;
  planSplitJobMaxAttempts?: number;
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

      const planningJob = deps.jobs
        ? await deps.jobs.enqueue({
            type: "PLAN_SPLIT",
            projectId: project.id,
            dedupeKey: `project:${project.id}:plan-split:initial`,
            payload: { trigger: "transcription_saved" },
            maxAttempts: deps.planSplitJobMaxAttempts ?? 3
          })
        : undefined;
      const notificationStatus = await notifyTranscriptionComplete(deps, project.chatId, job.id, job.projectId);

      return {
        provider: result.meta.provider,
        modelLabel: result.meta.modelLabel,
        chunkCount: result.meta.chunkCount,
        durationSeconds: result.meta.durationSeconds,
        transcriptLength: result.transcript.length,
        planningEnqueued: Boolean(planningJob),
        planningJobId: planningJob?.id,
        notificationStatus
      };
    } catch (error) {
      if (error instanceof PermanentJobError) {
        project.state = "awaiting_audio";
        await deps.projects.save(project);
        await notifyTranscriptionFailure(deps, project.chatId, job.id, job.projectId);
        throw error;
      }
      if (error instanceof RetryableJobError) throw error;
      const classified = classifyTranscriptionError(error);
      if (classified instanceof PermanentJobError) {
        project.state = "awaiting_audio";
        await deps.projects.save(project);
        await notifyTranscriptionFailure(deps, project.chatId, job.id, job.projectId);
      }
      throw classified;
    } finally {
      if (workspaceDir) await deps.storage.cleanup(workspaceDir);
    }
  };
}

async function notifyTranscriptionComplete(deps: TranscribeAudioJobHandlerDeps, chatId: string, jobId: string, projectId: string): Promise<"not_configured" | "sent" | "failed"> {
  if (!deps.notifier) return "not_configured";
  try {
    await deps.notifier.sendMessage(chatId, "\u0420\u0430\u0441\u0448\u0438\u0444\u0440\u043e\u0432\u043a\u0430 \u0433\u043e\u0442\u043e\u0432\u0430. \u0413\u0435\u043d\u0435\u0440\u0438\u0440\u0443\u044e \u0432\u0430\u0440\u0438\u0430\u043d\u0442\u044b \u043f\u043b\u0430\u043d\u0430 1/2/3.");
    return "sent";
  } catch {
    deps.logger?.warn({ event: "audio_transcription_notification_failed", jobId, projectId }, "audio transcription notification failed");
    return "failed";
  }
}

async function notifyTranscriptionFailure(deps: TranscribeAudioJobHandlerDeps, chatId: string, jobId: string, projectId: string): Promise<void> {
  if (!deps.notifier) return;
  try {
    await deps.notifier.sendMessage(chatId, "\u041d\u0435 \u043f\u043e\u043b\u0443\u0447\u0438\u043b\u043e\u0441\u044c \u0440\u0430\u0441\u0448\u0438\u0444\u0440\u043e\u0432\u0430\u0442\u044c \u044d\u0442\u043e \u0430\u0443\u0434\u0438\u043e. \u041f\u0440\u0438\u0448\u043b\u0438\u0442\u0435 \u0434\u0440\u0443\u0433\u043e\u0439 voice, audio \u0438\u043b\u0438 audio-\u0444\u0430\u0439\u043b.");
  } catch {
    deps.logger?.warn({ event: "audio_transcription_failure_notification_failed", jobId, projectId }, "audio transcription failure notification failed");
  }
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
