CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"testing_style" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_style_length" CHECK (char_length("user_settings"."testing_style") BETWEEN 1 AND 1500)
);
--> statement-breakpoint
ALTER TABLE "user_settings" ENABLE ROW LEVEL SECURITY;
