# SQL that must never be run automatically

These files are worksheets, not migrations. Each one needs a person to read it,
decide something, and type the statements themselves.

They used to sit in `supabase/migrations/` alongside the real ones, which meant
anything that applies a directory — `supabase db push`, or a future runner that
walks the folder — would have executed them. One of them drops columns under a
heading that says not to yet.

| file | why it is here |
|---|---|
| `backfill_listing_street_address.sql` | Opens with "NOT SAFE TO RUN AS-IS". It is a preview query plus a space to hand-write four `UPDATE`s, because splitting a street out of a free-text address gets two of the four real listings wrong. |
| `drop_listing_text_time_columns.sql` | "STEP 2 OF 2. DO NOT RUN THIS YET." The dropping half of an add-deploy-then-drop pair, held back deliberately until the new code has been live for a while. |

`tests/migration-files.test.ts` fails the build if a file carrying that kind of
warning appears in `supabase/migrations/` again.

Nothing here is applied by `scripts/migrate.mjs`, which takes one named file at
a time and never a directory. Production SQL is pasted by hand regardless — see
`MAINTENANCE.md`.
