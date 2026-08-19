import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import type { AppDb } from "../db/connection.js";
import type {
  FormattingOption,
  OutputLanguage,
  PlanOption,
  PlanPostSlice,
  PlanRecommendation,
  Project,
  ProjectId,
  ProjectMessage,
  ProjectMessageKind,
  ProjectPost,
  ProjectState,
  RewriteMode,
  TelegramUserId
} from "../domain/types.js";
import type { ProjectRepository } from "./projectRepository.js";

type ProjectRow = {
  id: string;
  telegram_user_id: bigint;
  telegram_chat_id: bigint;
  is_active: boolean;
  active_state: ProjectState;
  current_post_index: number;
  post_count: number | null;
  transcript: string | null;
  plan_options_json: unknown;
  selected_plan_json: unknown;
  rewrite_mode: RewriteMode | null;
  formatting_option: FormattingOption | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date;
  parent_project_id: string | null;
  root_project_id: string | null;
  source_project_id: string | null;
  source_post_id: string | null;
  source_draft_version: number | null;
  source_telegram_message_id: bigint | null;
  branch_callback_query_id: string | null;
  source_audio_parts_json: unknown;
  source_pool_sealed: boolean;
  source_collector_message_id: bigint | null;
};

type PostRow = {
  id: string;
  index: number;
  plan_slice_json: unknown;
  current_draft: string | null;
  formatted_text: string | null;
  final_text: string | null;
  rewrite_mode: RewriteMode | null;
  formatting_option: FormattingOption | null;
  draft_version: number;
  formatted_version: number;
};

type MessageRow = {
  kind: ProjectMessageKind;
  text: string | null;
  created_at: Date;
};

type SqlExecutor = {
  execute(query: SQL): Promise<unknown>;
};

export class PgProjectRepository implements ProjectRepository {
  constructor(private readonly db: AppDb) {}

