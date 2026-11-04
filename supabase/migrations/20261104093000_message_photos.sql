-- Photos in booking messages: a guest snaps the leak and sends it to the host,
-- the host sends a photo back. Stored exactly as the resolution centre stores
-- its attachments (20260924203041): a row in a table the browser cannot reach,
-- the file in a PRIVATE bucket, opened only through a gated route that hands
-- back a short-lived signed URL to the guest, the host and co-hosts with
-- messages on that booking, and admins. Nobody reads one by guessing a URL or
-- changing an id.
--
-- Additive only: one new table, one new column with a default, one new bucket,
-- one new function, and the push trigger recreated with one change (a photo
-- message says "Sent a photo").

-- 1. How many photos a message carries. Written only by the server (the
--    function below); a browser insert has it forced back to 0, so nobody can
--    make a text message announce a photo that isn't there.
alter table public.messages
    add column if not exists photo_count smallint not null default 0;

create or replace function public.messages_photo_count_server_only()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    if tg_op = 'INSERT' then
      new.photo_count := 0;
    else
      new.photo_count := old.photo_count;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists messages_photo_count_server_only on public.messages;
create trigger messages_photo_count_server_only
    before insert or update on public.messages
    for each row execute function public.messages_photo_count_server_only();

-- 2. The photos themselves. booking_id is held on the row (not only through the
--    message) so the gated route checks the viewer against the booking in one
--    read. thumb_path is a small copy made in the browser for the thread.
create table if not exists public.message_attachments (
    id uuid primary key default gen_random_uuid(),
    message_id uuid not null references public.messages(id) on delete cascade,
    booking_id uuid not null references public.bookings(id) on delete cascade,
    path text not null,
    thumb_path text,
    content_type text not null,
    width integer,
    height integer,
    size_bytes integer,
    uploaded_by uuid not null references public.profiles(id) on delete restrict,
    position smallint not null default 0,
    created_at timestamptz not null default now()
);
create index if not exists message_attachments_message_idx
    on public.message_attachments (message_id);
create index if not exists message_attachments_booking_idx
    on public.message_attachments (booking_id);
create index if not exists message_attachments_uploader_idx
    on public.message_attachments (uploaded_by);

-- No policies and no grants: every read and write is the service role in the
-- gated routes (app/api/messages/threads/[bookingId]/photos,
-- app/api/messages/photos/[id]).
alter table public.message_attachments enable row level security;
revoke all on table public.message_attachments from anon;
revoke all on table public.message_attachments from authenticated;

-- 3. A PRIVATE bucket. public=false → no object is reachable by URL. The bucket
--    itself also refuses anything that is not a JPEG/PNG/WebP or is over 10MB,
--    behind the same checks in the upload route.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('message-attachments', 'message-attachments', false, 10485760,
            array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;

-- 4. The message and its photos in ONE transaction, so the realtime insert the
--    other side receives, and the push the trigger records, never see a photo
--    message without its photos. Called only by the upload route with the
--    service key; the browser roles get no EXECUTE.
create or replace function public.send_booking_message_with_photos(
    p_booking uuid,
    p_sender uuid,
    p_recipient uuid,
    p_body text,
    p_photos jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_count int := coalesce(jsonb_array_length(p_photos), 0);
  p jsonb;
  i int := 0;
begin
  if v_count < 1 then
    raise exception 'a photo message needs at least one photo';
  end if;

  insert into public.messages (booking_id, sender_id, recipient_id, body, photo_count)
  values (p_booking, p_sender, p_recipient, coalesce(p_body, ''), v_count)
  returning id into v_id;

  for p in select * from jsonb_array_elements(p_photos) loop
    insert into public.message_attachments
        (message_id, booking_id, path, thumb_path, content_type, width, height, size_bytes, uploaded_by, position)
    values (v_id, p_booking, p->>'path', p->>'thumb_path', p->>'content_type',
            nullif(p->>'width', '')::int, nullif(p->>'height', '')::int,
            nullif(p->>'size_bytes', '')::int, p_sender, i);
    i := i + 1;
  end loop;

  return v_id;
end;
$function$;

revoke all on function public.send_booking_message_with_photos(uuid, uuid, uuid, text, jsonb) from public;
revoke all on function public.send_booking_message_with_photos(uuid, uuid, uuid, text, jsonb) from anon;
revoke all on function public.send_booking_message_with_photos(uuid, uuid, uuid, text, jsonb) from authenticated;
grant execute on function public.send_booking_message_with_photos(uuid, uuid, uuid, text, jsonb) to service_role;

revoke all on function public.messages_photo_count_server_only() from public;
revoke all on function public.messages_photo_count_server_only() from anon;
revoke all on function public.messages_photo_count_server_only() from authenticated;

-- 5. THE PUSH TRIGGER (20261020163833), one change, nothing else: a message that
--    carries photos says "Sent a photo" / "Sent 3 photos" instead of "New
--    message from your host". Still never the text.
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
  push_body text;
  ctx jsonb := '{}'::jsonb;
  b record;
  o record;
  e record;
begin
  begin
    if new.recipient_id is null
       or (new.sender_id is not distinct from new.recipient_id and new.booking_id is null) then
      return new;
    end if;

    select coalesce(nullif(btrim(preferred_name), ''), nullif(btrim(first_name), ''))
      into sender_name
      from public.profiles where id = new.sender_id;

    if new.booking_id is not null then
      select guest_id, host_id into b from public.bookings where id = new.booking_id;
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

    push_body := case
      when coalesce(new.photo_count, 0) = 1 then 'Sent a photo'
      when coalesce(new.photo_count, 0) > 1 then 'Sent ' || new.photo_count || ' photos'
      else 'New message from your ' || sender_role
    end;

    insert into public.push_outbox (dedupe_key, source, kind, user_id, category, title, body, url, context)
    values ('message:' || new.id, 'event', 'message.new', new.recipient_id, 'messages',
            coalesce(sender_name, 'New message'), push_body, open_url, ctx)
    on conflict (dedupe_key) do nothing;
  exception when others then
    -- Never let a notification stop a message being sent.
    null;
  end;
  return new;
end;
$function$;

-- Read back:
--   select column_default from information_schema.columns where table_name='messages' and column_name='photo_count';  -- 0
--   select relrowsecurity from pg_class where relname='message_attachments';                                          -- true
--   select public from storage.buckets where id='message-attachments';                                                -- false
--   select has_function_privilege('authenticated', 'public.send_booking_message_with_photos(uuid,uuid,uuid,text,jsonb)', 'execute');  -- false
--   select position('Sent a photo' in prosrc) > 0 from pg_proc where proname='queue_message_push';                   -- true
