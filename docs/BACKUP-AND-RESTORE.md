# Backup and restore

Two things protect the data behind Galloway Getaways: a **daily off-Supabase
copy of the photo storage**, and a **proven database restore**. This document
is the operational record of both — what runs, where it lands, and how to do the
restore again from scratch. It exists partly to answer the insurer.

---

## 1. Storage backup (photos)

### What and why

Supabase Storage holds every listing photo in two buckets — `listings` (live)
and `listings-removed` (taken-down listings, kept for audit). Until this job,
**nothing copied them anywhere.** Deleting a bucket — through an account
compromise, a billing lapse, or a mistake in the dashboard — would destroy every
photo with no way back.

The job `app/api/cron/storage-backup/route.ts` copies both buckets, once a day,
to an **S3-compatible object store on a different provider from Supabase.**
Different provider is the whole point: Supabase Storage runs on AWS, so a copy
that also lived on AWS under the same account would share the failure. The copy
lives somewhere a Supabase-side loss cannot reach.

### Destination — Cloudflare R2 (recommended)

| Option | Verdict |
|---|---|
| **Cloudflare R2** | **Recommended.** S3-compatible (no bespoke code), **zero egress fees** so restores and audits cost nothing to pull, ~$0.015/GB-month, and a **different company on different infrastructure** from Supabase — the separation that makes it a real backup. |
| Backblaze B2 | Fine second choice. Also cheap and S3-compatible; egress is free up to 3× stored, enough here. Slightly less mature tooling. |
| AWS S3 | Works, but it is the **same cloud Supabase Storage sits on** — a correlated blast radius — and it charges egress. Avoid unless already standardised on AWS. |

At current volume (~20 MB, ~50 files) the R2 bill for 90 daily snapshots is a
few pence a month. Cost is not the deciding factor; **independence from Supabase
is.**

### Wiring it up (one-time)

The code ships **inert**: with the variables below unset it no-ops and reports
`{ ok: false, configured: false }`, so it is safe on production before the bucket
exists.

1. In Cloudflare R2, create a **private** bucket, e.g. `galloway-backups`.
2. Create an R2 **API token** scoped to that bucket (Object Read & Write).
3. On Vercel → project → Settings → Environment Variables (Production), set:

   ```
   BACKUP_S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
   BACKUP_S3_REGION=auto
   BACKUP_S3_BUCKET=galloway-backups
   BACKUP_S3_ACCESS_KEY_ID=<token access key id>
   BACKUP_S3_SECRET_ACCESS_KEY=<token secret>
   ```

4. **Redeploy** (Vercel binds env vars at build, like every other secret here).
5. On R2, add a **lifecycle rule** to delete objects older than the retention
   you want (e.g. 90 days). The job never prunes — retention is the bucket's job,
   so a bug in the job can never delete an old snapshot.

### What runs, where it lands, how often

- **How often:** daily at **02:00 UTC** (`vercel.json` → `/api/cron/storage-backup`),
  a quiet hour clear of the other crons. Guarded by `CRON_SECRET` like every cron.
- **Where it lands:** the R2 bucket, one **dated, full snapshot** per run:

  ```
  storage/2026-09-21/listings/<listing-id>/<file>
  storage/2026-09-21/listings-removed/<...>
  storage/2026-09-21/manifest.json
  ```

- **Full, not incremental**, because the data is tiny and a full copy is
  trivially verifiable. **Dated, not overwrite-in-place**, so a bad delete found
  days later is still recoverable from an earlier day.
- **`manifest.json` is written last**, listing every file and its size. Its
  presence means the snapshot finished; a run that died halfway leaves photos but
  no manifest, and a restore knows not to trust that day.

### Restoring photos

Pick a day with a `manifest.json`, then copy `storage/<day>/<bucket>/…` back into
the Supabase bucket of the same name (dashboard upload for a handful of files, or
`aws s3 sync` against R2 then the Supabase S3 endpoint for a bulk restore). Check
the file count and total size against the manifest.

### Verifying it works (no waiting for 02:00)

```bash
curl -s -H "authorization: Bearer $CRON_SECRET" \
  https://<prod-domain>/api/cron/storage-backup | jq
# => { "ok": true, "day": "…", "copied": <n>, "bytes": <n> }
```

Then confirm `storage/<day>/manifest.json` exists in R2 and its `fileCount`
matches the live bucket.

---

## 2. Database restore drill

### Why do this at all

A backup you have never restored is a hope, not a backup. Supabase takes its own
daily database backups, but until you have actually restored one and checked the
data, you do not know that you can. This drill restores a copy of production into
a clean, throwaway database and verifies the data arrives intact.

