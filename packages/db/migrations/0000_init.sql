CREATE TABLE "memberships" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "review_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"score" integer,
	"explained" boolean DEFAULT false NOT NULL,
	"feedback" text,
	"text" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_events_score_range" CHECK ("review_events"."score" IS NULL OR "review_events"."score" BETWEEN 1 AND 5),
	CONSTRAINT "review_events_score_matches_kind" CHECK (("review_events"."kind" = 'explanation') = ("review_events"."score" IS NULL)),
	CONSTRAINT "review_events_five_needs_explained" CHECK ("review_events"."score" IS DISTINCT FROM 5 OR "review_events"."kind" <> 'claude_test' OR "review_events"."explained")
);
--> statement-breakpoint
CREATE TABLE "topic_settings" (
	"user_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"importance" text DEFAULT 'medium' NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_settings_user_id_topic_id_pk" PRIMARY KEY("user_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"term" text NOT NULL,
	"normalized_term" text NOT NULL,
	"source_url" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"personal" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_settings" ADD CONSTRAINT "topic_settings_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "review_events_topic_user_time_idx" ON "review_events" USING btree ("topic_id","user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "topics_workspace_term_unique" ON "topics" USING btree ("workspace_id","normalized_term");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_one_personal_per_owner" ON "workspaces" USING btree ("owner_id") WHERE "workspaces"."personal";