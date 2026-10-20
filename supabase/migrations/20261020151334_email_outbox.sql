-- A retry queue for outgoing email, so a failed send is no longer only logged
-- and then lost.
--
-- WHAT THIS IS FOR. Every booking, cancellation and payout email is sent once,
-- inside a try/catch (lib/email → sendEmail). When Resend is briefly down or
-- rate-limits the request, the send returns false, a line is logged, and the
-- email is gone — a guest never told their card failed loses a booking to a
-- deadline they never saw, and a host is never told they were paid. This table
-- is where a failed send is written so a background job can try it again, the
-- same shape as the push outbox beside it: recorded here by the email layer,
-- sent by the push job (/api/cron/push-outbox → lib/emailOutbox), never from
-- payment, payout or settlement code.
--
-- EXACTLY ONCE, EVEN ON RETRY. The idempotency_key is the one given to Resend
-- (its Idempotency-Key header) on the very first attempt; a retry reuses it, so
-- a send that actually reached Resend but reported a failure is deduplicated
-- there rather than sent twice. The key is unique per queued email, so the same
-- failed send is never queued more than once.
--
-- email_outbox is SERVICE ROLE ONLY: RLS on, no policies, every grant to anon
-- and authenticated revoked (tests/table-grants-guard.test.ts). A row holds the
-- recipient and the rendered email until it is sent, which is why the account
-- erasure function below deletes a closed account's rows along with the rest of
-- its personal data.
--
-- PRE-FLIGHT. Not destructive: one new table and one index, and the erasure
-- function patched in place to delete the new rows.

create table if not exists public.email_outbox (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    -- The Idempotency-Key handed to Resend for this email. A retry reuses it so
    -- a send that went through despite a reported failure is not doubled. Unique:
    -- the same failed send is queued once.
    idempotency_key text not null unique,
    to_email text not null,
    subject text not null,
    html text not null,
    status text not null default 'pending'
        check (status in ('pending', 'sending', 'sent', 'failed')),
    attempts int not null default 0,
    -- Not before this: the first retry waits a little, then each failure backs
    -- off further, so a provider outage is not hammered.
    next_attempt_at timestamptz not null default now(),
    claimed_at timestamptz,
    done_at timestamptz,
    last_error text
);

create index if not exists email_outbox_due_idx
    on public.email_outbox (next_attempt_at) where status = 'pending';

alter table public.email_outbox enable row level security;
revoke all on table public.email_outbox from anon;
revoke all on table public.email_outbox from authenticated;
grant select, insert, update, delete on table public.email_outbox to service_role;

comment on table public.email_outbox is
    'One row per outgoing email that failed its first send, retried by /api/cron/push-outbox (lib/emailOutbox). Service role only.';

-- ---------------------------------------------------------------- erasure

-- An erased account's queued emails hold its address and the rendered message,
-- so they are deleted with the rest of its personal data. Patched in place, the
-- same way the push outbox was, so a change to the function elsewhere is kept.
do $patch$
declare
  def text;
  anchor text := 'begin delete from public.push_outbox where user_id = uid or (old_email is not null and lower(to_email) = lower(old_email)); exception when undefined_table then null; end;';
  added text := E'\n  begin delete from public.email_outbox where old_email is not null and lower(to_email) = lower(old_email); exception when undefined_table then null; end;';
begin
  select pg_get_functiondef('public.admin_anonymise_account(uuid)'::regprocedure) into def;
  if position('public.email_outbox' in def) > 0 then
    return;  -- already patched
  end if;
  if position(anchor in def) = 0 then
    raise exception 'admin_anonymise_account no longer has the push_outbox delete line to patch after — add the email_outbox delete by hand';
  end if;
  execute replace(def, anchor, anchor || added);
end
$patch$;

notify pgrst, 'reload schema';

-- Read back:
--   select relname, relrowsecurity from pg_class where relname = 'email_outbox';   -- email_outbox, true
--   select count(*) from information_schema.role_table_grants
--    where table_name = 'email_outbox' and grantee in ('anon','authenticated');     -- 0
--   select position('email_outbox' in pg_get_functiondef('public.admin_anonymise_account(uuid)'::regprocedure)) > 0;   -- true
