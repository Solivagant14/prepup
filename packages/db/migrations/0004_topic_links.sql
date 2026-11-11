CREATE TABLE "topic_links" (
	"workspace_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"builds_on_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_links_topic_id_builds_on_id_pk" PRIMARY KEY("topic_id","builds_on_id"),
	CONSTRAINT "topic_links_no_self_link" CHECK ("topic_links"."topic_id" <> "topic_links"."builds_on_id")
);
--> statement-breakpoint
ALTER TABLE "topic_links" ADD CONSTRAINT "topic_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_links" ADD CONSTRAINT "topic_links_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_links" ADD CONSTRAINT "topic_links_builds_on_id_topics_id_fk" FOREIGN KEY ("builds_on_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "topic_links_builds_on_idx" ON "topic_links" USING btree ("builds_on_id");--> statement-breakpoint
CREATE INDEX "topic_links_workspace_idx" ON "topic_links" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "topic_links" ENABLE ROW LEVEL SECURITY;
