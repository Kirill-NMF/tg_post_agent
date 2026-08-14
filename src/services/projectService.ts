import { randomUUID } from "node:crypto";
import type { ModelAdapters } from "../domain/modelContracts.js";
import type { AudioSourceMetadata } from "../domain/audioTypes.js";
import { resolveOutputLanguage } from "../domain/outputLanguage.js";
import type {
  BotResponse,
  FormattingOption,
  PlanOptionId,
  Project,
  ProjectMessageKind,
  RewriteMode,
  SourceAudioInput,
  TelegramChatId,
  TelegramUserId
} from "../domain/types.js";
import type { JobRepository } from "../repositories/jobRepository.js";
import type { ProjectRepository } from "../repositories/projectRepository.js";
import { applyFormattingPlan } from "../domain/formatting.js";
import { draftActionButtons } from "./draftPresentation.js";
import { currentPlan } from "./planSplitJobHandler.js";
import { alternativePlanButtons, planButtons, renderAlternativePlansMessage, renderPlanRecommendationMessage } from "./planningPresentation.js";

export class ProjectService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly models: ModelAdapters,
    private readonly jobs?: JobRepository,
    private readonly jobAttempts: Partial<{ sourceAudio: number; editAudio: number; planRevision: number }> = { sourceAudio: 3, editAudio: 3, planRevision: 3 }
  ) {}

  async start(telegramUserId: TelegramUserId, chatId: TelegramChatId): Promise<BotResponse[]> {
    await this.projects.deactivateActiveForUser(telegramUserId);
    const now = new Date();
    const project: Project = {
      id: randomUUID(),
      telegramUserId,
      chatId,
      state: "awaiting_audio",
      isActive: true,
      posts: [],
      messages: [{ kind: "command", text: "/start", createdAt: now }],
      createdAt: now,
      updatedAt: now
    };
    await this.projects.save(project);
    return [{ kind: "message", text: "Пришлите voice, audio или audio-файл как источник для нового проекта." }];
  }

  async getActiveProject(telegramUserId: TelegramUserId): Promise<Project | undefined> {
    return this.projects.findActiveByTelegramUser(telegramUserId);
  }

  async submitSourceAudio(telegramUserId: TelegramUserId, source: SourceAudioInput): Promise<BotResponse[]> {
    const project = await this.requireActive(telegramUserId);
    if (project.state !== "awaiting_audio") {
      return [{ kind: "message", text: "Сейчас аудио-источник не ожидается. Продолжите текущий шаг или отправьте /start." }];
    }

    project.messages.push(message("source_audio", source.telegramFileId));
    if (this.jobs) {
      await this.jobs.enqueue({
        type: "TRANSCRIBE_AUDIO",
        projectId: project.id,
        dedupeKey: `project:${project.id}:source-transcription`,
        payload: { source: toAudioSourceMetadata(source) },
        maxAttempts: this.jobAttempts.sourceAudio ?? 3
      });
      project.state = "transcribing";
      await this.projects.save(project);
      return [{ kind: "message", text: "Аудио принято. Начинаю расшифровку; я пришлю варианты плана, когда обработка закончится." }];
    }

    const transcript = await unwrap(this.models.transcribeSource({ projectId: project.id, source }));
    project.transcript = transcript.transcript;

    const plan = await unwrap(this.models.planSplit({ projectId: project.id, transcript: project.transcript, planningHistory: [], outputLanguage: project.outputLanguage }));
    project.planOptions = plan.options;
    project.planRecommendation = plan.recommendation;
    project.planAlternativesRevealed = false;
    project.state = "planning";
    project.messages.push(message("plan_options", "recommended:" + plan.recommendation.recommendedOptionId));
    await this.projects.save(project);

    return [{ kind: "message", text: renderPlanRecommendationMessage(plan), buttons: planButtons(plan) }];
  }

  async revisePlan(telegramUserId: TelegramUserId, latestUserEdit: string): Promise<BotResponse[]> {
    const project = await this.requireActive(telegramUserId);
    const plan = currentPlan(project);
    if (project.state !== "planning" || !project.transcript || !plan) {
      return [{ kind: "message", text: "Правки плана доступны только на экране планирования." }];
    }

    project.outputLanguage = resolveOutputLanguage(project.outputLanguage, latestUserEdit);
    project.messages.push(message("planning_edit", latestUserEdit));
    if (this.jobs) {
      await this.projects.save(project);
      await this.jobs.enqueue({
        type: "REVISE_PLAN",
        projectId: project.id,
        dedupeKey: `project:${project.id}:revise-plan:text:${project.messages.filter((item) => item.kind === "planning_edit").length}`,
        payload: { latestUserEdit },
        maxAttempts: this.jobAttempts.planRevision ?? 3,
      });
      return [{ kind: "message", text: "Принял правку, обновляю рекомендацию." }];
    }

    const revised = await unwrap(this.models.revisePlan({ projectId: project.id, transcript: project.transcript, currentPlan: plan, latestUserEdit, outputLanguage: project.outputLanguage }));
    project.planOptions = revised.options;
    project.planRecommendation = revised.recommendation;
    project.planAlternativesRevealed = false;
    await this.projects.save(project);
    return [{ kind: "message", text: renderPlanRecommendationMessage(revised), buttons: planButtons(revised) }];
  }

  async showPlanAlternatives(telegramUserId: TelegramUserId): Promise<BotResponse[]> {
    const project = await this.requireActive(telegramUserId);
    const plan = currentPlan(project);
    if (project.state !== "planning" || !plan || plan.options.length < 2) {
      return [{ kind: "message", text: "Других осмысленных разбивок для этого материала нет." }];
    }
    project.planAlternativesRevealed = true;
    await this.projects.save(project);
    return [{ kind: "message", text: renderAlternativePlansMessage(plan), buttons: alternativePlanButtons(plan) }];
  }

  async choosePlan(telegramUserId: TelegramUserId, optionId: PlanOptionId): Promise<BotResponse[]> {
    const project = await this.requireActive(telegramUserId);
    const plan = currentPlan(project);
    if (project.state !== "planning" || !plan) {
      return [{ kind: "message", text: "Сначала нужен план из аудио." }];
    }
    if (optionId !== plan.recommendation.recommendedOptionId && !project.planAlternativesRevealed) {
      return [{ kind: "message", text: "Сначала откройте другие разбивки, если хотите выбрать альтернативу." }];
    }
    const selectedPlan = plan.options.find((option) => option.optionId === optionId);
    if (!selectedPlan) {
      return [{ kind: "message", text: "Такого варианта плана нет. Выберите доступный вариант." }];
    }

    project.selectedPlan = selectedPlan;
    project.currentPostIndex = 1;
    project.posts = selectedPlan.posts.map((slice) => ({ id: randomUUID(), index: slice.index, planSlice: slice }));
    project.state = "rewrite_mode";
    await this.projects.save(project);
    return [{ kind: "message", text: "Выберите режим переписывания.", buttons: rewriteButtons() }];
  }

  async chooseRewriteMode(telegramUserId: TelegramUserId, rewriteMode: RewriteMode): Promise<BotResponse[]> {
    const project = await this.requireActive(telegramUserId);
    if (project.state !== "rewrite_mode" || !project.selectedPlan || !project.transcript || !project.currentPostIndex) {
      return [{ kind: "message", text: "Режим можно выбрать после выбора плана." }];
    }

    project.rewriteMode = rewriteMode;
    if (this.jobs) {
      project.state = "draft_generating";
      await this.projects.save(project);
      try {
        await this.enqueueDraftGeneration(project);
      } catch {
        project.state = "rewrite_mode";
        await this.projects.save(project);
        return [{ kind: "message", text: "Не удалось запустить генерацию черновика. Выберите режим переписывания ещё раз." }];
      }
      return [{ kind: "message", text: "Режим выбран. Генерирую черновик; пришлю его здесь, когда он будет готов." }];
    }

    const draft = await this.generateDraftForCurrentPost(project);
    await this.projects.save(project);
    return [{ kind: "message", text: draft, buttons: draftActionButtons() }];
  }

  async reviseDraft(telegramUserId: TelegramUserId, latestUserEdit: string): Promise<BotResponse[]> {
    const project = await this.requireActive(telegramUserId);
    const post = currentPost(project);
    if (project.state !== "draft_editing" || !post?.currentDraft) {
      return [{ kind: "message", text: "Правки черновика доступны только после генерации черновика." }];
    }

    project.outputLanguage = resolveOutputLanguage(project.outputLanguage, latestUserEdit);
    project.messages.push(message("draft_edit", latestUserEdit));
    if (this.jobs) {
      await this.enqueueDraftRevision(project, post, latestUserEdit);
      await this.projects.save(project);
      return [{ kind: "message", text: "Принял правку, обновляю черновик." }];
    }

    const updated = await unwrap(
      this.models.reviseDraft({ projectId: project.id, currentDraft: post.currentDraft, latestUserEdit, compactContext: recentEditMessages(project), outputLanguage: project.outputLanguage })
    );
    post.currentDraft = updated.updatedDraft.fullText;
    project.messages.push(message("draft", post.currentDraft));
    await this.projects.save(project);
    return [{ kind: "message", text: post.currentDraft, buttons: draftActionButtons() }];
  }

  async openFormatChoice(telegramUserId: TelegramUserId): Promise<BotResponse[]> {
    const project = await this.requireActive(telegramUserId);
    if (project.state !== "draft_editing" || !currentPost(project)?.currentDraft) {
      return [{ kind: "message", text: "Оформление доступно после черновика." }];
    }
    project.state = "format_choice";
    await this.projects.save(project);
    return [{ kind: "message", text: "Выберите вариант оформления.", buttons: formatButtons() }];
  }

  async formatCurrentPost(telegramUserId: TelegramUserId, formattingOption: FormattingOption): Promise<BotResponse[]> {
    const project = await this.requireActive(telegramUserId);
    const post = currentPost(project);
    if (project.state !== "format_choice" || !post?.currentDraft) {
      return [{ kind: "message", text: "Сначала откройте оформление из черновика." }];
    }

    if (this.jobs) {
      project.state = "formatting";
      await this.projects.save(project);
      try {
        await this.enqueueFormatting(project, post, formattingOption);
      } catch {
        project.state = "format_choice";
        await this.projects.save(project);
        return [{ kind: "message", text: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c \u043e\u0444\u043e\u0440\u043c\u043b\u0435\u043d\u0438\u0435. \u0427\u0435\u0440\u043d\u043e\u0432\u0438\u043a \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d." }];
      }
      return [{ kind: "message", text: "\u041e\u0444\u043e\u0440\u043c\u043b\u044f\u044e \u0447\u0435\u0440\u043d\u043e\u0432\u0438\u043a; \u043f\u0440\u0438\u0448\u043b\u044e \u0433\u043e\u0442\u043e\u0432\u044b\u0439 \u0442\u0435\u043a\u0441\u0442." }];
    }

    const formatted = await unwrap(this.models.formatPost({ projectId: project.id, draftText: post.currentDraft, formattingOption }));
    const rendered = applyFormattingPlan(post.currentDraft, formatted.decorationPlan);
    if (!rendered.ok) {
      return [{ kind: "message", text: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0431\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u043e \u043f\u0440\u0438\u043c\u0435\u043d\u0438\u0442\u044c \u043e\u0444\u043e\u0440\u043c\u043b\u0435\u043d\u0438\u0435. \u0427\u0435\u0440\u043d\u043e\u0432\u0438\u043a \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d \u0431\u0435\u0437 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u0439." }];
    }

    post.formattedText = rendered.text;
    post.formattingOption = formattingOption;
    project.state = "formatted_editing";
    await this.projects.save(project);
    return [{ kind: "message", text: post.formattedText, buttons: finalButtons(project) }];
  }

  async reviseFormatting(telegramUserId: TelegramUserId, latestUserEdit: string): Promise<BotResponse[]> {
    const project = await this.requireActive(telegramUserId);
    const post = currentPost(project);
    if (project.state !== "formatted_editing" || !post?.formattedText || !post.currentDraft || !post.formattingOption) {
      return [{ kind: "message", text: "Правки оформления доступны только после оформления поста." }];
    }

    project.messages.push(message("formatting_edit", latestUserEdit));
    const revision = await unwrap(
      this.models.reviseFormatting({
        projectId: project.id,
        draftText: post.currentDraft,
        formattedText: post.formattedText,
        latestUserEdit,
        formattingOption: post.formattingOption
      })
    );

    if (revision.action === "route_to_draft") {
      project.state = "draft_editing";
      await this.projects.save(project);
      return this.reviseDraft(telegramUserId, revision.draftEditInstruction);
    }

    const rendered = applyFormattingPlan(post.currentDraft, revision.decorationPlan);
    if (!rendered.ok) {
      return [{ kind: "message", text: "\u041f\u0440\u0430\u0432\u043a\u0430 \u043e\u0444\u043e\u0440\u043c\u043b\u0435\u043d\u0438\u044f \u043d\u0435 \u043f\u0440\u043e\u0448\u043b\u0430 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0443 \u0441\u043e\u0445\u0440\u0430\u043d\u043d\u043e\u0441\u0442\u0438. \u0427\u0435\u0440\u043d\u043e\u0432\u0438\u043a \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d \u0431\u0435\u0437 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u0439." }];
    }

    post.formattedText = rendered.text;
    await this.projects.save(project);
    return [{ kind: "message", text: post.formattedText, buttons: finalButtons(project) }];
  }

  async finalizeCurrentPost(telegramUserId: TelegramUserId): Promise<BotResponse[]> {
    const project = await this.requireActive(telegramUserId);
    const post = currentPost(project);
    if (project.state !== "formatted_editing" || !post?.formattedText) {
      return [{ kind: "message", text: "Финал доступен после оформления." }];
    }

    project.state = "done";
    post.finalText = post.formattedText;
    project.messages.push(message("final", post.formattedText));
    await this.projects.save(project);

    return [
      { kind: "message", text: post.formattedText, buttons: nextPostButtons(project) },
      { kind: "document", filename: `post-${post.index}.txt`, content: post.formattedText, caption: "Текстовый артефакт поста" }
    ];
  }

  async startNextPost(telegramUserId: TelegramUserId): Promise<BotResponse[]> {
    const project = await this.requireActive(telegramUserId);
    if (project.state !== "done" || !project.selectedPlan || !project.currentPostIndex || !project.rewriteMode) {
      return [{ kind: "message", text: "Следующий пост доступен только после финализации текущего." }];
    }

    const nextIndex = (project.currentPostIndex + 1) as 1 | 2 | 3;
    if (nextIndex > project.selectedPlan.postCount) {
      return [{ kind: "message", text: "В серии больше нет постов." }];
    }

    project.currentPostIndex = nextIndex;
    if (this.jobs) {
      project.state = "draft_generating";
      await this.projects.save(project);
      try {
        await this.enqueueDraftGeneration(project);
      } catch {
        project.state = "rewrite_mode";
        await this.projects.save(project);
        return [{ kind: "message", text: "Не удалось запустить генерацию следующего черновика. Выберите режим переписывания ещё раз." }];
      }
      return [{ kind: "message", text: "Генерирую следующий черновик; пришлю его здесь, когда он будет готов." }];
    }

    const draft = await this.generateDraftForCurrentPost(project);
    await this.projects.save(project);
    return [{ kind: "message", text: draft, buttons: draftActionButtons() }];
  }

  async handleEditAudio(telegramUserId: TelegramUserId, source: SourceAudioInput): Promise<BotResponse[]> {
    const project = await this.requireActive(telegramUserId);
    if (!["planning", "draft_editing", "formatted_editing"].includes(project.state)) {
      return [{ kind: "message", text: "Voice-правка сейчас не ожидается." }];
    }
    if (this.jobs) {
      if (project.state === "formatted_editing") {
        return [{ kind: "message", text: "Голосовые правки оформления появятся на этапе оформления. Напишите правку текстом." }];
      }
      const stateAtEdit = project.state;
      await this.jobs.enqueue({
        type: "TRANSCRIBE_EDIT_AUDIO",
        projectId: project.id,
        dedupeKey: `project:${project.id}:edit-audio:${source.telegramFileId}`,
        payload: { source: { kind: "edit_audio", telegramFileId: source.telegramFileId, originalFileName: source.fileName, mimeType: source.mimeType, durationSeconds: source.durationSeconds, sizeBytes: source.sizeBytes }, stateAtEdit },
        maxAttempts: this.jobAttempts.editAudio ?? 3,
      });
      return [{ kind: "message", text: "Голосовая правка принята. Расшифровываю её и применю к текущему шагу." }];
    }

    const edit = await unwrap(
      this.models.transcribeEdit({
        projectId: project.id,
        stateAtEdit: project.state as "planning" | "draft_editing" | "formatted_editing",
        source
      })
    );
    if (project.state === "planning") return this.revisePlan(telegramUserId, edit.editText);
    if (project.state === "draft_editing") return this.reviseDraft(telegramUserId, edit.editText);
    return this.reviseFormatting(telegramUserId, edit.editText);
  }

  private async requireActive(telegramUserId: TelegramUserId): Promise<Project> {
    const project = await this.projects.findActiveByTelegramUser(telegramUserId);
    if (!project) throw new Error("No active project. Send /start first.");
    return project;
  }

  private async generateDraftForCurrentPost(project: Project): Promise<string> {
    if (!project.selectedPlan || !project.transcript || !project.currentPostIndex || !project.rewriteMode) {
      throw new Error("Cannot generate draft without selected plan, transcript, post index, and rewrite mode.");
    }
    const post = currentPost(project);
    if (!post) throw new Error("Current post not found.");
    const draft = await unwrap(
      this.models.generateDraft({
        projectId: project.id,
        selectedPlan: project.selectedPlan,
        postIndex: project.currentPostIndex,
        rewriteMode: project.rewriteMode,
        transcript: project.transcript,
        compactContext: recentEditMessages(project),
        outputLanguage: project.outputLanguage
      })
    );
    post.currentDraft = draft.draft.fullText;
    project.state = "draft_editing";
    project.messages.push(message("draft", post.currentDraft));
    return post.currentDraft;
  }

  private async enqueueDraftGeneration(project: Project): Promise<void> {
    if (!this.jobs || !project.currentPostIndex || !project.rewriteMode) {
      throw new Error("Cannot enqueue draft generation without job repository, post index, and rewrite mode.");
    }
    const post = currentPost(project);
    if (!post) throw new Error("Current post not found.");
    await this.jobs.enqueue({
      type: "GENERATE_DRAFT",
      projectId: project.id,
      postId: post.id,
      dedupeKey: `project:${project.id}:post:${project.currentPostIndex}:draft:${project.rewriteMode}`,
      payload: { postIndex: project.currentPostIndex, rewriteMode: project.rewriteMode }
    });
  }

  private async enqueueFormatting(project: Project, post: NonNullable<ReturnType<typeof currentPost>>, formattingOption: FormattingOption): Promise<void> {
    if (!this.jobs) throw new Error("Cannot enqueue formatting without job repository.");
    await this.jobs.enqueue({
      type: "FORMAT_POST",
      projectId: project.id,
      postId: post.id,
      dedupeKey: "project:" + project.id + ":post:" + post.index + ":format:" + formattingOption,
      payload: { postIndex: post.index, formattingOption }
    });
  }

  private async enqueueDraftRevision(project: Project, post: NonNullable<ReturnType<typeof currentPost>>, latestUserEdit: string): Promise<void> {
    if (!this.jobs) throw new Error("Cannot enqueue draft revision without job repository.");
    project.state = "draft_generating";
    await this.jobs.enqueue({
      type: "REVISE_DRAFT",
      projectId: project.id,
      postId: post.id,
      dedupeKey: `project:${project.id}:post:${post.index}:revise-draft:latest`,
      payload: { postIndex: post.index, latestUserEdit }
    });
  }
}

function message(kind: ProjectMessageKind, text: string) {
  return { kind, text, createdAt: new Date() };
}

function toAudioSourceMetadata(source: SourceAudioInput): AudioSourceMetadata {
  return {
    kind: "source_audio",
    telegramFileId: source.telegramFileId,
    originalFileName: source.fileName,
    mimeType: source.mimeType,
    durationSeconds: source.durationSeconds,
    sizeBytes: source.sizeBytes
  };
}

async function unwrap<T>(resultPromise: Promise<{ ok: true; value: T } | { ok: false; error: { message: string } }>): Promise<T> {
  const result = await resultPromise;
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function currentPost(project: Project) {
  return project.posts.find((post) => post.index === project.currentPostIndex);
}

function recentEditMessages(project: Project): string[] {
  return project.messages
    .filter((item) => item.kind.endsWith("edit"))
    .slice(-5)
    .map((item) => item.text);
}


function rewriteButtons() { return [{ label: "Почистить", action: "rewrite:clean_up" }, { label: "Сделать пост", action: "rewrite:make_post" }]; }
function formatButtons() { return [{ label: "Option 1", action: "format:option_1" }, { label: "Option 2", action: "format:option_2" }]; }
function finalButtons(project: Project) { const buttons = [{ label: "Готово", action: "final:accept" }]; const post = currentPost(project); if (post && project.selectedPlan && post.index < project.selectedPlan.postCount) buttons.push({ label: "Делать следующий пост", action: "series:next" }); return buttons; }
function nextPostButtons(project: Project) { const post = currentPost(project); return !post || !project.selectedPlan || post.index >= project.selectedPlan.postCount ? undefined : [{ label: "Делать следующий пост", action: "series:next" }]; }
