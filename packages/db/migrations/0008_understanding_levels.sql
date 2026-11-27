ALTER TABLE "review_events" ADD COLUMN "understanding" text;--> statement-breakpoint
ALTER TABLE "topic_settings" ADD COLUMN "understanding" text DEFAULT 'beginner' NOT NULL;--> statement-breakpoint
-- Hand-written: every score recorded before levels existed counts as a Beginner score.
UPDATE "review_events" SET "understanding" = 'beginner' WHERE "kind" <> 'explanation';--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_level_matches_kind" CHECK (("review_events"."kind" = 'explanation') = ("review_events"."understanding" IS NULL));