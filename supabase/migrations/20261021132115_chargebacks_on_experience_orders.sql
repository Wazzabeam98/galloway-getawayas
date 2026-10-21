-- chargebacks on experience orders
--
-- WHAT GOES WRONG WITHOUT IT. When a guest's bank disputes the payment for an
-- EXPERIENCE, the Stripe webhook records the dispute but can only tie it to a
-- holiday-let booking (bookings.stripe_payment_intent_id) — so it is stored with
-- no booking, the directors' alert links nowhere useful, and the provider is
-- never told (queue_dispute_notice only fires for a dispute with a booking).
-- Their payout is quietly held by the experience payout run ("the charge is
-- disputed") with no word to them. A host in the same position is emailed and
-- pushed; a provider should be too.
--
-- HOW. disputes.order_id ties a dispute to the experience order the webhook
-- finds by its payment intent. queue_dispute_notice now records the same
-- 'notify.chargeback' row for a dispute with an order as for one with a booking;
-- the push job (lib/eventEmails) sends the provider's email. The function is
-- otherwise as 20261019174205 left it: it only records, never sends, and
-- swallows its own errors so a chargeback is always recorded.
--
-- PRE-FLIGHT. Not destructive: a nullable column (every existing row null), an
-- index, a replaced trigger function and its trigger. Safe to run twice.

alter table public.disputes
    add column if not exists order_id uuid references public.service_orders (id) on delete set null;

create index if not exists disputes_order_id_idx on public.disputes (order_id);

create or replace function public.queue_dispute_notice()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  anchored boolean := (new.booking_id is not null or new.order_id is not null);
  was_anchored boolean := (tg_op = 'UPDATE' and (old.booking_id is not null or old.order_id is not null));
begin
  begin
    if anchored and (tg_op = 'INSERT' or not was_anchored) then
      insert into public.push_outbox (dedupe_key, source, kind, category, title, body, url, context)
      values ('notify.chargeback.opened:' || new.id, 'event', 'notify.chargeback', 'payments',
              'chargeback opened', '-', '/', jsonb_build_object('dispute_id', new.id, 'stage', 'opened'))
      on conflict (dedupe_key) do nothing;
    end if;
    if anchored and new.closed_at is not null
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
  after insert or update of booking_id, order_id, closed_at on public.disputes
  for each row execute function public.queue_dispute_notice();

notify pgrst, 'reload schema';

-- Read back:
--   select column_name from information_schema.columns where table_name = 'disputes' and column_name = 'order_id';  -- order_id
--   select position('new.order_id' in pg_get_functiondef('public.queue_dispute_notice()'::regprocedure)) > 0;          -- true
--   select tgname from pg_trigger where tgname = 'queue_dispute_notice' and not tgisinternal;                           -- queue_dispute_notice
