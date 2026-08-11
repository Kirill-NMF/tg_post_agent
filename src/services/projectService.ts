import type { ModelAdapters } from "../domain/modelContracts.js";
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
import { InMemoryProjectRepository } from "../repositories/inMemoryProjectRepository.js";

export class ProjectService {
  constructor(
    private readonly projects: InMemoryProjectRepository,
    private readonly models: ModelAdapters
  ) {}

  start(telegramUserId: TelegramUserId, chatId: TelegramChatId): BotResponse[] {
    this.projects.deactivateActiveForUser(telegramUserId);
    const now = new Date();
    const project: Project = {
      id: `project_${telegramUserId}_${now.getTime()}`,
      telegramUserId,
      chatId,
      state: "awaiting_audio",
      isActive: true,
      posts: [],
      messages: [{ kind: "command", text: "/start", createdAt: now }],
      createdAt: now,
      updatedAt: now
    };
    this.projects.save(project);
    return [{ kind: "message", text: "Пришлите voice, audio или audio-файл как источник для нового проекта." }];
  }

  getActiveProject(telegramUserId: TelegramUserId): Project | undefined {
    return this.projects.findActiveByTelegramUser(telegramUserId);
  }

  async submitSourceAudio(telegramUserId: TelegramUserId, source: SourceAudioInput): Promise<BotResponse[]> {
    const project = this.requireActive(telegramUserId);
    if (project.state !== "awaiting_audio") {
      return [{ kind: "message", text: "Сейчас аудио-источник не ожидается. Продолжите текущий шаг или отправьте /start." }];
    }

    project.messages.push(message("source_audio", source.telegramFileId));
    const transcript = await unwrap(this.models.transcribeSource({ projectId: project.id, source }));
    project.transcript = transcript.transcript;

    const plan = await unwrap(this.models.planSplit({ projectId: project.id, transcript: project.transcript, planningHistory: [] }));
    project.planOptions = plan.options;
    project.state = "planning";
    project.messages.push(message("plan_options", renderPlanOptions(plan.options.map((option) => option.optionId))));
    this.projects.save(project);

    return [
      {
        kind: "message",
        text: renderPlanningScreen(plan.options.map((option) => ({ id: option.optionId, count: option.postCount, title: option.title }))),
        buttons: planButtons()
      }
    ];
  }

  async revisePlan(telegramUserId: TelegramUserId, latestUserEdit: string): Promise<BotResponse[]> {
    const project = this.requireActive(telegramUserId);
    if (project.state !== "planning" || !project.transcript || !project.planOptions) {
      return [{ kind: "message", text: "Правки плана доступны только на экране планирования." }];
    }

    project.messages.push(message("planning_edit", latestUserEdit));
    const revised = await unwrap(
      this.models.revisePlan({
        projectId: project.id,
        transcript: project.transcript,
        currentOptions: project.planOptions,
        latestUserEdit
      })
    );
    project.planOptions = revised.options;
    this.projects.save(project);
    return [{ kind: "message", text: "План обновлён. Выберите вариант 1/2/3.", buttons: planButtons() }];
  }

  async choosePlan(telegramUserId: TelegramUserId, optionId: PlanOptionId): Promise<BotResponse[]> {
    const project = this.requireActive(telegramUserId);
    if (project.state !== "planning" || !project.planOptions) {
      return [{ kind: "message", text: "Сначала нужен план из аудио." }];
    }

    const selectedPlan = project.planOptions.find((option) => option.optionId === optionId);
    if (!selectedPlan) {
      return [{ kind: "message", text: "Такого варианта плана нет. Выберите 1, 2 или 3." }];
    }

    project.selectedPlan = selectedPlan;
    project.currentPostIndex = 1;
    project.posts = selectedPlan.posts.map((slice) => ({ id: `${project.id}_post_${slice.index}`, index: slice.index, planSlice: slice }));
    project.state = "rewrite_mode";
    this.projects.save(project);
    return [{ kind: "message", text: "Выберите режим переписывания.", buttons: rewriteButtons() }];
  }