**What it covers.** The drill restores and verifies the **full production
application data** — every table in the `public` and `storage` schemas: listings,
bookings, orders, messages, reviews, everything the platform is. It does **not**
include Supabase's own login records (the `auth` schema — user credentials and
sessions); those are covered by **Supabase's own managed backups**, not this
drill. So the two together cover the whole database: this drill for the business
data, Supabase's managed backups for the login layer.

### Automated — the quarterly GitHub Action

This runs by machine, not from a diary note: **`.github/workflows/restore-drill.yml`**.

- **Schedule:** quarterly — 06:00 UTC on the **1st of January, April, July and
  October** (`cron: '0 6 1 1,4,7,10 *'`). Also runnable on demand from the
  Actions tab (**Run workflow**).
- **What it does, each run:** spins up a throwaway `postgres:17` service
  container; takes a **read-only** `pg_dump` of the production application data
  (`public` + `storage`) through a dedicated role; restores it into the
  container; runs `scripts/restore-drill-verify.mjs` to compare **every table's
  row count** and the **`listings` content hash** against source; **records** the
  result to `restore_drill_runs` on production; and **emails** the owner the
  outcome either way. The container is destroyed when the job ends, so the copy
  of production it briefly holds never outlives the run.
- **A logical dump and restore** on purpose — provider-independent, proving the
  data restores into *any* Postgres, and it never writes to production.
- **The watchdog:** the 8am digest (`/api/cron/error-digest`) reads
  `restore_drill_runs` and flags the owner if the **last drill failed** or if
  **no drill has run in over a quarter** — so a drill that silently stops running
  sends up a flare rather than going unnoticed.

### Setup — the read-only role (run once, on production)

The drill connects to production as a **dedicated role that can only read the
data and append its own result row** — never the main database user. `BYPASSRLS`
is needed so the dump sees every row (row-level security would otherwise hide
rows and make the row-count check meaningless); it grants **no write access to
any application table**. Run this on production yourself (it needs a password you
choose), after the `restore_drill_runs` migration is applied:

```sql
-- Pick a strong password and keep it only in the GitHub secret below.
create role restore_drill_ro with login password 'REPLACE_WITH_A_STRONG_PASSWORD'
  nosuperuser nocreatedb nocreaterole bypassrls;

-- Read the application data.
grant usage on schema public, storage to restore_drill_ro;
grant select on all tables in schema public  to restore_drill_ro;
grant select on all tables in schema storage to restore_drill_ro;
-- And read tables added later, so a new table never silently drops out of the
-- "every table" check.
alter default privileges in schema public  grant select on tables to restore_drill_ro;
alter default privileges in schema storage grant select on tables to restore_drill_ro;

-- The one thing it may WRITE: its own drill result. Nothing else.
grant insert on public.restore_drill_runs to restore_drill_ro;
```

> If the managed platform refuses `bypassrls` when you run this, tell the
> maintainer — the fallback is to grant the role membership in a role that
> already bypasses RLS. Without it the dump would only see rows RLS lets an
> anonymous caller see (i.e. almost none), and the drill would wrongly "pass" on
> empty tables.

The connection string to store is (URL-encode the password if it has symbols):

```
postgresql://restore_drill_ro:PASSWORD@<PROD-DB-HOST>:5432/postgres
```

Use the **same host, port and database** as `SUPABASE_PROD_DB_URL`, only with
this role's name and password.

### Setup — the GitHub secrets (click by click)

In the GitHub repo, go to **Settings → Secrets and variables → Actions**, then
the **Secrets** tab, and add three **repository secrets** (New repository secret):

1. **`RESTORE_DRILL_DB_URL`** — the `restore_drill_ro` connection string above.
2. **`RESTORE_DRILL_RESEND_KEY`** — a Resend API key (the same account the site
   sends from; a dedicated key is tidier so it can be rotated on its own). This
   lets the Action email you directly, independent of the app.
3. **`RESTORE_DRILL_ALERT_EMAIL`** — the address(es) to email, comma-separated.

Then prove it: **Actions → restore-drill → Run workflow**. A green run emails a
pass and files a row in `restore_drill_runs`; a red run emails a failure with the
mismatching tables.

### Throwaway target for a manual/local run

- **Source:** production, **read-only**.
- **Target:** an ephemeral `postgres:17` Docker container (free, isolated) — the
  same image the Action uses. A fresh Supabase project also works if a
  Supabase-hosted restore is ever wanted; only the target URL changes.

> **Safety:** the restore target URL must be the throwaway. Never point
> `pg_restore`/`psql --command` writes at `SUPABASE_PROD_DB_URL`. Match the
> Postgres major version between dump and restore.

### Steps for a manual / local run

The Action above does all of this on a schedule; these are the same steps by
hand, for reproducing a failure or running an ad-hoc drill.

