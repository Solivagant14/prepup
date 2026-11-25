ALTER TABLE "user_settings" ALTER COLUMN "testing_style" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "links_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "auto_link" boolean DEFAULT false NOT NULL;