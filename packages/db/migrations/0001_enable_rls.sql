-- Supabase exposes the public schema through its Data API (PostgREST) to anyone
-- holding the publishable key. Turning on row-level security with no policies
-- means that API can read nothing. The PrepUp server connects as the database
-- owner, which bypasses RLS, and enforces workspace scoping in every query.
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "topics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "topic_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_events" ENABLE ROW LEVEL SECURITY;
