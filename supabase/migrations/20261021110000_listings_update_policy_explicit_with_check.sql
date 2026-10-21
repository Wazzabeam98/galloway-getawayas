-- Make the listings UPDATE policy's WITH CHECK explicit.
--
-- "Hosts can update their own listings." was created (in the Supabase baseline,
-- before this migrations directory) as:
--
--   for update using (auth.uid() = host_id)        -- and no WITH CHECK
--
-- PostgreSQL falls back to the USING expression as the WITH CHECK when none is
-- given, so a host already cannot move a row to another owner — the new row
-- must still satisfy auth.uid() = host_id. The policy is therefore SAFE today,
-- and the column-level allow-list (20260903161233) already leaned on exactly
-- this fallback for host_id.
--
-- This is a low-severity hardening, not a fix for a reachable hole: it writes
-- the WITH CHECK out in full so the row-value guard is stated, not inferred. A
-- later edit to the USING clause (say, to admit a co-host read) can no longer
-- silently change what values an UPDATE may write, because the two expressions
-- are now separate and visible.
--
-- SEMANTICS UNCHANGED. Same name, same PERMISSIVE, same roles (PUBLIC — the
-- baseline policy named no role; the auth.uid() test is what scopes it), same
-- USING. Only WITH CHECK goes from the implicit copy of USING to an identical
-- explicit copy. Proven equal on TEST and PRODUCTION before this ran:
--   using_expr = (auth.uid() = host_id), with_check = null, permissive, roles {-}.
--
-- ORDERING. Pure policy tightening that changes no behaviour; no code depends on
-- it. Lands on TEST and PRODUCTION on its own. Not --destructive.

drop policy if exists "Hosts can update their own listings." on public.listings;

create policy "Hosts can update their own listings."
    on public.listings
    for update
    using (auth.uid() = host_id)
    with check (auth.uid() = host_id);

notify pgrst, 'reload schema';

-- Read back — both expressions must now be present and identical:
--   select pg_get_expr(polqual, polrelid)      as using_expr,
--          pg_get_expr(polwithcheck, polrelid) as with_check
--     from pg_policy pol join pg_class c on c.oid = pol.polrelid
--    where c.relname = 'listings'
--      and polname = 'Hosts can update their own listings.';
--   -- expected: using_expr = with_check = (auth.uid() = host_id)
