-- A chef cannot be in two cottages on one evening.
--
-- THE GAP THIS CLOSES. service_orders had only two non-unique indexes. Nothing
-- stopped two guests each holding the same provider for the same date, and a
-- provider could confirm both — two cards captured for one evening, the kind of
-- thing you apologise for on day one. Proven on test: two 'authorised' rows for
-- one provider and one service_date inserted without complaint.
--
-- THE RULE. One live order per provider per date. "Live" is the two states that
-- hold the slot: 'authorised' (a hold is placed, awaiting the provider) and
-- 'confirmed' (captured, it is happening). The four terminal states —
-- 'declined', 'expired', 'cancelled', 'refunded' — free the slot again, so they
-- are outside the index: a declined request must not block the next guest, and
-- a refunded booking must let someone else take the evening.
--
-- A PARTIAL UNIQUE INDEX, not a table constraint, precisely because of that: the
-- uniqueness has to apply to the live rows only, and Postgres expresses
-- "unique among the rows matching this predicate" as a partial unique index.
--
-- This is the hard guarantee. The order route also checks first for a friendly
-- early refusal, and the webhook releases the hold if it loses the race and the
-- insert is rejected here — but those are courtesies. This is the line the
-- database will not let anything cross, whatever the routes do.
--
-- NOT LIVE UNTIL THE CODE IS. Lands on test first. Adds an index; changes no
-- existing row. If two live duplicates already existed it would fail to build —
-- there are none (checked), and there cannot be a legitimate one.
create unique index if not exists service_orders_one_live_per_provider_date
    on public.service_orders (provider_id, service_date)
    where status in ('authorised', 'confirmed');

comment on index public.service_orders_one_live_per_provider_date is
    'One live order per provider per date. Live = authorised or confirmed; the '
    'four terminal states free the slot. The hard guard behind the order route '
    'pre-check and the webhook race-loser release.';
