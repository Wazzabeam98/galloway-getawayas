-- listing notification subscribers
--
-- WHAT THIS IS FOR. An owner can forward a listing's booking emails to a few
-- other people — a cleaner, a co-owner, a spouse — without giving them an
-- account or any co-host access. Each listing keeps its own short list of extra
-- addresses; a confirmed address gets a copy of exactly the emails the owner
-- gets for THAT listing (a new booking, a cancellation, a change, a new
-- message) and nothing for the owner's other listings. The copies are fanned
-- out at the one place every email passes through (lib/email sendEmail →
-- lib/listingNotifyEmail), the same shape as the business co-host fan-out
-- beside it, so a failed copy retries through the email outbox.
--
-- WHAT GOES WRONG WITHOUT IT. The owner's only option today is to hand over
-- their login, which is a co-host seat they did not mean to give and a payout
-- page the cleaner can see. This keeps the forward to what it is: a copy of a
-- notification, nothing more.
--
-- WHO MAY EDIT THE LIST. Only the owner or a full-access co-host, enforced in
-- the route that writes the table (app/api/listings/[id]/notification-emails,
-- lib/access ownerOrFullAccess). The table itself is SERVICE ROLE ONLY: RLS on,
-- no policies, every grant to anon and authenticated revoked
-- (tests/table-grants-guard.test.ts). The browser never reads or writes it
-- directly — it goes through that route — so there is no row policy to get
-- wrong, and an address that has not confirmed, or its one-time confirm token,
-- is never exposed to anyone.
--
-- CONFIRM AND UNSUBSCRIBE. A new address is unconfirmed until it clicks a
-- one-time link, whose token is stored only as a sha-256 hash and cleared on
-- use; nothing is ever sent to an address that has not confirmed. Every copy
-- carries an unsubscribe link keyed to a stable per-row token that removes only
-- that address from only that listing.
--
-- PRE-FLIGHT. Not destructive: one new table, two indexes, and the account
-- erasure function patched in place to delete a closed account's rows (its
-- address is personal data). Nothing is dropped or rewritten.

create table if not exists public.listing_notification_subscribers (
    id uuid primary key default gen_random_uuid(),
    listing_id uuid not null references public.listings (id) on delete cascade,
    -- The extra address, stored lower-cased (the unique index is on lower(email)
    -- too). This is third-party personal data, which is why the erasure patch
    -- below clears a closed account's rows.
    email text not null,
    -- Null until the address clicks its one-time confirmation link. Nothing is
    -- ever copied to a row whose confirmed_at is null.
    confirmed_at timestamptz,
    -- sha-256 of the one-time confirmation token handed out in the confirm link,
    -- never the token itself. Set when the row is created, cleared to null the
    -- moment it is used, so the link works exactly once.
    confirm_token_hash text,
    -- Stable per-row token for the unsubscribe link in every copy. Not a secret
    -- in the way the confirm token is — it only ever removes this one row — so it
    -- is kept for the life of the row rather than hashed and cleared.
    unsubscribe_token uuid not null default gen_random_uuid(),
    created_at timestamptz not null default now(),
    -- The account that added the address, for an audit trail. Nulled, not
    -- deleted, if that account is later closed.
    created_by uuid references public.profiles (id) on delete set null
);

-- One address per listing, case-insensitively: adding the same address twice is
-- a no-op, not a second copy of every email.
create unique index if not exists listing_notification_subscribers_listing_email_idx
    on public.listing_notification_subscribers (listing_id, lower(email));

-- The fan-out reads confirmed addresses for one listing on every host email, so
-- it wants to be fast and to skip the unconfirmed rows.
create index if not exists listing_notification_subscribers_confirmed_idx
    on public.listing_notification_subscribers (listing_id)
    where confirmed_at is not null;

-- The unsubscribe link looks a row up by its token.
create unique index if not exists listing_notification_subscribers_unsub_idx
    on public.listing_notification_subscribers (unsubscribe_token);

alter table public.listing_notification_subscribers enable row level security;
revoke all on table public.listing_notification_subscribers from anon;
revoke all on table public.listing_notification_subscribers from authenticated;
grant select, insert, update, delete on table public.listing_notification_subscribers to service_role;

comment on table public.listing_notification_subscribers is
    'Extra addresses that get a copy of a listing''s booking/cancellation/change/message emails. No account, no co-host access. Service role only; edited via app/api/listings/[id]/notification-emails (owner or full-access co-host), fanned out by lib/listingNotifyEmail.';

-- ---------------------------------------------------------------- erasure

-- A closed account's address may sit in this table as a forwarding target, so
-- it is cleared with the rest of its personal data. Patched in place after the
-- email_outbox delete line, the same way email_outbox patched itself after the
-- push_outbox line, so a later rewrite of the function keeps this as long as it
-- keeps that line.
do $patch$
declare
  def text;
  anchor text := 'begin delete from public.email_outbox where old_email is not null and lower(to_email) = lower(old_email); exception when undefined_table then null; end;';
  added text := E'\n  begin delete from public.listing_notification_subscribers where old_email is not null and lower(email) = lower(old_email); exception when undefined_table then null; end;';
begin
  select pg_get_functiondef('public.admin_anonymise_account(uuid)'::regprocedure) into def;
  if position('public.listing_notification_subscribers' in def) > 0 then
    return;  -- already patched
  end if;
  if position(anchor in def) = 0 then
    raise exception 'admin_anonymise_account no longer has the email_outbox delete line to patch after — add the listing_notification_subscribers delete by hand';
  end if;
  execute replace(def, anchor, anchor || added);
end
$patch$;

notify pgrst, 'reload schema';

-- Read back:
--   select relname, relrowsecurity from pg_class where relname = 'listing_notification_subscribers';   -- listing_notification_subscribers, true
--   select count(*) from information_schema.role_table_grants
--    where table_name = 'listing_notification_subscribers' and grantee in ('anon','authenticated');     -- 0
--   select position('listing_notification_subscribers' in pg_get_functiondef('public.admin_anonymise_account(uuid)'::regprocedure)) > 0;   -- true
