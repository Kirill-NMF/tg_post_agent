import type { Job, JobId } from "./jobTypes.js";
import { containsOrdinaryEmoji } from "./emoji.js";
import type { Project, PostId, ProjectId, TelegramChatId, TelegramUserId } from "./types.js";

export type FailedDecorationRecoveryInput = {
  project: Project | undefined;
  accountId: TelegramUserId;
  recipientId: TelegramChatId;
  marker: string;
  expectedProjectId: ProjectId;
  expectedPostId: PostId;
  expectedDraftVersion: number;
  latestFormatJob: Job | undefined;
  expectedFormatJobId: JobId;
  activeJobCount: number;
};

export type FailedDecorationRecoveryCategory =
  | "RECOVERY_SCOPE_INVALID"
  | "RECOVERY_STATE_INVALID"
  | "RECOVERY_DRAFT_VERSION_STALE"
  | "RECOVERY_FORMAT_JOB_INVALID"
  | "RECOVERY_ACTIVE_JOB"
  | "RECOVERY_EMOJI_ALREADY_PRESENT";

export function failedDecorationRecoveryGuard(input: FailedDecorationRecoveryInput): FailedDecorationRecoveryCategory | null {
  const project = input.project;
  const post = project?.posts.find((candidate) => candidate.id === input.expectedPostId && candidate.index === project.currentPostIndex);
  if (
    !project || project.id !== input.expectedProjectId || !project.isActive ||
    project.telegramUserId !== input.accountId || project.chatId !== input.recipientId ||
    !input.marker || !project.messages.some((entry) => entry.kind === "command" && entry.text === input.marker)
  ) return "RECOVERY_SCOPE_INVALID";
  if (project.state !== "formatted_editing" || !post?.currentDraft?.trim() || !post.formattedText?.trim() || post.formattingOption !== "option_2") {
    return "RECOVERY_STATE_INVALID";
  }
  if (!Number.isInteger(input.expectedDraftVersion) || input.expectedDraftVersion < 1 || post.draftVersion !== input.expectedDraftVersion) {
    return "RECOVERY_DRAFT_VERSION_STALE";
  }
  const job = input.latestFormatJob;
  if (
    !job || job.id !== input.expectedFormatJobId || job.type !== "FORMAT_POST" || job.status !== "succeeded" || job.attempts !== 1 || job.maxAttempts !== 1 ||
    job.projectId !== project.id || job.postId !== post.id ||
    job.payload.postIndex !== project.currentPostIndex || job.payload.formattingOption !== "option_2"
  ) return "RECOVERY_FORMAT_JOB_INVALID";
  if (!Number.isInteger(input.activeJobCount) || input.activeJobCount !== 0) return "RECOVERY_ACTIVE_JOB";
  if (containsOrdinaryEmoji(post.formattedText)) return "RECOVERY_EMOJI_ALREADY_PRESENT";
  return null;
}

export function invalidateFailedDecoration(project: Project, expectedPostId: PostId, expectedDraftVersion: number): void {
  const post = project.posts.find((candidate) => candidate.id === expectedPostId && candidate.index === project.currentPostIndex);
  if (project.state !== "formatted_editing" || !post?.currentDraft?.trim()) throw new Error("RECOVERY_STATE_INVALID");
  if (!Number.isInteger(expectedDraftVersion) || expectedDraftVersion < 1 || post.draftVersion !== expectedDraftVersion) {
    throw new Error("RECOVERY_DRAFT_VERSION_STALE");
  }
  project.state = "draft_editing";
  post.formattedText = undefined;
  post.finalText = undefined;
  post.formattingOption = undefined;
}
