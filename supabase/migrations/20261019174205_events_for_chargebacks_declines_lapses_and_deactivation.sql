-- Four events nobody was told about, now emailed and pushed.
--
-- WHAT GOES WRONG WITHOUT IT. A host never heard that a guest's bank had
-- disputed their booking's payment, or that their guest had declined a money
-- request (only the directors did). An experience request or date change that
-- ran out of time lapsed silently on both sides. And an account that was
-- deactivated or suspended got no word at all.
--
-- HOW. The code that does these things is payment and settlement code (the
-- Stripe webhook, the resolutions route, the order sweep) or a database
-- function, and none of it may send a notification. So each change is caught
-- here, on the table it lands in, and recorded as a 'notify.*' row in the push
-- outbox. The push job (/api/cron/push-outbox → lib/eventEmails) picks the row
-- up once, sends the email, and the email records its push through the shared
-- layer like every other email. A trigger only records; it never sends.
--
--   disputes          inserted / closed with a booking → notify.chargeback
--   booking_resolutions  a request the GUEST declined (pending → escalated,
--                     with responded_at) → notify.money_declined
--   service_orders    authorised → expired → notify.order_lapsed;
--                     a pending date change cleared after its deadline,
--                     without the date moving → notify.date_change_lapsed
--   profiles          deactivated_at set → notify.deactivated, 'self' when the
--                     person did it (auth.uid() is them), 'suspended' otherwise
--
-- Every body swallows its own errors: a notification must never stop a
-- chargeback being recorded, a request being declined, an order lapsing or an
-- account closing.
--
-- PRE-FLIGHT. Not destructive: four trigger functions and their triggers.

create or replace function public.queue_dispute_notice()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  begin
    if new.booking_id is not null
       and (tg_op = 'INSERT' or old.booking_id is null) then
      insert into public.push_outbox (dedupe_key, source, kind, category, title, body, url, context)
      values ('notify.chargeback.opened:' || new.id, 'event', 'notify.chargeback', 'payments',
              'chargeback opened', '-', '/', jsonb_build_object('dispute_id', new.id, 'stage', 'opened'))
      on conflict (dedupe_key) do nothing;
    end if;
    if new.booking_id is not null and new.closed_at is not null
       and (tg_op = 'INSERT' or old.closed_at is null) then
      insert into public.push_outbox (dedupe_key, source, kind, category, title, body, url, context)
      values ('notify.chargeback.closed:' || new.id, 'event', 'notify.chargeback', 'payments',
              'chargeback closed', '-', '/', jsonb_build_object('dispute_id', new.id, 'stage', 'closed'))
      on conflict (dedupe_key) do nothing;
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$function$;

revoke all on function public.queue_dispute_notice() from public, anon, authenticated;

drop trigger if exists queue_dispute_notice on public.disputes;
create trigger queue_dispute_notice
  after insert or update of booking_id, closed_at on public.disputes
  for each row execute function public.queue_dispute_notice();

create or replace function public.queue_money_declined_notice()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  begin
    if new.direction = 'request'
       and old.status = 'pending' and new.status = 'escalated'
       and new.responded_at is not null then
      insert into public.push_outbox (dedupe_key, source, kind, category, title, body, url, context)
      values ('notify.money_declined:' || new.id, 'event', 'notify.money_declined', 'payments',
              'money request declined', '-', '/', jsonb_build_object('resolution_id', new.id))
      on conflict (dedupe_key) do nothing;
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$function$;

revoke all on function public.queue_money_declined_notice() from public, anon, authenticated;

drop trigger if exists queue_money_declined_notice on public.booking_resolutions;
create trigger queue_money_declined_notice
  after update of status on public.booking_resolutions
  for each row execute function public.queue_money_declined_notice();

create or replace function public.queue_order_lapse_notice()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  begin
    if old.status = 'authorised' and new.status = 'expired' then
      insert into public.push_outbox (dedupe_key, source, kind, category, title, body, url, context)
      values ('notify.order_lapsed:' || new.id, 'event', 'notify.order_lapsed', 'reservations',
              'request lapsed', '-', '/', jsonb_build_object('order_id', new.id))
      on conflict (dedupe_key) do nothing;
    end if;
    if old.pending_service_date is not null and new.pending_service_date is null
       and old.pending_change_expires_at is not null and old.pending_change_expires_at < now()
       and new.service_date is not distinct from old.service_date then
      insert into public.push_outbox (dedupe_key, source, kind, category, title, body, url, context)
      values ('notify.date_change_lapsed:' || new.id || ':' || extract(epoch from old.pending_change_expires_at)::bigint,
              'event', 'notify.date_change_lapsed', 'reservations', 'date change lapsed', '-', '/',
              jsonb_build_object('order_id', new.id, 'asked_by', old.pending_change_by,
                                 'asked_date', old.pending_service_date))
      on conflict (dedupe_key) do nothing;
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$function$;

revoke all on function public.queue_order_lapse_notice() from public, anon, authenticated;

drop trigger if exists queue_order_lapse_notice on public.service_orders;
create trigger queue_order_lapse_notice
  after update of status, pending_service_date on public.service_orders
  for each row execute function public.queue_order_lapse_notice();

create or replace function public.queue_deactivation_notice()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  begin
    if new.deactivated_at is not null and old.deactivated_at is null then
      insert into public.push_outbox (dedupe_key, source, kind, category, title, body, url, context)
      values ('notify.deactivated:' || new.id || ':' || extract(epoch from new.deactivated_at)::bigint,
              'event', 'notify.deactivated', 'account', 'account deactivated', '-', '/',
              jsonb_build_object('user_id', new.id,
                                 'by', case when auth.uid() = new.id then 'self' else 'suspended' end))
      on conflict (dedupe_key) do nothing;
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$function$;

revoke all on function public.queue_deactivation_notice() from public, anon, authenticated;

drop trigger if exists queue_deactivation_notice on public.profiles;
create trigger queue_deactivation_notice
  after update of deactivated_at on public.profiles
  for each row execute function public.queue_deactivation_notice();

-- Read back:
--   select count(*) from pg_trigger where tgname in ('queue_dispute_notice','queue_money_declined_notice',
--     'queue_order_lapse_notice','queue_deactivation_notice');   -- 4