Production runs **Postgres 17**, so the target and the `pg_dump`/`pg_restore`
client must be **17 or newer** (a v15 `pg_dump` refuses a v17 server). No local
Postgres client is installed on the ops Mac, so everything below runs *inside* a
`postgres:17` container, which carries matching client tools — this also keeps
the dump file inside the container, so tearing the container down destroys the
PII with it.

```bash
# 0. Confirm the production major version.
docker run --rm -e P="$SUPABASE_PROD_DB_URL" postgres:17 \
  psql "$SUPABASE_PROD_DB_URL" -tAc "show server_version;"

# 1. Stand up a throwaway Postgres 17 (the "throwaway project").
docker run -d --name pg-restore-drill \
  -e POSTGRES_PASSWORD=drill postgres:17
docker exec pg-restore-drill psql -U postgres \
  -c "create database restore_drill;"

# 2. Read-only logical backup of production, into the container.
#    --no-owner/--no-acl so it restores under a different role cleanly.
docker exec -e P="$SUPABASE_PROD_DB_URL" pg-restore-drill \
  pg_dump "$SUPABASE_PROD_DB_URL" \
  --format=custom --no-owner --no-acl \
  --schema=public --schema=storage --file=/tmp/prod.dump

# 3. (Optional, for a fully faithful restore) pre-create the Supabase-managed
#    scaffolding the dump's policies expect, so fewer objects are skipped:
#      create schema auth; create role authenticated; create role anon;
#      create extension if not exists btree_gist;   -- for the slot-overlap
#                                                    -- exclusion constraints
#    Skipping this only skips RLS policies and two indexes — never table data.

# 4. Restore into the throwaway.
docker exec pg-restore-drill pg_restore --no-owner --no-acl \
  --dbname="postgresql://postgres:drill@127.0.0.1:5432/restore_drill" \
  /tmp/prod.dump
#    exit 1 with "errors ignored" is EXPECTED here — see the note below.

# 5. Verify integrity (see checklist below).

# 6. Tear down. The dump dies with the container; nothing to shred on the host.
docker rm -f pg-restore-drill
```

**On the ignored restore errors:** against a bare Postgres, `pg_restore` reports
errors for every object that depends on Supabase's managed layer — RLS policies
that call `auth.uid()`, grants to the `authenticated`/`anon` roles, and the two
exclusion-constraint indexes that need `btree_gist`. These are **schema and
permission objects, not data**; confirm there are **no `TABLE DATA`/`COPY`
errors** and the drill has lost nothing. Step 3 removes most of them if you want
a clean run.

### Integrity checklist

Compare source and target and record the numbers:

- **Per-table row counts match** for the tables that matter: `profiles`,
  `listings`, `bookings`, `service_providers`, `service_orders`, `messages`,
  `reviews`.
- **`storage.objects` row count matches** — the photo *metadata* is in the DB
  even though the bytes are not; this ties the DB restore to the storage backup.
- **Spot-check a known row** (a real listing's title/location) reads back
  identically.
- **Extensions and constraints restored** — `pg_restore` exited without errors,
  foreign keys present.

```bash
# Example count comparison for one table (repeat per table, or script it):
psql "$SUPABASE_PROD_DB_URL" -tAc "select count(*) from listings;"
psql "$TARGET"               -tAc "select count(*) from listings;"
```

### Schedule and last result

| Field | Value |
|---|---|
| **Cadence** | **Quarterly**, automated — `.github/workflows/restore-drill.yml`, 06:00 UTC on the 1st of Jan/Apr/Jul/Oct |
| **Next due** | **1 October 2026** (then 1 Jan 2027, 1 Apr 2027, …) |
| **Watchdog** | The 8am digest flags a failed or overdue drill (no run in >100 days) |
| **Last run** | **2026-09-21** — the founding manual drill (the automation was proven the same day against a `postgres:17` container) |
| Source / versions | production, read-only `pg_dump`; source **17.6**, target **17.11** |
| Tables checked | **all 55** tables in `public` + `storage` |
| Row counts source vs target | **identical, row-for-row** — every table matched |
| Content spot-check | `listings` content hash **matched exactly**; `storage.objects` = **54 on both**, matching the live bucket |
| Restore errors | `pg_restore` exit 1, **94 ignored** — all Supabase-managed RLS policies, role grants, and 2 `btree_gist` indexes. **No `TABLE DATA`/`COPY` errors.** |
| **Outcome** | **PASS** — full production application data restored into a clean, independent database, every table intact. The only objects that did not restore are Supabase-managed policies/roles (the `auth` login layer, covered by Supabase's own backups). |

Each automated run appends a row to `restore_drill_runs` and emails the outcome;
this table is the human-readable summary of the latest.