  async save(project: Project): Promise<Project> {
    const now = new Date();
    project.updatedAt = now;

    await this.db.transaction(async (tx) => {
      const userId = await upsertUser(tx, project.telegramUserId);

      await tx.execute(sql`
        insert into projects (
          id, user_id, telegram_chat_id, is_active, active_state, current_post_index,
          post_count, transcript, plan_options_json, selected_plan_json, rewrite_mode,
          formatting_option, completed_at, cancelled_at, created_at, updated_at,
          parent_project_id, root_project_id, source_project_id, source_post_id,
          source_draft_version, source_telegram_message_id, branch_callback_query_id,
          source_audio_parts_json, source_pool_sealed, source_collector_message_id
        )
        values (
          ${project.id}, ${userId}, ${toDbBigInt(project.chatId)}, ${project.isActive},
          ${toStoredState(project.state)}, ${project.currentPostIndex ?? 1}, ${project.selectedPlan?.postCount ?? null},
          ${project.transcript ?? null}, ${toJson(planPayload(project))}, ${toJson(project.selectedPlan)},
          ${project.rewriteMode ?? null}, ${currentFormattingOption(project)}, ${completedAt(project)},
          ${project.isActive ? null : now}, ${project.createdAt}, ${project.updatedAt},
          ${project.parentProjectId ?? null}, ${project.rootProjectId ?? null}, ${project.sourceProjectId ?? null},
          ${project.sourcePostId ?? null}, ${project.sourceDraftVersion ?? null},
          ${project.sourceTelegramMessageId ? toDbBigInt(project.sourceTelegramMessageId) : null}, ${project.branchCallbackQueryId ?? null},
          ${toJson(project.sourceAudioParts)}, ${project.sourcePoolSealed === true},
          ${project.sourceCollectorMessageId ? toDbBigInt(project.sourceCollectorMessageId) : null}
        )
        on conflict (id) do update set
          telegram_chat_id = excluded.telegram_chat_id,
          is_active = excluded.is_active,
          active_state = excluded.active_state,
          current_post_index = excluded.current_post_index,
          post_count = excluded.post_count,
          transcript = excluded.transcript,
          plan_options_json = excluded.plan_options_json,
          selected_plan_json = excluded.selected_plan_json,
          rewrite_mode = excluded.rewrite_mode,
          formatting_option = excluded.formatting_option,
          completed_at = excluded.completed_at,
          cancelled_at = excluded.cancelled_at,
          parent_project_id = excluded.parent_project_id,
          root_project_id = excluded.root_project_id,
          source_project_id = excluded.source_project_id,
          source_post_id = excluded.source_post_id,
          source_draft_version = excluded.source_draft_version,
          source_telegram_message_id = excluded.source_telegram_message_id,
          branch_callback_query_id = excluded.branch_callback_query_id,
          source_audio_parts_json = excluded.source_audio_parts_json,
          source_pool_sealed = excluded.source_pool_sealed,
          source_collector_message_id = excluded.source_collector_message_id,
          updated_at = excluded.updated_at
      `);

      await tx.execute(sql`delete from artifacts where project_id = ${project.id}`);
      await tx.execute(sql`delete from project_messages where project_id = ${project.id}`);
      for (const post of project.posts) {
        await tx.execute(sql`
          insert into project_posts (
            id, project_id, index, plan_slice_json, current_draft, formatted_text,
            final_text, rewrite_mode, formatting_option, draft_version,
            formatted_version, finalized_at, created_at, updated_at
          )
          values (
            ${post.id}, ${project.id}, ${post.index}, ${toJson(post.planSlice)},
            ${post.currentDraft ?? null}, ${post.formattedText ?? null}, ${post.finalText ?? null},
            ${project.rewriteMode ?? null}, ${post.formattingOption ?? null},
            ${post.draftVersion ?? (post.currentDraft ? 1 : 0)}, ${post.formattedText ? 1 : 0},
            ${post.finalText ? now : null}, ${project.createdAt}, ${project.updatedAt}
          )
          on conflict (id) do update set
            index = excluded.index,
            plan_slice_json = excluded.plan_slice_json,
            current_draft = excluded.current_draft,
            formatted_text = excluded.formatted_text,
            final_text = excluded.final_text,
            rewrite_mode = excluded.rewrite_mode,
            formatting_option = excluded.formatting_option,
            draft_version = excluded.draft_version,
            formatted_version = excluded.formatted_version,
            finalized_at = excluded.finalized_at,
            updated_at = excluded.updated_at
          where project_posts.project_id = excluded.project_id
        `);

        if (post.finalText) {
          await tx.execute(sql`
            insert into artifacts (
              id, project_id, post_id, type, status, file_name, mime_type,
              size_bytes, content_text, created_at, updated_at
            )
            values (
              ${randomUUID()}, ${project.id}, ${post.id}, 'final_txt', 'ready',
              ${`post-${post.index}.txt`}, 'text/plain', ${Buffer.byteLength(post.finalText, "utf8")},
              ${post.finalText}, ${now}, ${now}
            )
          `);
        }
      }

      await deleteStalePosts(tx, project.id, project.posts.map((post) => post.id));

      for (const item of project.messages) {
        await tx.execute(sql`
          insert into project_messages (id, project_id, role, kind, text, created_at)
          values (${randomUUID()}, ${project.id}, ${roleForMessage(item.kind)}, ${item.kind}, ${item.text}, ${item.createdAt})
        `);
      }
    });

    return (await this.findById(project.id)) ?? project;
  }

  async findActiveByTelegramUser(telegramUserId: TelegramUserId): Promise<Project | undefined> {
    const rows = rowsOf<ProjectRow>(
      await this.db.execute(sql`
        select p.*, u.telegram_user_id
        from projects p
        join users u on u.id = p.user_id
        where u.telegram_user_id = ${toDbBigInt(telegramUserId)}
          and p.is_active = true
        limit 1
      `)
    );
    return rows[0] ? this.hydrate(rows[0]) : undefined;
  }

  async deactivateActiveForUser(telegramUserId: TelegramUserId, options?: { preserveState?: boolean }): Promise<void> {
    if (options?.preserveState) {
      await this.db.execute(sql`
        update projects set is_active = false, updated_at = now()
        where user_id = (select id from users where telegram_user_id = ${toDbBigInt(telegramUserId)}) and is_active = true
      `);
      return;
    }
    await this.db.execute(sql`
      update projects
      set is_active = false,
          active_state = 'cancelled',
          cancelled_at = now(),
          updated_at = now()
      where user_id = (select id from users where telegram_user_id = ${toDbBigInt(telegramUserId)})
        and is_active = true
    `);
  }

