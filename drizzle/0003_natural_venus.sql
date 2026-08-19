CREATE TABLE "callback_actions" (
	"callback_query_id" text PRIMARY KEY NOT NULL,
	"telegram_user_id" bigint NOT NULL,
	"telegram_chat_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "parent_project_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "root_project_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "source_project_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "source_post_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "source_draft_version" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "source_telegram_message_id" bigint;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "branch_callback_query_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "source_audio_parts_json" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "source_pool_sealed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "source_collector_message_id" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_branch_callback_query_id_idx" ON "projects" USING btree ("branch_callback_query_id");