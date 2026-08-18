import { relations, sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const projectStateEnum = pgEnum("project_state", [
  "awaiting_audio",
  "transcribing",
  "planning",
  "rewrite_mode",
  "draft_generating",
  "draft_editing",
  "format_choice",
  "formatting",
  "formatted_editing",
  "done",
  "cancelled",
  "failed"
]);

export const rewriteModeEnum = pgEnum("rewrite_mode", ["clean_up", "make_post"]);
export const formattingOptionEnum = pgEnum("formatting_option", ["option_1", "option_2"]);
export const messageRoleEnum = pgEnum("message_role", ["user", "bot", "system", "model"]);
export const messageKindEnum = pgEnum("message_kind", [
  "command",
  "source_audio",
  "transcript",
  "planning_prompt",
  "planning_edit",
  "plan_options",
  "plan_selection",
  "rewrite_mode_selection",
  "draft",
  "draft_edit",
  "format_choice",
  "formatted_text",
  "formatting_edit",
  "final",
  "error",
  "progress"
]);
export const jobTypeEnum = pgEnum("job_type", [
  "TRANSCRIBE_AUDIO",
  "TRANSCRIBE_EDIT_AUDIO",
  "PLAN_SPLIT",
  "REVISE_PLAN",
  "GENERATE_DRAFT",
  "REVISE_DRAFT",
  "FORMAT_POST",
  "REVISE_FORMATTING",
  "GENERATE_TXT_ARTIFACT",
  "CLEANUP_TEMP_FILES"
]);
export const jobStatusEnum = pgEnum("job_status", ["queued", "running", "succeeded", "failed", "cancelled", "retry_scheduled"]);
export const artifactTypeEnum = pgEnum("artifact_type", ["final_txt", "final_message"]);
export const artifactStatusEnum = pgEnum("artifact_status", ["pending", "ready", "failed", "deleted"]);
export const modelProviderEnum = pgEnum("model_provider", ["whisper", "gemini", "claude", "gpt", "mock"]);

export const customEmojiSettings = pgTable("custom_emoji_settings", {
  scope: text("scope").primaryKey(),
  mappingsJson: jsonb("mappings_json").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    telegramUserId: bigint("telegram_user_id", { mode: "bigint" }).notNull().unique(),
    telegramUsername: text("telegram_username"),
    telegramFirstName: text("telegram_first_name"),
    telegramLastName: text("telegram_last_name"),
    isAllowed: boolean("is_allowed").notNull().default(true),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    lastSeenIdx: index("users_last_seen_at_idx").on(table.lastSeenAt)
  })
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    telegramChatId: bigint("telegram_chat_id", { mode: "bigint" }).notNull(),
    sourceMessageId: bigint("source_message_id", { mode: "bigint" }),
    isActive: boolean("is_active").notNull().default(true),
    activeState: projectStateEnum("active_state").notNull(),
    currentPostIndex: integer("current_post_index").notNull().default(1),
    postCount: integer("post_count"),
    transcript: text("transcript"),
    transcriptMetadataJson: jsonb("transcript_metadata_json"),
    planOptionsJson: jsonb("plan_options_json"),
    selectedPlanJson: jsonb("selected_plan_json"),
    rewriteMode: rewriteModeEnum("rewrite_mode"),
    formattingOption: formattingOptionEnum("formatting_option"),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    oneActivePerUserIdx: uniqueIndex("projects_one_active_per_user_idx").on(table.userId).where(sql`${table.isActive} = true`),
    userCreatedAtIdx: index("projects_user_created_at_idx").on(table.userId, table.createdAt),
    currentPostIndexCheck: check("projects_current_post_index_check", sql`${table.currentPostIndex} >= 1`),
    postCountCheck: check("projects_post_count_check", sql`${table.postCount} is null or ${table.postCount} between 1 and 3`)
  })
);

export const projectPosts = pgTable(
  "project_posts",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    index: integer("index").notNull(),
    planSliceJson: jsonb("plan_slice_json"),
    currentDraft: text("current_draft"),
    formattedText: text("formatted_text"),
    finalText: text("final_text"),
    rewriteMode: rewriteModeEnum("rewrite_mode"),
    formattingOption: formattingOptionEnum("formatting_option"),
    draftVersion: integer("draft_version").notNull().default(0),
    formattedVersion: integer("formatted_version").notNull().default(0),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    projectIndexUnique: uniqueIndex("project_posts_project_index_idx").on(table.projectId, table.index),
    indexCheck: check("project_posts_index_check", sql`${table.index} between 1 and 3`)
  })
);

export const projectMessages = pgTable(
  "project_messages",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    postId: uuid("post_id").references(() => projectPosts.id, { onDelete: "set null" }),
    telegramMessageId: bigint("telegram_message_id", { mode: "bigint" }),
    role: messageRoleEnum("role").notNull(),
    kind: messageKindEnum("kind").notNull(),
    text: text("text"),
    payloadJson: jsonb("payload_json"),
    modelProvider: modelProviderEnum("model_provider"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    projectCreatedAtIdx: index("project_messages_project_created_at_idx").on(table.projectId, table.createdAt),
    postCreatedAtIdx: index("project_messages_post_created_at_idx").on(table.postId, table.createdAt),
    kindCreatedAtIdx: index("project_messages_kind_created_at_idx").on(table.kind, table.createdAt)
  })
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey(),
    type: jobTypeEnum("type").notNull(),
    status: jobStatusEnum("status").notNull().default("queued"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    postId: uuid("post_id").references(() => projectPosts.id, { onDelete: "cascade" }),
    dedupeKey: text("dedupe_key"),
    payloadJson: jsonb("payload_json").notNull(),
    resultJson: jsonb("result_json"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    claimIdx: index("jobs_claim_idx").on(table.status, table.runAfter, table.createdAt),
    projectCreatedAtIdx: index("jobs_project_created_at_idx").on(table.projectId, table.createdAt),
    activeDedupeIdx: uniqueIndex("jobs_active_dedupe_key_idx")
      .on(table.dedupeKey)
      .where(sql`${table.dedupeKey} is not null and ${table.status} in ('queued', 'running', 'retry_scheduled')`),
    attemptsCheck: check("jobs_attempts_check", sql`${table.attempts} >= 0`),
    maxAttemptsCheck: check("jobs_max_attempts_check", sql`${table.maxAttempts} >= 1`)
  })
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    postId: uuid("post_id").references(() => projectPosts.id, { onDelete: "set null" }),
    type: artifactTypeEnum("type").notNull(),
    status: artifactStatusEnum("status").notNull().default("pending"),
    telegramMessageId: bigint("telegram_message_id", { mode: "bigint" }),
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    contentText: text("content_text"),
    storagePath: text("storage_path"),
    checksumSha256: text("checksum_sha256"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    projectCreatedAtIdx: index("artifacts_project_created_at_idx").on(table.projectId, table.createdAt),
    postTypeIdx: index("artifacts_post_type_idx").on(table.postId, table.type),
    statusCreatedAtIdx: index("artifacts_status_created_at_idx").on(table.status, table.createdAt)
  })
);

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects)
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, { fields: [projects.userId], references: [users.id] }),
  posts: many(projectPosts),
  messages: many(projectMessages),
  jobs: many(jobs),
  artifacts: many(artifacts)
}));

export const projectPostsRelations = relations(projectPosts, ({ one, many }) => ({
  project: one(projects, { fields: [projectPosts.projectId], references: [projects.id] }),
  messages: many(projectMessages),
  jobs: many(jobs),
  artifacts: many(artifacts)
}));