  async chooseRewriteMode(telegramUserId: TelegramUserId, rewriteMode: RewriteMode): Promise<BotResponse[]> {
    const project = this.requireActive(telegramUserId);
    if (project.state !== "rewrite_mode" || !project.selectedPlan || !project.transcript || !project.currentPostIndex) {
      return [{ kind: "message", text: "Режим можно выбрать после выбора плана." }];
    }

    project.rewriteMode = rewriteMode;
    const draft = await this.generateDraftForCurrentPost(project);
    this.projects.save(project);
    return [{ kind: "message", text: draft, buttons: [{ label: "Оформить", action: "format:open" }] }];
  }

  async reviseDraft(telegramUserId: TelegramUserId, latestUserEdit: string): Promise<BotResponse[]> {
    const project = this.requireActive(telegramUserId);
    const post = currentPost(project);
    if (project.state !== "draft_editing" || !post?.currentDraft) {
      return [{ kind: "message", text: "Правки черновика доступны только после генерации черновика." }];
    }

    project.messages.push(message("draft_edit", latestUserEdit));
    const updated = await unwrap(
      this.models.reviseDraft({ projectId: project.id, currentDraft: post.currentDraft, latestUserEdit, compactContext: recentEditMessages(project) })
    );
    post.currentDraft = updated.updatedDraft.fullText;
    project.messages.push(message("draft", post.currentDraft));
    this.projects.save(project);
    return [{ kind: "message", text: post.currentDraft, buttons: [{ label: "Оформить", action: "format:open" }] }];
  }

  openFormatChoice(telegramUserId: TelegramUserId): BotResponse[] {
    const project = this.requireActive(telegramUserId);
    if (project.state !== "draft_editing" || !currentPost(project)?.currentDraft) {
      return [{ kind: "message", text: "Оформление доступно после черновика." }];
    }
    project.state = "format_choice";
    this.projects.save(project);
    return [{ kind: "message", text: "Выберите вариант оформления.", buttons: formatButtons() }];
  }

  async formatCurrentPost(telegramUserId: TelegramUserId, formattingOption: FormattingOption): Promise<BotResponse[]> {
    const project = this.requireActive(telegramUserId);
    const post = currentPost(project);
    if (project.state !== "format_choice" || !post?.currentDraft) {
      return [{ kind: "message", text: "Сначала откройте оформление из черновика." }];
    }

    const formatted = await unwrap(this.models.formatPost({ projectId: project.id, draftText: post.currentDraft, formattingOption }));
    const preservation = await unwrap(this.models.checkPreservation({ projectId: project.id, draftText: post.currentDraft, formattedText: formatted.formattedText, formattingOption }));
    if (!preservation.passed) {
      return [{ kind: "message", text: "Mock preservation check не пропустил оформление. Попробуйте другой вариант." }];
    }

    post.formattedText = formatted.formattedText;
    post.formattingOption = formattingOption;
    project.state = "formatted_editing";
    this.projects.save(project);
    return [{ kind: "message", text: post.formattedText, buttons: finalButtons(project) }];
  }

  async reviseFormatting(telegramUserId: TelegramUserId, latestUserEdit: string): Promise<BotResponse[]> {
    const project = this.requireActive(telegramUserId);
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
      this.projects.save(project);
      return this.reviseDraft(telegramUserId, revision.draftEditInstruction);
    }

    const preservation = await unwrap(
      this.models.checkPreservation({ projectId: project.id, draftText: post.currentDraft, formattedText: revision.formattedText, formattingOption: post.formattingOption })
    );
    if (!preservation.passed) {
      return [{ kind: "message", text: "Правка оформления выглядит как изменение текста. Вернитесь к черновику." }];
    }

