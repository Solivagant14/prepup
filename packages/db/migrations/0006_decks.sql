CREATE TABLE "decks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "topics_workspace_term_unique";--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "deck_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "decks_workspace_name_unique" ON "decks" USING btree ("workspace_id","normalized_name");--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "topics_deck_term_unique" ON "topics" USING btree ("deck_id","normalized_term");--> statement-breakpoint
CREATE INDEX "topics_workspace_term_idx" ON "topics" USING btree ("workspace_id","normalized_term");