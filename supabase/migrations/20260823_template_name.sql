-- A name for each scheduled message.
--
-- With one template per kind the kind *was* the name. With three check-in
-- messages, one per cottage, the list shows three identical rows and the only
-- way to tell them apart is to open each property picker in turn.
--
-- The name is for the host's own list. It is never sent, never rendered to a
-- guest, and no placeholder exposes it — the sender reads `body` and the
-- scheduling columns and nothing else.
--
-- Backfilled to the kind's own label, which is what every existing row was
-- effectively called already.
--
-- Safe to run twice.
--
-- PRE-FLIGHT — expect 0 rows:
--
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'message_templates'
--     and column_name = 'name';

alter table public.message_templates
    add column if not exists name text;

comment on column public.message_templates.name is
    'Host-facing label for their own list. Never shown to a guest and never part of a sent message.';

-- What each kind was already called in the editor.
update public.message_templates
   set name = case template_type
        when 'booking_confirmation' then 'Booking confirmation'
        when 'checkin_details'      then 'Check-in details'
        when 'checkin_day'          then 'Checking in with guest'
        when 'checkout_details'     then 'Check-out details'
        else template_type
       end
 where name is null or btrim(name) = '';
