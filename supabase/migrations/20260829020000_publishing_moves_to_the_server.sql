-- A host can no longer publish a listing by writing the row. Publishing is a
-- decision, and the decision moves to the server.
--
-- WHAT WAS WRONG
--
-- The listings UPDATE policy is `USING (auth.uid() = host_id)` with no column
-- restriction, and the table carries the default blanket write grant. So a
-- host could `PATCH /rest/v1/listings?id=eq.<their listing>` with
-- `{"status":"published"}` straight from the browser, or insert one already
-- published — bypassing any review. Proven on production 29 August 2026: a
-- draft and a pending_review listing both went to published in one REST call.
--
-- The live add-a-home wizard does exactly this today (app/addhome writes
-- status='published' from the browser), so the review queue described in
-- 20260828143000_listing_pending_review.sql can be defeated the moment it
-- ships. This closes the bypass ahead of it, the way that migration's header
-- says it must: "publishing moves to the server, alongside revoking status".
--
-- WHY A TRIGGER, NOT A COLUMN-GRANT REVOKE
--
-- The other four fixes this week revoked the table grant and named the safe
-- columns back. listings has 77 columns the wizard and the edit screen write
-- across two forms; enumerating them to leave one out is how you break listing
-- creation by missing a column. The rule here is about ONE column and its
-- allowed transitions, which a trigger states exactly and a grant cannot: a
-- browser may create a draft and may not change status at all. Everything
-- else it may still write.
--
-- WHO THIS BINDS
--
-- current_user is the Postgres role PostgREST has switched into for the
-- request: 'anon' or 'authenticated' for anyone using an API key in a browser,
-- 'service_role' for the server. So the check binds exactly the browser and
-- leaves the server routes untouched. Every legitimate status write already
-- goes through the service role:
--
--   app/api/listings/publish (new)        draft   -> published
--   app/api/listings/visibility           published <-> hidden
--   app/api/admin/listings/decide         pending_review -> published / draft
--   the crons                             never touch listings.status
--
-- Only app/addhome wrote it from the browser, and that is changed to call the
-- publish route in the same deploy as this.
--
-- Safe to run twice. Run on test first, then production. Structural, loses no
-- data.

create or replace function public.enforce_listing_status_authority()
returns trigger
language plpgsql
as $$
begin
    -- Only the two browser roles are constrained. The service role and the
    -- migration superuser may set any status — that is what the publish and
    -- decide routes run as.
    if current_user in ('anon', 'authenticated') then
        if tg_op = 'INSERT' then
            -- A listing is born a draft. Publishing is a separate, server-side
            -- act. (The column default is already 'draft'; this refuses an
            -- explicit attempt to insert one live.)
            if new.status is distinct from 'draft' then
                raise exception
                    'A new listing starts as a draft; publishing goes through the server.'
                    using errcode = '42501';
            end if;
        elsif tg_op = 'UPDATE' then
            -- Content may be edited freely. Status may not be changed from a
            -- browser at all — not to published, not to hidden, not to
            -- pending_review. Each of those is a route.
            if new.status is distinct from old.status then
                raise exception
                    'Changing a listing''s status is done through the server, not the browser.'
                    using errcode = '42501';
            end if;
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists listings_status_authority on public.listings;
create trigger listings_status_authority
    before insert or update on public.listings
    for each row
    execute function public.enforce_listing_status_authority();

comment on function public.enforce_listing_status_authority() is
    'A browser (anon/authenticated) may create a draft and may never change a '
    'listing''s status. Publishing, hiding and approving are service-role '
    'routes. See 20260829020000.';

-- Read back, on test:
--   as the service role, insert a draft and update it to published — both work.
--   as an authenticated user via REST, PATCH status='published' — refused 42501.
-- scripts/write-side-rls.mjs --target prod grows a "cannot self-publish" check.
