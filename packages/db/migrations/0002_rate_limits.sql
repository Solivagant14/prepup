CREATE TABLE "rate_limits" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"minute_start" timestamp with time zone NOT NULL,
	"minute_count" integer NOT NULL,
	"day_start" timestamp with time zone NOT NULL,
	"day_count" integer NOT NULL
);
--> statement-breakpoint
-- Same as the other tables: RLS on with no policies, so the public Data API can read nothing.
ALTER TABLE "rate_limits" ENABLE ROW LEVEL SECURITY;