    post.formattedText = revision.formattedText;
    this.projects.save(project);
    return [{ kind: "message", text: post.formattedText, buttons: finalButtons(project) }];
  }

  finalizeCurrentPost(telegramUserId: TelegramUserId): BotResponse[] {
    const project = this.requireActive(telegramUserId);
    const post = currentPost(project);
    if (project.state !== "formatted_editing" || !post?.formattedText) {
      return [{ kind: "message", text: "Финал доступен после оформления." }];
    }

    project.state = "done";
    project.messages.push(message("final", post.formattedText));
    this.projects.save(project);

    return [
      { kind: "message", text: post.formattedText, buttons: nextPostButtons(project) },
      { kind: "document", filename: `post-${post.index}.txt`, content: post.formattedText, caption: "Текстовый артефакт поста" }
    ];
  }

  async startNextPost(telegramUserId: TelegramUserId): Promise<BotResponse[]> {
    const project = this.requireActive(telegramUserId);
    if (project.state !== "done" || !project.selectedPlan || !project.currentPostIndex || !project.rewriteMode) {
      return [{ kind: "message", text: "Следующий пост доступен только после финализации текущего." }];
    }

    const nextIndex = (project.currentPostIndex + 1) as 1 | 2 | 3;
    if (nextIndex > project.selectedPlan.postCount) {
      return [{ kind: "message", text: "В серии больше нет постов." }];
    }

    project.currentPostIndex = nextIndex;
    const draft = await this.generateDraftForCurrentPost(project);
    this.projects.save(project);
    return [{ kind: "message", text: draft, buttons: [{ label: "Оформить", action: "format:open" }] }];
  }

  async handleEditAudio(telegramUserId: TelegramUserId, source: SourceAudioInput): Promise<BotResponse[]> {
    const project = this.requireActive(telegramUserId);
    if (!["planning", "draft_editing", "formatted_editing"].includes(project.state)) {
      return [{ kind: "message", text: "Voice-правка сейчас не ожидается." }];
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

  private requireActive(telegramUserId: TelegramUserId): Project {
    const project = this.projects.findActiveByTelegramUser(telegramUserId);
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
        transcript: project.transcript
      })
    );
    post.currentDraft = draft.draft.fullText;
    project.state = "draft_editing";
    project.messages.push(message("draft", post.currentDraft));
    return post.currentDraft;
  }
}

function message(kind: ProjectMessageKind, text: string) {
  return { kind, text, createdAt: new Date() };
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

function planButtons() {
  return [
    { label: "1 пост", action: "plan:one_post" },
    { label: "2 поста", action: "plan:two_posts" },
    { label: "3 поста", action: "plan:three_posts" }
  ];
}

function rewriteButtons() {
  return [
    { label: "Почистить", action: "rewrite:clean_up" },
    { label: "Сделать пост", action: "rewrite:make_post" }
  ];
}

function formatButtons() {
  return [
    { label: "Option 1", action: "format:option_1" },
    { label: "Option 2", action: "format:option_2" }
  ];
}

function finalButtons(project: Project) {
  const buttons = [{ label: "Готово", action: "final:accept" }];
  const post = currentPost(project);
  if (post && project.selectedPlan && post.index < project.selectedPlan.postCount) {
    buttons.push({ label: "Делать следующий пост", action: "series:next" });
  }
  return buttons;
}

function nextPostButtons(project: Project) {
  const post = currentPost(project);
  if (!post || !project.selectedPlan || post.index >= project.selectedPlan.postCount) return undefined;
  return [{ label: "Делать следующий пост", action: "series:next" }];
}

function renderPlanOptions(ids: PlanOptionId[]): string {
  return ids.join(", ");
}

function renderPlanningScreen(options: Array<{ id: PlanOptionId; count: number; title: string }>): string {
  return options.map((option) => `${option.count}: ${option.title} (${option.id})`).join("\n");
}
