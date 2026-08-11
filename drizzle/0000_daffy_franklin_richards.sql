CREATE TYPE "public"."artifact_status" AS ENUM('pending', 'ready', 'failed', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."artifact_type" AS ENUM('final_txt', 'final_message');--> statement-breakpoint
CREATE TYPE "public"."formatting_option" AS ENUM('option_1', 'option_2');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled', 'retry_scheduled');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('TRANSCRIBE_AUDIO', 'PLAN_SPLIT', 'REVISE_PLAN', 'GENERATE_DRAFT', 'REVISE_DRAFT', 'FORMAT_POST', 'REVISE_FORMATTING', 'GENERATE_TXT_ARTIFACT', 'CLEANUP_TEMP_FILES');--> statement-breakpoint
CREATE TYPE "public"."message_kind" AS ENUM('command', 'source_audio', 'transcript', 'planning_prompt', 'planning_edit', 'plan_options', 'plan_selection', 'rewrite_mode_selection', 'draft', 'draft_edit', 'format_choice', 'formatted_text', 'formatting_edit', 'final', 'error', 'progress');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'bot', 'system', 'model');--> statement-breakpoint
CREATE TYPE "public"."model_provider" AS ENUM('whisper', 'gemini', 'claude', 'gpt', 'mock');--> statement-breakpoint
CREATE TYPE "public"."project_state" AS ENUM('awaiting_audio', 'transcribing', 'planning', 'rewrite_mode', 'draft_generating', 'draft_editing', 'format_choice', 'formatting', 'formatted_editing', 'done', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."rewrite_mode" AS ENUM('clean_up', 'make_post');--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"post_id" uuid,
	"type" "artifact_type" NOT NULL,
	"status" "artifact_status" DEFAULT 'pending' NOT NULL,
	"telegram_message_id" bigint,
	"file_name" text,
	"mime_type" text,
	"size_bytes" integer,
	"content_text" text,
	"storage_path" text,
	"checksum_sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" "job_type" NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"project_id" uuid,
	"post_id" uuid,
	"dedupe_key" text,
	"payload_json" jsonb NOT NULL,
	"result_json" jsonb,
	"error_code" text,
	"error_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_attempts_check" CHECK ("jobs"."attempts" >= 0),
	CONSTRAINT "jobs_max_attempts_check" CHECK ("jobs"."max_attempts" >= 1)
);
--> statement-breakpoint
CREATE TABLE "project_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"post_id" uuid,
	"telegram_message_id" bigint,
	"role" "message_role" NOT NULL,
	"kind" "message_kind" NOT NULL,
	"text" text,
	"payload_json" jsonb,
	"model_provider" "model_provider",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"plan_slice_json" jsonb,
	"current_draft" text,
	"formatted_text" text,
	"final_text" text,
	"rewrite_mode" "rewrite_mode",
	"formatting_option" "formatting_option",
	"draft_version" integer DEFAULT 0 NOT NULL,
	"formatted_version" integer DEFAULT 0 NOT NULL,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_posts_index_check" CHECK ("project_posts"."index" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"telegram_chat_id" bigint NOT NULL,
	"source_message_id" bigint,
	"is_active" boolean DEFAULT true NOT NULL,
	"active_state" "project_state" NOT NULL,
	"current_post_index" integer DEFAULT 1 NOT NULL,
	"post_count" integer,
	"transcript" text,
	"transcript_metadata_json" jsonb,
	"plan_options_json" jsonb,
	"selected_plan_json" jsonb,
	"rewrite_mode" "rewrite_mode",
	"formatting_option" "formatting_option",
	"last_error_code" text,
	"last_error_message" text,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_current_post_index_check" CHECK ("projects"."current_post_index" >= 1),
	CONSTRAINT "projects_post_count_check" CHECK ("projects"."post_count" is null or "projects"."post_count" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"telegram_user_id" bigint NOT NULL,
	"telegram_username" text,
	"telegram_first_name" text,
	"telegram_last_name" text,
	"is_allowed" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_telegram_user_id_unique" UNIQUE("telegram_user_id")
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_post_id_project_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."project_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_post_id_project_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."project_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_messages" ADD CONSTRAINT "project_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_messages" ADD CONSTRAINT "project_messages_post_id_project_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."project_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_posts" ADD CONSTRAINT "project_posts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifacts_project_created_at_idx" ON "artifacts" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "artifacts_post_type_idx" ON "artifacts" USING btree ("post_id","type");--> statement-breakpoint
CREATE INDEX "artifacts_status_created_at_idx" ON "artifacts" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","run_after","created_at");--> statement-breakpoint
CREATE INDEX "jobs_project_created_at_idx" ON "jobs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_active_dedupe_key_idx" ON "jobs" USING btree ("dedupe_key") WHERE "jobs"."dedupe_key" is not null and "jobs"."status" in ('queued', 'running', 'retry_scheduled');--> statement-breakpoint
CREATE INDEX "project_messages_project_created_at_idx" ON "project_messages" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "project_messages_post_created_at_idx" ON "project_messages" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE INDEX "project_messages_kind_created_at_idx" ON "project_messages" USING btree ("kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_posts_project_index_idx" ON "project_posts" USING btree ("project_id","index");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_one_active_per_user_idx" ON "projects" USING btree ("user_id") WHERE "projects"."is_active" = true;--> statement-breakpoint
CREATE INDEX "projects_user_created_at_idx" ON "projects" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "users_last_seen_at_idx" ON "users" USING btree ("last_seen_at");