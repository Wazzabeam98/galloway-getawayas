-- The row-level security policies on the storage bucket.
--
-- Filled in on 27 Aug 2026 from production's own `pg_policies` output. Nothing
-- here is invented: it is the two policies production has been running, written
-- down so the repo stops being silent about the thing that decides whether
-- anybody can upload a photo.
--
-- Why this file exists at all:
--
-- Storage policies are ordinary RLS policies on `storage.objects`. The
-- dashboard's policy editor is a form that runs `create policy` for you, so
-- they can live in a migration exactly like every other policy in this folder
-- — and until now they did not, so the only record of what they should be was
-- production's live database.
--
-- The cost of that showed up on 25 Aug 2026, and was measured on 27 Aug. On the
-- test project an ordinary authenticated user is refused with "new row violates
-- row-level security policy" on ALL FOUR paths the app writes to — not only the
-- new `providers/` prefix:
--
--   providers/<uid>-<ts>_<rand>.jpg   provider photo      refused
--   providers/logo-<uid>-<ts>.jpg     provider logo       refused
--   avatars/<uid>-<ts>.jpg            account avatar      refused
--   <ts>_<rand>       (bucket root)   listing photo       refused
--
-- The same write as the service role succeeds, so the bucket is fine and it is
-- policy the whole way down. Test simply has no INSERT policy for
-- `authenticated` at all.
--
-- The buckets themselves already match, checked 25 Aug and again 27 Aug:
--
--   test        yefoqcabuijcowoqewtc   listings public=true, listings-removed public=false
--   production  hviwjxigqivjfhmhpjiy   listings public=true, listings-removed public=false
--
-- So the policies were the whole difference.
--
-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY NOT HERE
-- ---------------------------------------------------------------------------
--
-- Production has exactly two policies and this file reproduces exactly two.
-- There is no UPDATE policy and no DELETE policy, and adding either would be
-- inventing a rule production has never run. Both absences have a consequence,
-- and both are recorded rather than quietly fixed:
--
--   NO UPDATE. `app/account/page.tsx` uploads an avatar with `upsert: true`,
--   which would need UPDATE if it ever overwrote anything. It never does: the
--   path carries `Date.now()`, so every avatar is a new key and the upsert is
--   always an insert. Avatar replacement therefore works on production today —
--   the flag is inert rather than load-bearing. If anybody ever makes that path
--   stable (dropping the timestamp so a user has one avatar key), replacement
--   starts failing with an RLS error and this paragraph is why.
--
--   NO DELETE. Nothing in the browser deletes from storage. Removing a provider
--   photo or logo only drops the path from React state, so it leaves the saved
--   row; the only real deletion is `app/api/listings/save/route.ts`, which runs
--   under the service role and bypasses RLS entirely. So nothing is broken —
--   but every removed photo and every replaced logo and avatar stays in the
--   bucket for ever, unreferenced. That is a tidiness problem and a storage
--   bill, not a permissions one, and it wants a service-role sweep rather than
--   a DELETE policy handing the browser the ability to remove other people's
--   files.
--
-- ---------------------------------------------------------------------------
-- A NOTE ON RUNNING IT
-- ---------------------------------------------------------------------------
--
-- `storage.objects` is owned by `supabase_storage_admin`, not by `postgres`.
-- From the SQL editor these statements work. If this project ever moves to
-- `supabase db push`, check that before assuming — it is the one thing about
-- storage policies that is not like the rest of this folder.
--
-- ADDITIVE ONLY. Each policy is created only if a policy of that name is not
-- already there, so this never drops a working policy and can be run twice.
-- `create policy` has no `if not exists`, hence the guards — the same shape the
-- check constraints in this folder use. On production both branches are
-- already true and this file does nothing at all, which is the intended result.
--
-- Pre-flight, on either project:
--   select policyname, cmd, roles, qual, with_check
--     from pg_policies
--    where schemaname = 'storage' and tablename = 'objects'
--    order by policyname;
--
-- Run on TEST first and prove an upload works, then production, where it is
-- expected to be a no-op.

-- Anyone signed in may add a file to the `listings` bucket. Bucket-wide on
-- purpose: listing photos are written to the bucket root with no prefix and no
-- uid in the name, so a policy keyed on the path could not cover them.
do $$
begin
    if not exists (
        select 1 from pg_policies
         where schemaname = 'storage'
           and tablename = 'objects'
           and policyname = 'Allow authenticated uploads to listings bucket'
    ) then
        create policy "Allow authenticated uploads to listings bucket"
            on storage.objects
            for insert
            to authenticated
            with check (bucket_id = 'listings');
    end if;
end $$;

-- The bucket is public, and the site serves cottage photos, provider logos and
-- avatars to signed-out visitors.
do $$
begin
    if not exists (
        select 1 from pg_policies
         where schemaname = 'storage'
           and tablename = 'objects'
           and policyname = 'Allow public read access to listings bucket'
    ) then
        create policy "Allow public read access to listings bucket"
            on storage.objects
            for select
            to public
            using (bucket_id = 'listings');
    end if;
end $$;

-- Read back:
--   select policyname, cmd, roles, qual, with_check
--     from pg_policies
--    where schemaname = 'storage' and tablename = 'objects'
--    order by policyname;
--
-- Expected afterwards, on both projects, and nothing else:
--   Allow authenticated uploads to listings bucket   INSERT  {authenticated}
--   Allow public read access to listings bucket      SELECT  {public}
