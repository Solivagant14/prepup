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
ALTER TABLE "topics" ADD COLUMN "deck_id" uuid;--> statement-breakpoint
-- Hand-written: every workspace that already has topics gets one deck, "My deck", and its topics move into it.
-- "mydeck" is normalizeTerm("My deck"), as the core computes it. People with no topics get the deck on first use.
INSERT INTO "decks" ("workspace_id", "name", "normalized_name", "created_by")
SELECT "w"."id", 'My deck', 'mydeck', "w"."owner_id"
FROM "workspaces" "w"
WHERE EXISTS (SELECT 1 FROM "topics" "t" WHERE "t"."workspace_id" = "w"."id");--> statement-breakpoint
UPDATE "topics" SET "deck_id" = "d"."id" FROM "decks" "d" WHERE "d"."workspace_id" = "topics"."workspace_id";--> statement-breakpoint
ALTER TABLE "topics" ALTER COLUMN "deck_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "decks_workspace_name_unique" ON "decks" USING btree ("workspace_id","normalized_name");--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "topics_deck_term_unique" ON "topics" USING btree ("deck_id","normalized_term");--> statement-breakpoint
CREATE INDEX "topics_workspace_term_idx" ON "topics" USING btree ("workspace_id","normalized_term");--> statement-breakpoint
-- Hand-written, as for every table: no access through Supabase's Data API.
ALTER TABLE "decks" ENABLE ROW LEVEL SECURITY;
