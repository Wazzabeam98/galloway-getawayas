-- A push for every message, however it was written.
--
-- WHAT THIS IS FOR. Messages reach the messages table by several routes: a
-- person typing in the inbox, the order and enquiry thread routes, and the
-- site itself — the scheduled check-in messages and door-code updates the host
-- set up, which are posted into the thread with no email at all. Recording the
-- push here, on the insert, covers every one of them exactly once
-- ('message:' || id), including the ones a person never typed.
--
-- WHAT A MESSAGE PUSH SAYS. The sender's first name and their role — "New
-- message from your host" — never the text: a check-in message carries the door
-- code and the wifi by design. The push job sends it; co-hosts holding the
-- messages permission get a host's copy (context.cohost).
--
-- Never blocks a message: the whole body swallows its own errors.
--
-- PRE-FLIGHT. Not destructive: one trigger function and its trigger.

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
    if new.recipient_id is null or new.sender_id is not distinct from new.recipient_id then
      return new;
    end if;

    select coalesce(nullif(btrim(preferred_name), ''), nullif(btrim(first_name), ''))
      into sender_name
      from public.profiles where id = new.sender_id;

    if new.booking_id is not null then
      select guest_id into b from public.bookings where id = new.booking_id;
      sender_role := case when new.sender_id = b.guest_id then 'guest' else 'host' end;
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

revoke all on function public.queue_message_push() from public, anon, authenticated;

drop trigger if exists queue_message_push on public.messages;
create trigger queue_message_push
  after insert on public.messages
  for each row execute function public.queue_message_push();

-- Read back:
--   select count(*) from pg_trigger where tgname = 'queue_message_push';   -- 1
