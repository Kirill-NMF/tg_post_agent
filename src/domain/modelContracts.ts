import type {
  AdapterResult,
  DraftText,
  FormattingOption,
  FormattingRevision,
  PlanOption,
  PlanningResult,
  PreservationCheck,
  ProjectId,
  RewriteMode,
  SourceAudioInput
} from "./types.js";

export type SourceTranscriptionInput = {
  projectId: ProjectId;
  source: SourceAudioInput;
};

export type EditTranscriptionInput = {
  projectId: ProjectId;
  stateAtEdit: "planning" | "draft_editing" | "formatted_editing";
  source: SourceAudioInput;
};

export type ModelAdapters = {
  transcribeSource(input: SourceTranscriptionInput): Promise<AdapterResult<{ transcript: string }>>;
  transcribeEdit(input: EditTranscriptionInput): Promise<AdapterResult<{ editText: string }>>;
  planSplit(input: { projectId: ProjectId; transcript: string; planningHistory: string[] }): Promise<AdapterResult<PlanningResult>>;
  revisePlan(input: {
    projectId: ProjectId;
    transcript: string;
    currentPlan: PlanningResult;
    latestUserEdit: string;
  }): Promise<AdapterResult<PlanningResult & { changeSummary?: string }>>;
  generateDraft(input: {
    projectId: ProjectId;
    selectedPlan: PlanOption;
    postIndex: 1 | 2 | 3;
    rewriteMode: RewriteMode;
    transcript: string;
    compactContext?: string[];
  }): Promise<AdapterResult<{ draft: DraftText }>>;
  reviseDraft(input: {
    projectId: ProjectId;
    currentDraft: string;
    latestUserEdit: string;
    compactContext: string[];
  }): Promise<AdapterResult<{ updatedDraft: DraftText; appliedEditSummary?: string }>>;
  formatPost(input: {
    projectId: ProjectId;
    draftText: string;
    formattingOption: FormattingOption;
  }): Promise<AdapterResult<{ formattedText: string; formattingNotes?: string[] }>>;
  reviseFormatting(input: {
    projectId: ProjectId;
    draftText: string;
    formattedText: string;
    latestUserEdit: string;
    formattingOption: FormattingOption;
  }): Promise<AdapterResult<FormattingRevision>>;
  checkPreservation(input: {
    projectId: ProjectId;
    draftText: string;
    formattedText: string;
    formattingOption: FormattingOption;
  }): Promise<AdapterResult<PreservationCheck>>;
};
