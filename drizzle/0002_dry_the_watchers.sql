CREATE TABLE "custom_emoji_settings" (
	"scope" text PRIMARY KEY NOT NULL,
	"mappings_json" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
