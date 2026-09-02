-- Two fields for a guest cancelling an experience they've already paid for.
--
-- cancel_ack — the record of a WALK-AWAY. A guest inside the no-refund window can
-- now cancel anyway and forfeit what they paid (the provider keeps it and gets
-- the date back). A guest who gets nothing back is a guest who might dispute the
-- charge, so on that cancel we store exactly what they were shown and agreed to:
-- the amount forfeited, the date, and the sentence in front of them when they
-- pressed the button. That is the evidence if the charge is ever disputed.
--
-- cancellation_requested_at — the "ask first" flag. Rather than only a hard
-- cancel, a guest inside the window can ask the provider to refund. This stamps
-- when they asked, so the guest sees "cancellation requested" and the provider is
-- nudged, without the order leaving 'confirmed' until someone acts.
--
-- Safe to run twice. Run on test first, then production.

alter table "public"."service_orders"
    add column if not exists "cancel_ack" jsonb,
    add column if not exists "cancellation_requested_at" timestamptz;

comment on column "public"."service_orders"."cancel_ack" is
    'Walk-away record: what the guest was shown and agreed to when they cancelled '
    'a paid order with no refund. { amount, currency, shown, at }. Dispute evidence.';
comment on column "public"."service_orders"."cancellation_requested_at" is
    'When the guest asked the provider to refund (the "ask first" path). The order '
    'stays confirmed until the provider refunds or it is cancelled.';
