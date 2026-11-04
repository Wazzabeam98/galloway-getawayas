-- Photos in every conversation, not only booking threads (20261104093000).
-- The SAME mechanism: the same private bucket, the same service-role-only
-- table, the same gated signed-link route. A message thread hangs off exactly
-- one of a booking, an experience order or a trade enquiry (messages_one_thread);
-- a photo now records which, the same way, so the gated route checks the viewer
-- against that one conversation.
--
-- Additive only: two nullable columns, booking_id made nullable, one check,
-- two indexes, one new function. The booking function from 20261104093000 is
-- left exactly as it is, so the code already live keeps working through the
-- deploy.

alter table public.message_attachments
    add column if not exists order_id uuid references public.service_orders(id) on delete cascade,
    add column if not exists enquiry_id uuid references public.service_enquiries(id) on delete cascade;

alter table public.message_attachments alter column booking_id drop not null;

alter table public.message_attachments drop constraint if exists message_attachments_one_thread;
alter table public.message_attachments add constraint message_attachments_one_thread
    check (num_nonnulls(booking_id, order_id, enquiry_id) = 1);

create index if not exists message_attachments_order_idx
    on public.message_attachments (order_id) where order_id is not null;
create index if not exists message_attachments_enquiry_idx
    on public.message_attachments (enquiry_id) where enquiry_id is not null;

-- The message and its photos in one transaction, for any kind of thread.
-- Called only by the gated routes with the service key.
create or replace function public.send_thread_message_with_photos(
    p_kind text,
    p_thread uuid,
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
  v_booking uuid := case when p_kind = 'booking' then p_thread end;
  v_order uuid := case when p_kind = 'order' then p_thread end;
  v_enquiry uuid := case when p_kind = 'enquiry' then p_thread end;
  p jsonb;
  i int := 0;
begin
  if p_kind not in ('booking', 'order', 'enquiry') then
    raise exception 'unknown thread kind %', p_kind;
  end if;
  if v_count < 1 then
    raise exception 'a photo message needs at least one photo';
  end if;

  insert into public.messages (booking_id, order_id, enquiry_id, sender_id, recipient_id, body, photo_count)
  values (v_booking, v_order, v_enquiry, p_sender, p_recipient, coalesce(p_body, ''), v_count)
  returning id into v_id;

  for p in select * from jsonb_array_elements(p_photos) loop
    insert into public.message_attachments
        (message_id, booking_id, order_id, enquiry_id, path, thumb_path, content_type, width, height, size_bytes, uploaded_by, position)
    values (v_id, v_booking, v_order, v_enquiry, p->>'path', p->>'thumb_path', p->>'content_type',
            nullif(p->>'width', '')::int, nullif(p->>'height', '')::int,
            nullif(p->>'size_bytes', '')::int, p_sender, i);
    i := i + 1;
  end loop;

  return v_id;
end;
$function$;

revoke all on function public.send_thread_message_with_photos(text, uuid, uuid, uuid, text, jsonb) from public;
revoke all on function public.send_thread_message_with_photos(text, uuid, uuid, uuid, text, jsonb) from anon;
revoke all on function public.send_thread_message_with_photos(text, uuid, uuid, uuid, text, jsonb) from authenticated;
grant execute on function public.send_thread_message_with_photos(text, uuid, uuid, uuid, text, jsonb) to service_role;

-- Read back:
--   select is_nullable from information_schema.columns where table_name='message_attachments' and column_name='booking_id';  -- YES
--   select count(*) from information_schema.columns where table_name='message_attachments' and column_name in ('order_id','enquiry_id');  -- 2
--   select has_function_privilege('authenticated', 'public.send_thread_message_with_photos(text,uuid,uuid,uuid,text,jsonb)', 'execute');  -- false
