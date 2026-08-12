import type { AudioProcessor } from "../audio/ffmpegAudioProcessor.js";
import type { TempAudioStorage } from "../audio/tempAudioStorage.js";
import type { AudioSourceMetadata, TranscriptionAdapter } from "../domain/audioTypes.js";
import type { Job } from "../domain/jobTypes.js";
import type { Logger } from "../observability/logger.js";
import type { JobRepository } from "../repositories/jobRepository.js";
import type { ProjectRepository } from "../repositories/projectRepository.js";
import type { TelegramFileClientPort } from "../telegram/telegramFileClient.js";
import { PermanentJobError, RetryableJobError, type JobHandler } from "./jobWorker.js";

const maxEditDurationSeconds = 60 * 60;
const maxEditChars = 2000;

type Payload = { source: AudioSourceMetadata; stateAtEdit: "planning" | "draft_editing" };

export function createTranscribeEditAudioJobHandler(deps: {
  projects: ProjectRepository;
  jobs: JobRepository;
  telegramFiles: TelegramFileClientPort;
  audioProcessor: AudioProcessor;
  transcription: TranscriptionAdapter;
  storage: TempAudioStorage;
  logger?: Logger;
}): JobHandler {
  return async (job: Job) => {
    if (job.type !== "TRANSCRIBE_EDIT_AUDIO" || !job.projectId) {
      throw new PermanentJobError("INVALID_EDIT_AUDIO_JOB", "Edit-audio job is invalid.");
    }

    const payload = parse(job.payload);
    const project = await deps.projects.findById(job.projectId);
    if (!project?.isActive || project.state !== payload.stateAtEdit) {
      throw new PermanentJobError("EDIT_AUDIO_STALE", "Project state changed before the voice edit could be applied.");
    }

    let workspace: string | undefined;
    try {
      workspace = (await deps.storage.createJobWorkspace({ projectId: project.id, jobId: job.id })).dir;
      const sourcePath = workspace + "/source";
      const downloaded = await deps.telegramFiles.downloadFile({ fileId: payload.source.telegramFileId, targetPath: sourcePath });
      const prepared = await deps.audioProcessor.prepareForTranscription({ sourcePath, workspaceDir: workspace });
      const durationSeconds = payload.source.durationSeconds ?? prepared.probe.durationSeconds;
      if ((durationSeconds ?? 0) > maxEditDurationSeconds) {
        throw new PermanentJobError("EDIT_AUDIO_TOO_LONG", "Voice edit exceeds the configured duration limit.");
      }

      const result = await deps.transcription.transcribe({
        projectId: project.id,
        jobId: job.id,
        source: { ...payload.source, sizeBytes: payload.source.sizeBytes ?? downloaded.sizeBytes, durationSeconds },
        chunks: prepared.chunks
      });
      const latestUserEdit = result.transcript.trim();
      if (!latestUserEdit || latestUserEdit.length > maxEditChars) {
        throw new PermanentJobError("EDIT_TRANSCRIPT_INVALID", "Voice edit transcript is invalid.");
      }
      if (!project.isActive || project.state !== payload.stateAtEdit) {
        throw new PermanentJobError("EDIT_AUDIO_STALE", "Project state changed before the voice edit could be applied.");
      }

      if (payload.stateAtEdit === "planning") {
        project.messages.push({ kind: "planning_edit", text: latestUserEdit, createdAt: new Date() });
        await deps.projects.save(project);
        await deps.jobs.enqueue({
          type: "REVISE_PLAN",
          projectId: project.id,
          dedupeKey: "project:" + project.id + ":revise-plan:voice:" + job.id,
          payload: { latestUserEdit }
        });
      } else {
        const post = project.posts.find((item) => item.index === project.currentPostIndex);
        if (!post?.currentDraft) {
          throw new PermanentJobError("DRAFT_CURRENT_DRAFT_MISSING", "Current draft is required before voice revision.");
        }
        project.messages.push({ kind: "draft_edit", text: latestUserEdit, createdAt: new Date() });
        project.state = "draft_generating";
        await deps.projects.save(project);
        await deps.jobs.enqueue({
          type: "REVISE_DRAFT",
          projectId: project.id,
          postId: post.id,
          dedupeKey: "project:" + project.id + ":post:" + post.index + ":revise-draft:voice:" + job.id,
          payload: { postIndex: post.index, latestUserEdit }
        });
      }

      deps.logger?.info(
        { event: "edit_audio_transcribed_and_routed", jobId: job.id, projectId: project.id, stateAtEdit: payload.stateAtEdit, chunkCount: result.meta.chunkCount },
        "edit audio routed"
      );
      return { provider: result.meta.provider, modelLabel: result.meta.modelLabel, stateAtEdit: payload.stateAtEdit, transcriptStored: true };
    } catch (error) {
      if (error instanceof PermanentJobError || error instanceof RetryableJobError) throw error;
      throw new RetryableJobError("EDIT_AUDIO_TRANSCRIPTION_FAILED", "Voice edit transcription failed.");
    } finally {
      if (workspace) await deps.storage.cleanup(workspace);
    }
  };
}

function parse(payload: Record<string, unknown>): Payload {
  const source = payload.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new PermanentJobError("EDIT_AUDIO_PAYLOAD_INVALID", "Edit-audio payload is invalid.");
  }
  const item = source as Record<string, unknown>;
  if (item.kind !== "edit_audio" || typeof item.telegramFileId !== "string" || !item.telegramFileId.trim()) {
    throw new PermanentJobError("EDIT_AUDIO_PAYLOAD_INVALID", "Edit-audio source is invalid.");
  }
  if (payload.stateAtEdit !== "planning" && payload.stateAtEdit !== "draft_editing") {
    throw new PermanentJobError("EDIT_AUDIO_STATE_INVALID", "Edit-audio state is not supported.");
  }
  return {
    stateAtEdit: payload.stateAtEdit,
    source: {
      kind: "edit_audio",
      telegramFileId: item.telegramFileId,
      originalFileName: optional(item.originalFileName),
      mimeType: optional(item.mimeType),
      durationSeconds: finiteNumber(item.durationSeconds),
      sizeBytes: finiteNumber(item.sizeBytes)
    }
  };
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
