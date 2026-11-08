/** Run by Fly's release_command before each deploy goes live. */
import { runMigrations } from "@prepup/db";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
await runMigrations(url);
console.log("Migrations applied");
