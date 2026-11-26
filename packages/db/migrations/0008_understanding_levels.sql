ALTER TABLE "review_events" ADD COLUMN "understanding" text;--> statement-breakpoint
ALTER TABLE "topic_settings" ADD COLUMN "understanding" text DEFAULT 'beginner' NOT NULL;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_level_matches_kind" CHECK (("review_events"."kind" = 'explanation') = ("review_events"."understanding" IS NULL));