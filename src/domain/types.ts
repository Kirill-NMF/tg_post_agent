export type TelegramUserId = string;
export type TelegramChatId = string;
export type ProjectId = string;
export type PostId = string;

export type ProjectState =
  | "idle"
  | "awaiting_audio"
  | "transcribing"
  | "planning"
  | "rewrite_mode"
  | "draft_generating"
  | "draft_editing"
  | "format_choice"
  | "formatting"
  | "formatted_editing"
  | "done"
  | "cancelled"
  | "failed";

export type RewriteMode = "clean_up" | "make_post";
export type FormattingOption = "option_1" | "option_2";
export type PlanOptionId = string;
export type OutputLanguage = string;

export type PlanningConfidence = "low" | "medium" | "high";

export type AdapterMeta = {
  provider: "mock" | "whisper" | "gemini" | "openrouter" | "claude" | "gpt";
  modelLabel?: string;
};

export type AdapterResult<T> =
  | { ok: true; value: T; meta: AdapterMeta }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

export type SourceAudioInput = {
  kind: "voice" | "audio" | "audio_document";
  telegramFileId: string;
  fileName?: string;
  mimeType?: string;
  durationSeconds?: number;
  sizeBytes?: number;
};

export type PlanPostSlice = {
  index: 1 | 2 | 3;
  topic: string;
  angle: string;
  includes: string[];
  excludes?: string[];
};

export type PlanOption = {
  optionId: PlanOptionId;
  postCount: 1 | 2 | 3;
  title: string;
  angle: string;
  summary: string;
  posts: PlanPostSlice[];
};

export type PlanRecommendation = {
  recommendedOptionId: PlanOptionId;
  rationale: string;
  confidence: PlanningConfidence;
};

export type PlanningResult = {
  options: PlanOption[];
  recommendation: PlanRecommendation;
};

export type DraftText = {
  fullText: string;
  title?: string;
  body?: string;
  cta?: string;
  notes?: string[];
};

export type FormattingRevision =
  | {
      action: "updated_formatting";
      decorationPlan: import("./formatting.js").FormattingDecorationPlan;
      editClassification: "formatting_only";
    }
  | {
      action: "route_to_draft";
      draftEditInstruction: string;
      editClassification: "semantic_or_wording_change" | "uncertain";
      reason: string;
    };

export type PreservationCheck = {
  passed: boolean;
  severity: "none" | "minor" | "major";
  reasons: Array<{ code: string; message: string; evidence?: string }>;
  suggestedAction: "accept" | "retry_formatting" | "route_to_draft" | "manual_review";
};

export type ProjectPost = {
  id: PostId;
  index: 1 | 2 | 3;
  planSlice: PlanPostSlice;
  currentDraft?: string;
  formattedText?: string;
  finalText?: string;
  formattingOption?: FormattingOption;
};

export type ProjectMessageKind =
  | "command"
  | "source_audio"
  | "planning_edit"
  | "plan_options"
  | "draft"
  | "draft_edit"
  | "formatting_edit"
  | "final";

export type ProjectMessage = {
  kind: ProjectMessageKind;
  text: string;
  createdAt: Date;
};

export type Project = {
  id: ProjectId;
  telegramUserId: TelegramUserId;
  chatId: TelegramChatId;
  state: ProjectState;
  isActive: boolean;
  transcript?: string;
  outputLanguage?: OutputLanguage;
  planOptions?: PlanOption[];
  planRecommendation?: PlanRecommendation;
  planAlternativesRevealed?: boolean;
  selectedPlan?: PlanOption;
  rewriteMode?: RewriteMode;
  posts: ProjectPost[];
  currentPostIndex?: 1 | 2 | 3;
  messages: ProjectMessage[];
  createdAt: Date;
  updatedAt: Date;
};

export type BotButton = { label: string; action: string };

export type BotResponse =
  | { kind: "message"; text: string; buttons?: BotButton[] }
  | { kind: "document"; filename: string; content: string; caption?: string };
