-- How far each person on a host's or a business's side has read a thread.
--
-- WHY. Unread has always been messages.read_at on the rows addressed to you
-- (recipient_id). That works for the two people a message is between, but a
-- co-host is never the recipient of anything: a guest's message is addressed
-- to the owner, the owner's reply to the guest. So a co-host never saw a
-- single thing as unread, and an owner never saw a co-host's reply as new
-- (20/10/2026: Liam wrote to a guest on a stay Jamie co-hosts; Jamie's copy
-- showed nothing new).
--
-- WHAT. One row per person per thread: "I have read everything up to here".
-- For someone on the team side, a message they neither sent nor were sent
-- counts as unread when it is newer than their row (lib/threadReads). Opening
-- the thread, or sending in it, moves the row to now. Rows addressed to the
-- person still use messages.read_at exactly as before.
--
-- No backfill: someone with no row is treated as having read everything before
-- 20/10/2026 (lib/threadReads TEAM_READS_FROM), so nobody's inbox lights up
-- with history the day this lands.
--
-- Server-only. Every read and write goes through the messages routes with the
-- service key, after they have checked the person may see the thread; the
-- browser has no grant and no policy.
--
-- PRE-FLIGHT. Not destructive: one new table, and the message push trigger's
-- function replaced (same trigger, same signature).

create table if not exists public.thread_reads (
    user_id     uuid not null references public.profiles(id) on delete cascade,
    thread_kind text not null,
    thread_id   uuid not null,
    read_at     timestamptz not null default now(),
    primary key (user_id, thread_kind, thread_id),
    constraint thread_reads_kind_check check (thread_kind in ('booking', 'order', 'enquiry'))
);

alter table public.thread_reads enable row level security;

revoke all on table public.thread_reads from anon, authenticated;

-- THE PUSH TRIGGER (20261019172656), two changes, nothing else:
--   1. It skipped every message addressed to its own sender. On a stay an owner
--      booked at their own place that is every message they write, so their
--      co-hosts were never pushed (20/10/2026, Liam and Jamie). Still recorded
--      on a booking now; the push job drops the sender and reaches the team.
--   2. The owner is named as 'host' even when they are also the stay's guest.

create or replace function public.queue_message_push()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  sender_name text;
  sender_role text;
  open_url text;
  ctx jsonb := '{}'::jsonb;
  b record;
  o record;
  e record;
begin
  begin
    -- A message addressed to its own sender is still recorded on a booking:
    -- on a stay an owner booked at their own place it is the only way the
    -- co-hosts hear about it. The push job never sends it to the sender
    -- (lib/pushDispatch). Anywhere else there is nobody to tell.
    if new.recipient_id is null
       or (new.sender_id is not distinct from new.recipient_id and new.booking_id is null) then
      return new;
    end if;

    select coalesce(nullif(btrim(preferred_name), ''), nullif(btrim(first_name), ''))
      into sender_name
      from public.profiles where id = new.sender_id;

    if new.booking_id is not null then
      select guest_id, host_id into b from public.bookings where id = new.booking_id;
      -- The owner first: on a stay they booked at their own place they are
      -- the guest as well, and they are writing as the host.
      sender_role := case when new.sender_id = b.host_id then 'host'
                          when new.sender_id = b.guest_id then 'guest'
                          else 'host' end;
      open_url := '/messages/' || new.booking_id;
      ctx := jsonb_build_object('booking_id', new.booking_id, 'cohost', 'can_messages');
    elsif new.order_id is not null then
      select guest_id into o from public.service_orders where id = new.order_id;
      if new.sender_id = o.guest_id then
        sender_role := 'guest';
        open_url := '/services/messages/order/' || new.order_id;
      else
        sender_role := 'provider';
        open_url := '/experiences/order/' || new.order_id;
      end if;
    elsif new.enquiry_id is not null then
      select host_id into e from public.service_enquiries where id = new.enquiry_id;
      sender_role := case when new.sender_id = e.host_id then 'host' else 'tradesperson' end;
      open_url := '/messages/enquiry/' || new.enquiry_id;
    else
      return new;
    end if;

    insert into public.push_outbox (dedupe_key, source, kind, user_id, category, title, body, url, context)
    values ('message:' || new.id, 'event', 'message.new', new.recipient_id, 'messages',
            coalesce(sender_name, 'New message'), 'New message from your ' || sender_role, open_url, ctx)
    on conflict (dedupe_key) do nothing;
  exception when others then
    -- Never let a notification stop a message being sent.
    null;
  end;
  return new;
end;
$function$;


-- Read back:
--   select count(*) from information_schema.tables where table_name = 'thread_reads';   -- 1
--   select has_table_privilege('authenticated', 'public.thread_reads', 'select');       -- false
--   select position('new.booking_id is null' in prosrc) > 0 from pg_proc where proname = 'queue_message_push';  -- true
