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
data, you do not know that you can. This drill restores a **real production
backup into a clean, throwaway database** and verifies the data arrives intact.
Run it on a schedule (quarterly is reasonable) and whenever the schema changes
materially.

### The approach

A **logical dump and restore** (`pg_dump` → `pg_restore`), because it is
provider-independent — it proves the data is recoverable into *any* Postgres,
not only back into Supabase's own tooling — and it never writes to production.

- **Source:** production, **read-only**, via `SUPABASE_PROD_DB_URL`.
- **Throwaway target:** an ephemeral Postgres you can destroy afterwards. Either
  a local `postgres:15` Docker container (free, isolated, used for the recorded
  drill below) **or** a fresh Supabase project if the insurer wants a
  Supabase-hosted restore — the steps are identical, only the target URL changes.

> **Safety:** the restore target URL must be the throwaway. Never point
> `pg_restore`/`psql --command` writes at `SUPABASE_PROD_DB_URL`. Match the
> Postgres major version between dump and restore.

### Steps (repeatable)

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

### Last drill — result

| Field | Value |
|---|---|
| Date run | **2026-09-21** |
| Source | production (`hviwjxigqivjfhmhpjiy`), read-only `pg_dump` |
| Postgres version | source **17.6**, target **17.11** (`postgres:17` container) |
| Dump | 412 KB, custom format, `public` + `storage` schemas, ~6 s |
| Restore | `pg_restore` exit 1, **94 ignored errors** — all RLS policies (`auth` schema absent), role grants (`authenticated`/`anon` absent) and 2 `btree_gist` exclusion constraints. **No `TABLE DATA`/`COPY` errors.** |
| Tables checked | **all 55** tables in `public` + `storage` |
| Row counts source vs target | **identical, row-for-row** — 640 rows total, every table matched |
| Content spot-check | `listings` content hash (id+title+location, all rows) **matched exactly**; `storage.objects` for the photo buckets = **54 on both**, matching the 54 files live in the `listings` bucket |
| Outcome | **PASS** — a production backup restored into a clean, independent database with all row data intact. The only objects that did not restore are Supabase-managed policies/roles, recreatable on any real Supabase target. |
