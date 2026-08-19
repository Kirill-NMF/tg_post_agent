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
import { applyFormattingPlan, applySegmentFormattingPlan, deriveCanonicalSegments, type CanonicalFormattingSegment, type SegmentFormattingOperation } from "../domain/formatting.js";
import { draftActionButtons } from "./draftPresentation.js";
import { finalActionButtons, formatChoiceButtons } from "./formatPresentation.js";
import { currentPlan } from "./planSplitJobHandler.js";
import { alternativePlanButtons, planButtons, renderAlternativePlansMessage, renderPlanRecommendationMessage } from "./planningPresentation.js";
import { noopLogger, type Logger } from "../observability/logger.js";
import { bindSourceProcess, parseBoundArtifactAction } from "./artifactCallback.js";

export type HistoricalCallbackInput = {
  telegramUserId: TelegramUserId;
  chatId: TelegramChatId;
  callbackQueryId: string;
  callbackMessageId: string;
  callbackMessageText?: string;
  replyToMessageText?: string;
  action: string;
};

export class ProjectService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly models: ModelAdapters,
    private readonly jobs?: JobRepository,
    private readonly jobAttempts: Partial<{ sourceAudio: number; editAudio: number; planRevision: number; draftGeneration: number; formatting: number }> = { sourceAudio: 3, editAudio: 3, planRevision: 3, draftGeneration: 3, formatting: 3 },
    private readonly formattingEnabled = false,
    private readonly logger: Logger = noopLogger
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
      sourceAudioParts: [],
      sourcePoolSealed: false,
      createdAt: now,
      updatedAt: now
    };
    await this.projects.save(project);
    return [{ kind: "message", text: "Пришлите voice, audio или audio-файл как источник для нового проекта." }];
  }

  async getActiveProject(telegramUserId: TelegramUserId): Promise<Project | undefined> {
    return this.projects.findActiveByTelegramUser(telegramUserId);
  }

  async handleHistoricalCallback(input: HistoricalCallbackInput): Promise<BotResponse[] | undefined> {
    if (!isHistoricalArtifactAction(input.action)) return undefined;
    if (!/^[A-Za-z0-9_-]{1,160}$/u.test(input.callbackQueryId) || !/^\d{1,20}$/u.test(input.callbackMessageId)) {
      return [{ kind: "message", text: "Историческое действие недоступно: некорректная привязка сообщения." }];
    }
    if (!await this.projects.claimCallback(input)) return [];
    try {
      const resolved = await resolveHistoricalArtifact(this.projects, input);
      if (!resolved) return [{ kind: "message", text: "Историческое действие недоступно: артефакт не найден или привязка неоднозначна.", replyToMessageId: input.callbackMessageId }];
      if (resolved.project.telegramUserId !== input.telegramUserId || resolved.project.chatId !== input.chatId) {
        return [{ kind: "message", text: "Историческое действие недоступно для этого пользователя или чата.", replyToMessageId: input.callbackMessageId }];
      }
      if (resolved.kind === "done") {
        return [{ kind: "document", filename: `post-${resolved.post.index}.txt`, content: resolved.post.finalText!, caption: "Готово.", replyToMessageId: input.callbackMessageId }];
      }

      const branch = createHistoricalBranch(resolved.project, input, "post" in resolved ? resolved.post : undefined);
      if (resolved.kind === "plan") {
        branch.transcript = resolved.project.transcript;
        branch.planOptions = resolved.project.planOptions?.map((option) => structuredClone(option));
        branch.planRecommendation = resolved.project.planRecommendation ? structuredClone(resolved.project.planRecommendation) : undefined;
        branch.selectedPlan = structuredClone(resolved.plan);
        branch.currentPostIndex = 1;
        branch.posts = resolved.plan.posts.map((slice) => ({ id: randomUUID(), index: slice.index, planSlice: structuredClone(slice) }));
        branch.state = "rewrite_mode";
        await this.projects.save(branch);
        await this.projects.activateProjectForUser(branch.id, input.telegramUserId);
        return [{ kind: "message", text: "Выберите режим переписывания.", buttons: rewriteButtons(), replyToMessageId: input.callbackMessageId }];
      }

      if (!resolved.post || !resolved.draftText) throw new Error("HISTORICAL_DRAFT_MISSING");
      const branchPost = branch.posts[0]!;
      branchPost.currentDraft = resolved.draftText;
      branchPost.draftVersion = resolved.draftVersion;
      if (resolved.kind === "open_format") {
        branch.state = "format_choice";
        await this.projects.save(branch);
        await this.projects.activateProjectForUser(branch.id, input.telegramUserId);
        return [{ kind: "message", text: "Выберите вариант оформления.", buttons: formatChoiceButtons({ projectId: branch.id, postIndex: branchPost.index, draftVersion: branchPost.draftVersion ?? 1 }), replyToMessageId: input.callbackMessageId }];
      }
      if (resolved.kind === "rerun") {
        branch.rewriteMode = resolved.rewriteMode;
        branch.state = "draft_generating";
        await this.projects.save(branch);
        await this.projects.activateProjectForUser(branch.id, input.telegramUserId);
        try { await this.enqueueDraftRerun(branch, branchPost, resolved.rewriteMode, resolved.draftVersion); }
        catch (error) { await this.projects.releaseCallback(input.callbackQueryId); throw error; }
        return [{ kind: "message", text: "Генерирую новый вариант по выбранному плану и исходной расшифровке.", replyToMessageId: input.callbackMessageId }];
      }
      branch.state = "formatting";
      await this.projects.save(branch);
      await this.projects.activateProjectForUser(branch.id, input.telegramUserId);
      try { await this.enqueueFormatting(branch, branchPost, resolved.formattingOption); }
      catch (error) { await this.projects.releaseCallback(input.callbackQueryId); throw error; }
      return [{ kind: "message", text: "Оформляю черновик; пришлю готовый текст.", replyToMessageId: input.callbackMessageId }];
    } catch (error) {
      await this.projects.releaseCallback(input.callbackQueryId);
      throw error;
    }
  }

  async submitSourceAudio(telegramUserId: TelegramUserId, source: SourceAudioInput): Promise<BotResponse[]> {
    const project = await this.requireActive(telegramUserId);
    if (source.telegramMessageId) {
      if (project.sourcePoolSealed || project.state === "transcribing") {
        return [{ kind: "message", text: "Набор источников уже запечатан и обрабатывается. Новое аудио в этот пакет не добавлено." }];
      }
      if (project.state !== "awaiting_audio") {
        return [{ kind: "message", text: "Сейчас исходные аудио не собираются. Продолжите текущий шаг или отправьте /start." }];
      }
      if (!/^\d{1,20}$/u.test(source.telegramMessageId)) return [{ kind: "message", text: "Не удалось привязать аудио к исходному сообщению." }];
      project.sourceAudioParts ??= [];
      if (!project.sourceAudioParts.some((part) => part.telegramMessageId === source.telegramMessageId)) {
        project.sourceAudioParts.push({ id: randomUUID(), telegramMessageId: source.telegramMessageId, source: { ...source }, status: "pending" });
        project.sourceAudioParts.sort((left, right) => compareTelegramMessageIds(left.telegramMessageId, right.telegramMessageId));
        project.messages.push(message("source_audio", source.telegramFileId));
        await this.projects.save(project);
      }
      const count = project.sourceAudioParts.length;
      return [{
        kind: "message", text: `Добавлено аудио: ${count}. Когда все источники собраны, нажмите «Начать обработку».`,
        buttons: [{ label: "Начать обработку", action: bindSourceProcess(project.id) }],
        ...(project.sourceCollectorMessageId ? { editMessageId: project.sourceCollectorMessageId } : { captureCollectorForProjectId: project.id })
      }];
    }
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

    return [{ kind: "message", text: renderPlanRecommendationMessage(plan), buttons: planButtons(plan, project.id) }];
  }

  async recordSourceCollectorMessage(telegramUserId: TelegramUserId, chatId: TelegramChatId, projectId: string, telegramMessageId: string): Promise<void> {
    if (!/^\d{1,20}$/u.test(telegramMessageId)) return;
    const project = await this.projects.findById(projectId);
    if (!project || project.telegramUserId !== telegramUserId || project.chatId !== chatId || project.sourceCollectorMessageId) return;
    project.sourceCollectorMessageId = telegramMessageId;
    await this.projects.save(project);
  }

  async startSourceProcessing(input: { telegramUserId: TelegramUserId; chatId: TelegramChatId; projectId: string; callbackQueryId: string; callbackMessageId: string }): Promise<BotResponse[]> {
    if (!await this.projects.claimCallback(input)) return [];
    try {
      const project = await this.projects.findById(input.projectId);
      if (!project || project.telegramUserId !== input.telegramUserId || project.chatId !== input.chatId || !project.isActive) {
        return [{ kind: "message", text: "Этот набор аудио недоступен.", replyToMessageId: input.callbackMessageId }];
      }
      const parts = project.sourceAudioParts ?? [];
      if (parts.length === 0) return [{ kind: "message", text: "Сначала добавьте хотя бы одно аудио.", replyToMessageId: input.callbackMessageId }];
      const processable = parts.filter((part) => !part.transcript && (part.status === "pending" || part.status === "failed"));
      if (project.sourcePoolSealed && processable.length === 0) return [{ kind: "message", text: "Этот набор уже обрабатывается.", replyToMessageId: input.callbackMessageId }];
      project.sourcePoolSealed = true;
      project.state = "transcribing";
      for (const part of processable) part.status = "transcribing";
      await this.projects.save(project);
      try {
        if (!this.jobs) throw new Error("SOURCE_POOL_JOBS_REQUIRED");
        for (const part of processable) {
          await this.jobs.enqueue({
            type: "TRANSCRIBE_AUDIO", projectId: project.id,
            dedupeKey: `project:${project.id}:source-part:${part.id}`,
            payload: { source: toAudioSourceMetadata(part.source), sourcePartId: part.id },
            maxAttempts: this.jobAttempts.sourceAudio ?? 3
          });
        }
      } catch (error) {
        for (const part of processable) part.status = "pending";
        project.sourcePoolSealed = false;
        project.state = "awaiting_audio";
        await this.projects.save(project);
        await this.projects.releaseCallback(input.callbackQueryId);
        throw error;
      }
      return [{ kind: "message", text: `Начинаю обработку ${processable.length} аудио. План появится после сохранения всех расшифровок.`, replyToMessageId: input.callbackMessageId }];
    } catch (error) {
      await this.projects.releaseCallback(input.callbackQueryId);
      throw error;
    }
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
    return [{ kind: "message", text: renderPlanRecommendationMessage(revised), buttons: planButtons(revised, project.id) }];
  }

  async showPlanAlternatives(telegramUserId: TelegramUserId): Promise<BotResponse[]> {
    const project = await this.requireActive(telegramUserId);
    const plan = currentPlan(project);
    if (project.state !== "planning" || !plan || plan.options.length < 2) {
      return [{ kind: "message", text: "Других осмысленных разбивок для этого материала нет." }];
    }
    project.planAlternativesRevealed = true;
    await this.projects.save(project);
    return [{ kind: "message", text: renderAlternativePlansMessage(plan), buttons: alternativePlanButtons(plan, project.id) }];
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
    if (project.state === "draft_generating") return [{ kind: "message", text: "Черновик уже генерируется. Дождитесь результата." }];
    if (project.state !== "rewrite_mode" || !project.selectedPlan || !project.transcript || !project.currentPostIndex) {
      return [{ kind: "message", text: "Режим можно выбрать после выбора плана." }];
    }

    project.rewriteMode = rewriteMode;
    if (this.jobs) {
      project.state = "draft_generating";
      await this.projects.save(project);
      try {
        await this.enqueueDraftGeneration(project);
      } catch (error) {
        recordDraftEnqueueFailure(this.logger, project.id, error);
        project.state = "rewrite_mode";
        await this.projects.save(project);
        return [{ kind: "message", text: "Не удалось запустить генерацию черновика. Выберите режим переписывания ещё раз." }];
      }
      return [{ kind: "message", text: "Режим выбран. Генерирую черновик; пришлю его здесь, когда он будет готов." }];
    }

    const draft = await this.generateDraftForCurrentPost(project);
    await this.projects.save(project);
    return [{ kind: "message", text: draft, buttons: draftActionButtons(this.formattingEnabled, currentPost(project)?.draftVersion, { projectId: project.id, postIndex: project.currentPostIndex ?? 1 }) }];
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
      project.state = "draft_generating";
      await this.projects.save(project);
      try {
        await this.enqueueDraftRevision(project, post, latestUserEdit);
      } catch {
        project.state = "draft_editing";
        await this.projects.save(project);
        return [{ kind: "message", text: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435 \u0447\u0435\u0440\u043d\u043e\u0432\u0438\u043a\u0430. \u0422\u0435\u043a\u0443\u0449\u0438\u0439 \u0447\u0435\u0440\u043d\u043e\u0432\u0438\u043a \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d." }];
      }
      return [{ kind: "message", text: "\u041f\u0440\u0438\u043d\u044f\u043b \u043f\u0440\u0430\u0432\u043a\u0443, \u043e\u0431\u043d\u043e\u0432\u043b\u044f\u044e \u0447\u0435\u0440\u043d\u043e\u0432\u0438\u043a." }];
    }

    const updated = await unwrap(
      this.models.reviseDraft({ projectId: project.id, currentDraft: post.currentDraft, latestUserEdit, compactContext: recentEditMessages(project), outputLanguage: project.outputLanguage })
    );
    post.currentDraft = updated.updatedDraft.fullText;
    post.draftVersion = nextDraftVersion(post);
    project.messages.push(message("draft", post.currentDraft));
    await this.projects.save(project);
    return [{ kind: "message", text: post.currentDraft, buttons: draftActionButtons(this.formattingEnabled, post.draftVersion, { projectId: project.id, postIndex: post.index }) }];
  }

  async rerunDraft(telegramUserId: TelegramUserId, rewriteMode: RewriteMode, sourceDraftVersion: number): Promise<BotResponse[]> {
    const project = await this.requireActive(telegramUserId);
    const post = currentPost(project);
    if (project.state === "draft_generating") return [{ kind: "message", text: "Новый черновик уже генерируется. Дождитесь результата." }];
    if (project.state !== "draft_editing" || !post?.currentDraft || !project.selectedPlan || !project.transcript || !project.rewriteMode) {
      return [{ kind: "message", text: "Генерация нового черновика доступна только для текущего черновика." }];
    }
    if (currentDraftVersion(post) !== sourceDraftVersion) return [{ kind: "message", text: "Эта кнопка устарела. Используйте кнопку под текущим черновиком." }];
    project.state = "draft_generating";
    await this.projects.save(project);
    try {
      await this.enqueueDraftRerun(project, post, rewriteMode, sourceDraftVersion);
    } catch {
      project.state = "draft_editing";
      await this.projects.save(project);
      return [{ kind: "message", text: "Не удалось запустить новый черновик. Текущий черновик сохранён; попробуйте ещё раз." }];
    }
    return [{ kind: "message", text: "Генерирую новый вариант по выбранному плану и исходной расшифровке." }];
  }

  async openFormatChoice(telegramUserId: TelegramUserId): Promise<BotResponse[]> {
    const project = await this.requireActive(telegramUserId);
    if (!this.formattingEnabled) return [{ kind: "message", text: "\u041e\u0444\u043e\u0440\u043c\u043b\u0435\u043d\u0438\u0435 \u043f\u043e\u043a\u0430 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e." }];
    if (project.state !== "draft_editing" || !currentPost(project)?.currentDraft) {
      return [{ kind: "message", text: "Оформление доступно после черновика." }];
    }
    project.state = "format_choice";
    await this.projects.save(project);
    const post = currentPost(project)!;
    return [{ kind: "message", text: "Выберите вариант оформления.", buttons: formatChoiceButtons({ projectId: project.id, postIndex: post.index, draftVersion: post.draftVersion ?? 1 }) }];
  }

  async formatCurrentPost(telegramUserId: TelegramUserId, formattingOption: FormattingOption): Promise<BotResponse[]> {
    const project = await this.requireActive(telegramUserId);
    if (!this.formattingEnabled) return [{ kind: "message", text: "\u041e\u0444\u043e\u0440\u043c\u043b\u0435\u043d\u0438\u0435 \u043f\u043e\u043a\u0430 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e." }];
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

    const option2Formatter = this.models as ModelAdapters & Partial<{
      formatOption2Segments(input: { projectId: string; draftText: string; segments: readonly CanonicalFormattingSegment[] }): Promise<{
        ok: true;
        value: { directives: SegmentFormattingOperation[] };
      } | { ok: false; error: { message: string } }>;
    }>;
    let formattedText: string | undefined;
    if (formattingOption === "option_2") {
      if (!option2Formatter.formatOption2Segments) {
        return [{ kind: "message", text: "Не удалось безопасно применить оформление. Черновик сохранён без изменений." }];
      }
      const segments = deriveCanonicalSegments(post.currentDraft);
      const result = await unwrap(option2Formatter.formatOption2Segments.call(option2Formatter, { projectId: project.id, draftText: post.currentDraft, segments }));
      const rendered = applySegmentFormattingPlan(post.currentDraft, "option_2", result.directives, segments);
      if (!rendered.ok) {
        return [{ kind: "message", text: "Не удалось безопасно применить оформление. Черновик сохранён без изменений." }];
      }
      formattedText = rendered.text;
    } else {
      const rendered = applyFormattingPlan(post.currentDraft, (await unwrap(this.models.formatPost({ projectId: project.id, draftText: post.currentDraft, formattingOption }))).decorationPlan);
      if (rendered.ok) formattedText = rendered.text;
    }
    if (!formattedText) {
      return [{ kind: "message", text: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0431\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u043e \u043f\u0440\u0438\u043c\u0435\u043d\u0438\u0442\u044c \u043e\u0444\u043e\u0440\u043c\u043b\u0435\u043d\u0438\u0435. \u0427\u0435\u0440\u043d\u043e\u0432\u0438\u043a \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d \u0431\u0435\u0437 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u0439." }];
    }

    post.formattedText = formattedText;
    post.formattingOption = formattingOption;
    project.state = "formatted_editing";
    await this.projects.save(project);
    return [{ kind: "message", text: post.formattedText, buttons: finalActionButtons(project) }];
  }

  async openFormattedCorrection(telegramUserId: TelegramUserId): Promise<BotResponse[]> {
    const project = await this.requireActive(telegramUserId);
    if (project.state !== "formatted_editing" || !currentPost(project)?.currentDraft) {
      return [{ kind: "message", text: "\u041f\u0440\u0430\u0432\u043a\u0438 \u043e\u0444\u043e\u0440\u043c\u043b\u0435\u043d\u0438\u044f \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b \u043d\u0430 \u0442\u0435\u043a\u0443\u0449\u0435\u043c \u0448\u0430\u0433\u0435." }];
    }
    return [{ kind: "message", text: "\u041e\u0442\u043f\u0440\u0430\u0432\u044c\u0442\u0435 \u043f\u0440\u0430\u0432\u043a\u0443 \u0442\u0435\u043a\u0441\u0442\u043e\u043c \u0438\u043b\u0438 \u0433\u043e\u043b\u043e\u0441\u043e\u0432\u044b\u043c \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435\u043c. \u042f \u0432\u0435\u0440\u043d\u0443\u0441\u044c \u043a \u0447\u0435\u0440\u043d\u043e\u0432\u0438\u043a\u0443 \u0438 \u043f\u043e\u0442\u043e\u043c \u043f\u0440\u0435\u0434\u043b\u043e\u0436\u0443 \u043e\u0444\u043e\u0440\u043c\u043b\u0435\u043d\u0438\u0435 \u0437\u0430\u043d\u043e\u0432\u043e." }];
  }

  async reviseFormatting(telegramUserId: TelegramUserId, latestUserEdit: string): Promise<BotResponse[]> {
    const project = await this.requireActive(telegramUserId);
    const post = currentPost(project);
    if (project.state !== "formatted_editing" || !post?.currentDraft) {
      return [{ kind: "message", text: "\u041f\u0440\u0430\u0432\u043a\u0438 \u043e\u0444\u043e\u0440\u043c\u043b\u0435\u043d\u0438\u044f \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b \u0442\u043e\u043b\u044c\u043a\u043e \u043f\u043e\u0441\u043b\u0435 \u0433\u043e\u0442\u043e\u0432\u043e\u0433\u043e \u043e\u0444\u043e\u0440\u043c\u043b\u0435\u043d\u0438\u044f." }];
    }

    project.state = "draft_editing";
    post.formattedText = undefined;
    post.formattingOption = undefined;
    await this.projects.save(project);
    return this.reviseDraft(telegramUserId, latestUserEdit);
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

    return [{ kind: "document", filename: "post-" + post.index + ".txt", content: post.formattedText, caption: "\u0422\u0435\u043a\u0441\u0442\u043e\u0432\u044b\u0439 \u0430\u0440\u0442\u0435\u0444\u0430\u043a\u0442 \u043f\u043e\u0441\u0442\u0430" }];
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
    return [{ kind: "message", text: draft, buttons: draftActionButtons(this.formattingEnabled, currentPost(project)?.draftVersion, { projectId: project.id, postIndex: project.currentPostIndex ?? 1 }) }];
  }

  async handleEditAudio(telegramUserId: TelegramUserId, source: SourceAudioInput): Promise<BotResponse[]> {
    const project = await this.requireActive(telegramUserId);
    if (!["planning", "draft_editing", "formatted_editing"].includes(project.state)) {
      return [{ kind: "message", text: "\u0413\u043e\u043b\u043e\u0441\u043e\u0432\u0430\u044f \u043f\u0440\u0430\u0432\u043a\u0430 \u0441\u0435\u0439\u0447\u0430\u0441 \u043d\u0435 \u043e\u0436\u0438\u0434\u0430\u0435\u0442\u0441\u044f." }];
    }
    if (this.jobs) {
      const stateAtEdit = project.state;
      const formattedPost = currentPost(project);
      const previousFormatting = stateAtEdit === "formatted_editing"
        ? { text: formattedPost?.formattedText, option: formattedPost?.formattingOption }
        : undefined;
      if (stateAtEdit === "formatted_editing") {
        project.state = "draft_generating";
        if (formattedPost) {
          formattedPost.formattedText = undefined;
          formattedPost.formattingOption = undefined;
        }
        await this.projects.save(project);
      }
      try {
        await this.jobs.enqueue({
          type: "TRANSCRIBE_EDIT_AUDIO",
          projectId: project.id,
          dedupeKey: "project:" + project.id + ":edit-audio:" + source.telegramFileId,
          payload: { source: { kind: "edit_audio", telegramFileId: source.telegramFileId, originalFileName: source.fileName, mimeType: source.mimeType, durationSeconds: source.durationSeconds, sizeBytes: source.sizeBytes }, stateAtEdit },
          maxAttempts: this.jobAttempts.editAudio ?? 3
        });
      } catch {
        if (stateAtEdit === "formatted_editing") {
          project.state = "formatted_editing";
          if (formattedPost) {
            formattedPost.formattedText = previousFormatting?.text;
            formattedPost.formattingOption = previousFormatting?.option;
          }
          await this.projects.save(project);
        }
        return [{ kind: "message", text: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u0440\u0438\u043d\u044f\u0442\u044c \u0433\u043e\u043b\u043e\u0441\u043e\u0432\u0443\u044e \u043f\u0440\u0430\u0432\u043a\u0443. \u0422\u0435\u043a\u0443\u0449\u0438\u0439 \u0447\u0435\u0440\u043d\u043e\u0432\u0438\u043a \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d." }];
      }
      return [{ kind: "message", text: "\u0413\u043e\u043b\u043e\u0441\u043e\u0432\u0430\u044f \u043f\u0440\u0430\u0432\u043a\u0430 \u043f\u0440\u0438\u043d\u044f\u0442\u0430. \u0420\u0430\u0441\u0448\u0438\u0444\u0440\u043e\u0432\u044b\u0432\u0430\u044e \u0435\u0451 \u0438 \u043f\u0440\u0438\u043c\u0435\u043d\u044e \u043a \u0442\u0435\u043a\u0443\u0449\u0435\u043c\u0443 \u0448\u0430\u0433\u0443." }];
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
    const draftVersion = nextDraftVersion(post);
    post.currentDraft = draft.draft.fullText;
    post.draftVersion = draftVersion;
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
      payload: { postIndex: project.currentPostIndex, rewriteMode: project.rewriteMode },
      maxAttempts: this.jobAttempts.draftGeneration ?? 3
    });
  }

  private async enqueueDraftRerun(project: Project, post: NonNullable<ReturnType<typeof currentPost>>, rewriteMode: RewriteMode, sourceDraftVersion: number): Promise<void> {
    if (!this.jobs) throw new Error("Cannot enqueue draft rerun without job repository.");
    await this.jobs.enqueue({
      type: "GENERATE_DRAFT", projectId: project.id, postId: post.id,
      dedupeKey: "project:" + project.id + ":post:" + post.index + ":rerun:" + rewriteMode + ":" + sourceDraftVersion,
      payload: { postIndex: post.index, rewriteMode, generationMode: "rerun", sourceDraftVersion },
      maxAttempts: this.jobAttempts.draftGeneration ?? 3
    });
  }

  private async enqueueFormatting(project: Project, post: NonNullable<ReturnType<typeof currentPost>>, formattingOption: FormattingOption): Promise<void> {
    if (!this.jobs) throw new Error("Cannot enqueue formatting without job repository.");
    await this.jobs.enqueue({
      type: "FORMAT_POST",
      projectId: project.id,
      postId: post.id,
      dedupeKey: "project:" + project.id + ":post:" + post.index + ":format:" + formattingOption,
      payload: { postIndex: post.index, formattingOption },
      maxAttempts: this.jobAttempts.formatting ?? 3
    });
  }

  private async enqueueDraftRevision(project: Project, post: NonNullable<ReturnType<typeof currentPost>>, latestUserEdit: string): Promise<void> {
    if (!this.jobs) throw new Error("Cannot enqueue draft revision without job repository.");
    await this.jobs.enqueue({
      type: "REVISE_DRAFT",
      projectId: project.id,
      postId: post.id,
      dedupeKey: `project:${project.id}:post:${post.index}:revise-draft:latest`,
      payload: { postIndex: post.index, latestUserEdit }
    });
  }
}
function recordDraftEnqueueFailure(logger: Logger, projectId: string, error: unknown): void {
  try {
    logger.warn(
      { event: "draft_generation_enqueue_failed", projectId, errorCategory: draftEnqueueFailureCategory(error) },
      "draft generation enqueue failed"
    );
  } catch {
    // Observability must never prevent the fail-closed recovery response.
  }
}

function draftEnqueueFailureCategory(error: unknown): "db_unique_conflict" | "db_constraint" | "db_connectivity" | "unknown" {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  if (code === "23505") return "db_unique_conflict";
  if (code === "23503" || code === "23514" || code === "22P02") return "db_constraint";
  if (typeof code === "string" && /^(ECONN|ETIMEDOUT)/.test(code)) return "db_connectivity";
  return "unknown";
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

function currentDraftVersion(post: NonNullable<ReturnType<typeof currentPost>>): number {
  return post.draftVersion ?? (post.currentDraft ? 1 : 0);
}

function nextDraftVersion(post: NonNullable<ReturnType<typeof currentPost>>): number {
  return currentDraftVersion(post) + 1;
}

function recentEditMessages(project: Project): string[] {
  return project.messages
    .filter((item) => item.kind.endsWith("edit"))
    .slice(-5)
    .map((item) => item.text);
}


function rewriteButtons() { return [{ label: "Почистить", action: "rewrite:clean_up" }, { label: "Сделать пост", action: "rewrite:make_post" }]; }
function compareTelegramMessageIds(left: string, right: string): number { return BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0; }

type HistoricalArtifact =
  | { kind: "plan"; project: Project; plan: NonNullable<Project["selectedPlan"]> }
  | { kind: "open_format"; project: Project; post: Project["posts"][number]; draftText: string; draftVersion: number }
  | { kind: "rerun"; project: Project; post: Project["posts"][number]; draftText: string; draftVersion: number; rewriteMode: RewriteMode }
  | { kind: "format"; project: Project; post: Project["posts"][number]; draftText: string; draftVersion: number; formattingOption: FormattingOption }
  | { kind: "done"; project: Project; post: Project["posts"][number] };

function isHistoricalArtifactAction(action: string): boolean {
  return action.startsWith("a:") || action.startsWith("plan:") || action === "format:open" || action.startsWith("draft:rerun:")
    || action === "format:option_1" || action === "format:option_2" || action === "final:accept";
}

async function resolveHistoricalArtifact(repository: ProjectRepository, input: HistoricalCallbackInput): Promise<HistoricalArtifact | undefined> {
  const bound = parseBoundArtifactAction(input.action);
  if (bound) {
    const project = await repository.findById(bound.projectId);
    if (!project) return undefined;
    if (bound.kind === "plan") {
      const plan = project.planOptions?.[bound.optionIndex];
      return plan && project.transcript ? { kind: "plan", project, plan } : undefined;
    }
    const post = project.posts.find((item) => item.index === bound.postIndex);
    if (!post) return undefined;
    if (bound.kind === "done") return post.finalText ? { kind: "done", project, post } : undefined;
    const draftText = input.replyToMessageText ?? input.callbackMessageText;
    const persisted = Boolean(draftText && (post.currentDraft === draftText || project.messages.some((item) => item.kind === "draft" && item.text === draftText)));
    if (!draftText || !persisted || (post.draftVersion ?? 1) < bound.draftVersion) return undefined;
    if (bound.kind === "open_format") return { kind: "open_format", project, post, draftText, draftVersion: bound.draftVersion };
    if (bound.kind === "rerun") return { kind: "rerun", project, post, draftText, draftVersion: bound.draftVersion, rewriteMode: bound.rewriteMode };
    return { kind: "format", project, post, draftText, draftVersion: bound.draftVersion, formattingOption: bound.formattingOption };
  }
  const projects = (await repository.findAllByTelegramUser(input.telegramUserId)).filter((project) => project.chatId === input.chatId);
  const planMatch = /^plan:(.+)$/u.exec(input.action);
  if (planMatch && planMatch[1] !== "show_alternatives") {
    const matches = projects.flatMap((project) => {
      if (!project.transcript || !project.planOptions || !project.planRecommendation || !input.callbackMessageText) return [];
      const rendered = [renderPlanRecommendationMessage({ options: project.planOptions, recommendation: project.planRecommendation }), renderAlternativePlansMessage({ options: project.planOptions, recommendation: project.planRecommendation })];
      if (!rendered.includes(input.callbackMessageText)) return [];
      const optionId = planMatch[1] === "recommended" ? project.planRecommendation.recommendedOptionId : planMatch[1];
      const plan = project.planOptions.find((option) => option.optionId === optionId);
      return plan ? [{ kind: "plan" as const, project, plan }] : [];
    });
    return unique(matches);
  }

  const rerun = /^draft:rerun:(clean_up|make_post):(\d+)$/u.exec(input.action);
  if (rerun) {
    const draftVersion = Number(rerun[2]);
    const match = unique(findDraftArtifacts(projects, input.callbackMessageText));
    return match ? { kind: "rerun", ...match, draftVersion, rewriteMode: rerun[1] as RewriteMode } : undefined;
  }
  if (input.action === "format:open") {
    const match = unique(findDraftArtifacts(projects, input.callbackMessageText));
    return match ? { kind: "open_format", ...match } : undefined;
  }
  if (input.action === "format:option_1" || input.action === "format:option_2") {
    const match = unique(findDraftArtifacts(projects, input.replyToMessageText));
    return match ? { kind: "format", ...match, formattingOption: input.action.endsWith("option_2") ? "option_2" : "option_1" } : undefined;
  }
  if (input.action === "final:accept" && input.callbackMessageText) {
    const matches = projects.flatMap((project) => project.posts.filter((post) => post.finalText === input.callbackMessageText || post.formattedText === input.callbackMessageText).map((post) => ({ kind: "done" as const, project, post })));
    return unique(matches);
  }
  return undefined;
}

function findDraftArtifacts(projects: Project[], text?: string): Array<{ project: Project; post: Project["posts"][number]; draftText: string; draftVersion: number }> {
  if (!text) return [];
  return projects.flatMap((project) => project.posts.flatMap((post) => {
    const persisted = post.currentDraft === text || project.messages.some((item) => item.kind === "draft" && item.text === text);
    return persisted ? [{ project, post, draftText: text, draftVersion: post.draftVersion ?? 1 }] : [];
  }));
}

function unique<T>(items: T[]): T | undefined { return items.length === 1 ? items[0] : undefined; }

function createHistoricalBranch(source: Project, input: HistoricalCallbackInput, sourcePost?: Project["posts"][number]): Project {
  const now = new Date();
  const selectedPlan = source.selectedPlan ? structuredClone(source.selectedPlan) : undefined;
  const planSlice = sourcePost?.planSlice ?? selectedPlan?.posts[0];
  return {
    id: randomUUID(), telegramUserId: input.telegramUserId, chatId: input.chatId, state: "rewrite_mode", isActive: false,
    transcript: source.transcript, outputLanguage: source.outputLanguage, planOptions: source.planOptions?.map((option) => structuredClone(option)),
    planRecommendation: source.planRecommendation ? structuredClone(source.planRecommendation) : undefined, selectedPlan,
    rewriteMode: source.rewriteMode, currentPostIndex: 1,
    posts: planSlice ? [{ id: randomUUID(), index: 1, planSlice: structuredClone(planSlice) }] : [], messages: [],
    parentProjectId: source.id, rootProjectId: source.rootProjectId ?? source.id, sourceProjectId: source.id,
    sourcePostId: sourcePost?.id, sourceDraftVersion: sourcePost?.draftVersion, sourceTelegramMessageId: input.callbackMessageId,
    branchCallbackQueryId: input.callbackQueryId, createdAt: now, updatedAt: now
  };
}
