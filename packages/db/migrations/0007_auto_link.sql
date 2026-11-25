ALTER TABLE "user_settings" ALTER COLUMN "testing_style" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "links_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "auto_link" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Hand-written: a topic that already builds on something has had its links looked at, so it isn't asked about again.
UPDATE "topics" SET "links_checked_at" = now() WHERE EXISTS (SELECT 1 FROM "topic_links" "l" WHERE "l"."topic_id" = "topics"."id");