  async activateProjectForUser(projectId: ProjectId, telegramUserId: TelegramUserId): Promise<void> {
    await this.db.transaction(async (tx) => {
      const owned = rowsOf<{ id: string }>(await tx.execute(sql`
        select p.id from projects p join users u on u.id = p.user_id
        where p.id = ${projectId} and u.telegram_user_id = ${toDbBigInt(telegramUserId)} for update
      `));
      if (owned.length !== 1) throw new Error("PROJECT_ACTIVATION_SCOPE_INVALID");
      await tx.execute(sql`
        update projects set is_active = false, updated_at = now()
        where user_id = (select id from users where telegram_user_id = ${toDbBigInt(telegramUserId)}) and is_active = true
      `);
      await tx.execute(sql`update projects set is_active = true, cancelled_at = null, updated_at = now() where id = ${projectId}`);
    });
  }

  async findById(projectId: ProjectId): Promise<Project | undefined> {
    const rows = rowsOf<ProjectRow>(
      await this.db.execute(sql`
        select p.*, u.telegram_user_id
        from projects p
        join users u on u.id = p.user_id
        where p.id = ${projectId}
        limit 1
      `)
    );
    return rows[0] ? this.hydrate(rows[0]) : undefined;
  }

  async findAllByTelegramUser(telegramUserId: TelegramUserId): Promise<Project[]> {
    const rows = rowsOf<ProjectRow>(await this.db.execute(sql`
      select p.*, u.telegram_user_id from projects p join users u on u.id = p.user_id
      where u.telegram_user_id = ${toDbBigInt(telegramUserId)} order by p.created_at desc
    `));
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  async findByBranchCallbackQueryId(callbackQueryId: string): Promise<Project | undefined> {
    const rows = rowsOf<ProjectRow>(await this.db.execute(sql`
      select p.*, u.telegram_user_id from projects p join users u on u.id = p.user_id
      where p.branch_callback_query_id = ${callbackQueryId} limit 1
    `));
    return rows[0] ? this.hydrate(rows[0]) : undefined;
  }

  async claimCallback(input: { callbackQueryId: string; telegramUserId: TelegramUserId; chatId: string }): Promise<boolean> {
    const rows = rowsOf<{ callback_query_id: string }>(await this.db.execute(sql`
      insert into callback_actions (callback_query_id, telegram_user_id, telegram_chat_id)
      values (${input.callbackQueryId}, ${toDbBigInt(input.telegramUserId)}, ${toDbBigInt(input.chatId)})
      on conflict (callback_query_id) do nothing returning callback_query_id
    `));
    return rows.length === 1;
  }

  async releaseCallback(callbackQueryId: string): Promise<void> {
    await this.db.execute(sql`delete from callback_actions where callback_query_id = ${callbackQueryId}`);
  }

  private async hydrate(row: ProjectRow): Promise<Project> {
    const posts = rowsOf<PostRow>(
      await this.db.execute(sql`
        select *
        from project_posts
        where project_id = ${row.id}
        order by index
      `)
    ).map(fromPostRow);

    const messages = rowsOf<MessageRow>(
      await this.db.execute(sql`
        select kind, text, created_at
        from project_messages
        where project_id = ${row.id}
        order by created_at, id
      `)
    ).map(fromMessageRow);

    const planning = readPlanPayload(row.plan_options_json);
    return {
      id: row.id,
      telegramUserId: row.telegram_user_id.toString(),
      chatId: row.telegram_chat_id.toString(),
      state: row.active_state,
      isActive: row.is_active,
      transcript: row.transcript ?? undefined,
      outputLanguage: planning.outputLanguage,
      planOptions: planning.options,
      planRecommendation: planning.recommendation,
      planAlternativesRevealed: planning.alternativesRevealed,
      selectedPlan: asPlanOption(row.selected_plan_json),
      rewriteMode: row.rewrite_mode ?? undefined,
      posts,
      currentPostIndex: toPostIndex(row.current_post_index),
      messages,
      createdAt: row.created_at,
      updatedAt: row.updated_at
      ,parentProjectId: row.parent_project_id ?? undefined
      ,rootProjectId: row.root_project_id ?? undefined
      ,sourceProjectId: row.source_project_id ?? undefined
      ,sourcePostId: row.source_post_id ?? undefined
      ,sourceDraftVersion: row.source_draft_version ?? undefined
      ,sourceTelegramMessageId: row.source_telegram_message_id?.toString()
      ,branchCallbackQueryId: row.branch_callback_query_id ?? undefined
      ,sourceAudioParts: Array.isArray(row.source_audio_parts_json) ? row.source_audio_parts_json as Project["sourceAudioParts"] : undefined
      ,sourcePoolSealed: row.source_pool_sealed
      ,sourceCollectorMessageId: row.source_collector_message_id?.toString()
    };
  }
}

async function deleteStalePosts(tx: SqlExecutor, projectId: ProjectId, retainedPostIds: string[]): Promise<void> {
  if (retainedPostIds.length === 0) {
    await tx.execute(sql`delete from project_posts where project_id = ${projectId}`);
    return;
  }

  await tx.execute(sql`
    delete from project_posts
    where project_id = ${projectId}
      and id not in (${sql.join(retainedPostIds.map((id) => sql`${id}`), sql`, `)})
  `);
}

async function upsertUser(tx: SqlExecutor, telegramUserId: TelegramUserId): Promise<string> {
  const rows = rowsOf<{ id: string }>(
    await tx.execute(sql`
      insert into users (id, telegram_user_id, is_allowed, last_seen_at, created_at, updated_at)
      values (${randomUUID()}, ${toDbBigInt(telegramUserId)}, true, now(), now(), now())
      on conflict (telegram_user_id) do update set
        is_allowed = true,
        last_seen_at = now(),
        updated_at = now()
      returning id
    `)
  );
  return rows[0]?.id ?? "";
}

function rowsOf<T>(result: unknown): T[] {
  return (result as { rows?: T[] }).rows ?? [];
}

function toDbBigInt(value: string): bigint {
  if (!/^-?\d{1,20}$/.test(value)) throw new Error("Telegram ids must be numeric strings before persistence.");
  return BigInt(value);
}

function toJson(value: unknown): SQL | null {
  if (value === undefined) return null;
  return sql`${JSON.stringify(value)}::jsonb`;
}

function toStoredState(state: ProjectState): Exclude<ProjectState, "idle"> {
  if (state === "idle") return "cancelled";
  return state;
}

function completedAt(project: Project): Date | null {
  return project.state === "done" && project.posts.every((post) => Boolean(post.finalText)) ? project.updatedAt : null;
}

function currentFormattingOption(project: Project): FormattingOption | null {
  return project.posts.find((post) => post.index === project.currentPostIndex)?.formattingOption ?? null;
}

function fromPostRow(row: PostRow): ProjectPost {
  return {
    id: row.id,
    index: toPostIndex(row.index),
    planSlice: asPlanSlice(row.plan_slice_json),
    currentDraft: row.current_draft ?? undefined,
    formattedText: row.formatted_text ?? undefined,
    finalText: row.final_text ?? undefined,
    formattingOption: row.formatting_option ?? undefined,
    draftVersion: row.draft_version
  };
}

function fromMessageRow(row: MessageRow): ProjectMessage {
  return { kind: row.kind, text: row.text ?? "", createdAt: row.created_at };
}

function planPayload(project: Project): unknown {
  if (!project.planRecommendation) return project.planOptions;
  return { options: project.planOptions ?? [], recommendation: project.planRecommendation, alternativesRevealed: project.planAlternativesRevealed === true, outputLanguage: project.outputLanguage };
}

function readPlanPayload(value: unknown): { options?: PlanOption[]; recommendation?: PlanRecommendation; alternativesRevealed?: boolean; outputLanguage?: OutputLanguage } {
  if (!value) return {};
  if (Array.isArray(value)) return { options: value as PlanOption[] };
  if (typeof value !== "object") return {};
  const record = value as { options?: unknown; recommendation?: unknown; alternativesRevealed?: unknown; outputLanguage?: unknown };
  return {
    options: Array.isArray(record.options) ? record.options as PlanOption[] : undefined,
    recommendation: record.recommendation && typeof record.recommendation === "object" ? record.recommendation as PlanRecommendation : undefined,
    alternativesRevealed: record.alternativesRevealed === true,
    outputLanguage: typeof record.outputLanguage === "string" ? record.outputLanguage as OutputLanguage : undefined
  };
}

function asPlanOption(value: unknown): PlanOption | undefined {
  if (!value) return undefined;
  return value as PlanOption;
}

function asPlanSlice(value: unknown): PlanPostSlice {
  return value as PlanPostSlice;
}

function toPostIndex(value: number): 1 | 2 | 3 {
  if (value !== 1 && value !== 2 && value !== 3) throw new Error("Post index out of domain range.");
  return value;
}

function roleForMessage(kind: ProjectMessageKind): "user" | "bot" | "system" | "model" {
  if (kind === "planning_edit" || kind === "draft_edit" || kind === "formatting_edit" || kind === "command" || kind === "source_audio") return "user";
  if (kind === "plan_options" || kind === "draft" || kind === "formatted_text") return "model";
  return "bot";
}
