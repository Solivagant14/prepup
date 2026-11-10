# Backups

Supabase's free plan keeps no backups. The **Backup** workflow (`.github/workflows/backup.yml`) makes one every night: it dumps the database, encrypts it, and keeps it on GitHub for 30 days. It only reads the database.

It stays off until you add two secrets.

## Turn it on (once, about 5 minutes)

1. **Get the connection string.** Supabase → **Connect** → **Session pooler** (port 5432). Not the transaction pooler (6543) that Vercel uses: `pg_dump` needs a session.
2. **Pick a passphrase.** Long and random, for example from `openssl rand -base64 32`. Save it in your password manager. Without it a backup can't be opened, by anyone, including you.
3. **Add both as repository secrets.** GitHub → the repo → **Settings → Secrets and variables → Actions → New repository secret**:

   | Name | Value |
   |---|---|
   | `BACKUP_DATABASE_URL` | the session pooler string from step 1 |
   | `BACKUP_PASSPHRASE` | the passphrase from step 2 |

4. **Test it.** **Actions → Backup → Run workflow**. After a minute the run shows an artifact named `prepup-YYYY-MM-DD.dump.gpg`.

Why encrypt: a dump holds every user's topics and answers, and artifacts of a public repository can be downloaded by any signed-in GitHub user. Encrypted, the file is useless without the passphrase.

## Restore

Download the artifact from the workflow run and unzip it, then:

```bash
# 1. Decrypt (asks for the passphrase)
gpg --decrypt prepup-2026-11-11.dump.gpg > prepup.dump

# 2. Restore into an empty database (a new Supabase project, or local Postgres)
pg_restore --no-owner --no-privileges --dbname 'postgres://...session-pooler...:5432/postgres' prepup.dump
```

Restore into a **new, empty** project rather than over a live one, check the data, then point `DATABASE_URL` in Vercel at it. The dump includes the migration history, so don't run `pnpm db:migrate` before restoring.

Use `pg_restore` version 17 or newer (`brew install libpq`).

## Limits

- One backup a day: up to 24 hours of changes can be lost.
- 30 days of history. For longer, download a dump now and then.
- If the Supabase project moves to a newer Postgres, change `postgres:17` in the workflow to match.
- GitHub turns off scheduled workflows in a repository with no activity for 60 days; it emails you first, and one click turns them back on.

The nightly connection also counts as activity, which keeps a free Supabase project from pausing after a quiet week.
