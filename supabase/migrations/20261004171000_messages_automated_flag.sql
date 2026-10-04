-- An internal flag marking the messages the SYSTEM sent automatically, so the
-- "Meet your host" response rate and time count only a PERSON's reply as a
-- response — the way Airbnb does — and ignore automated sends.
--
-- It is INTERNAL ONLY: never shown to a guest or a host, and nothing about how
-- any message looks changes. The flag exists solely for the responsiveness
-- calculation (lib/hostResponsiveness.ts).
--
-- Set true in code at every automated send: the scheduled-template cron, the
-- check-in floor, the booking-confirmation-on-accept, and the canned one-line
-- notices for booking changes, money requests, access-code changes and
-- experience-order cancellations. Left false (the default) on the three human
-- send paths (the booking/enquiry/order message composers).
--
-- messages already has table-wide GRANT ALL gated by RLS (not column grants), so
-- this column needs no new grant. There is no UPDATE policy for the browser
-- roles, so a signed-in user can only set the flag at INSERT time on their own
-- message — which would only make their own reply not count as a response (no
-- incentive). The column is not swept into any column-privacy guard (those cover
-- listings / profiles / service_providers only).

alter table "public"."messages"
    add column if not exists "automated" boolean not null default false;

-- The dormant SQL sender mirrors the live cron; recreate it so it stamps the
-- flag too, in case it is ever run. Body is byte-for-byte the schema.sql version
-- except the one messages INSERT, which now carries automated = true.
create or replace function "public"."send_due_scheduled_messages"() returns integer
    language "plpgsql" security definer
    set "search_path" to 'public'
    as $$
declare
  rec         record;
  local_now   timestamp;
  local_hour  int;
  today       date;
  sent_count  int := 0;
begin
  local_now  := now() at time zone 'Europe/London';
  local_hour := extract(hour from local_now);
  today      := local_now::date;

  for rec in
    select
      b.id            as booking_id,
      b.guest_id,
      b.host_id,
      b.check_in,
      b.check_out,
      t.template_type,
      t.body,
      l.title         as listing_title,
      coalesce(
        nullif(p.preferred_name, ''),
        case when coalesce(p.show_full_name, true) then nullif(p.full_name, '') end,
        'there'
      )               as guest_name
    from public.message_templates t
    join public.bookings b
      on b.host_id = t.user_id
     and b.status  = 'confirmed'
    left join public.listings l on l.id = b.listing_id
    left join public.profiles p on p.id = b.guest_id
    where t.enabled
      and t.body <> ''
      and t.anchor <> 'none'
      and (
            array_length(t.listing_ids, 1) is null
         or b.listing_id = any (t.listing_ids)
      )
      and (
            (   t.anchor = 'booking'
            and b.confirmed_at is not null
            and now() >= b.confirmed_at + (t.minutes_after || ' minutes')::interval )

         or (   t.anchor = 'check_in'
            and b.check_in - t.days_offset = today
            and t.send_hour = local_hour )

         or (   t.anchor = 'after_check_in'
            and b.check_in = today
            and local_hour = least(
                  extract(hour from coalesce(l.check_in_time, '15:00'::time))::int + t.hours_after,
                  23) )

            -- Counted back from the moment they actually have to leave.
            -- 11am check-out with "12 hours before" sends at 11pm the
            -- night before.
         or (   t.anchor = 'before_check_out'
            and date_trunc('hour',
                  (b.check_out::timestamp + coalesce(l.check_out_time, '11:00'::time))
                  - (t.hours_before || ' hours')::interval
                ) = date_trunc('hour', local_now) )

         or (   t.anchor = 'check_out'
            and b.check_out - t.days_offset = today
            and t.send_hour = local_hour )
      )
      and not exists (
            select 1 from public.sent_scheduled_messages s
            where s.booking_id = b.id
              and s.template_type = t.template_type
      )
  loop
    begin
      insert into public.sent_scheduled_messages (booking_id, template_type)
      values (rec.booking_id, rec.template_type);
    exception when unique_violation then
      continue;
    end;

    insert into public.messages (booking_id, sender_id, recipient_id, body, automated)
    values (
      rec.booking_id,
      rec.host_id,
      rec.guest_id,
      public.render_template(rec.body, rec.guest_name, rec.listing_title, rec.check_in, rec.check_out),
      true
    );

    sent_count := sent_count + 1;
  end loop;

  return sent_count;
end;
$$;

-- Backfill existing automated messages.
--
-- (1) The scheduled templates, the check-in floor and the accept-time
-- confirmation each claim a sent_scheduled_messages row for the booking in the
-- same breath as writing the message, so the automated message is the host->
-- guest message on that booking written at the same moment as the claim. (On
-- TEST the message's created_at and the claim's sent_at land 0.3s apart; a five-
-- minute window is a wide, safe margin that still can't catch a human reply.)
update "public"."messages" m
   set "automated" = true
  from "public"."sent_scheduled_messages" s
  join "public"."bookings" b on b."id" = s."booking_id"
 where m."booking_id" = s."booking_id"
   and m."sender_id" = b."host_id"
   and m."recipient_id" = b."guest_id"
   and m."created_at" between s."sent_at" - interval '5 minutes'
                         and s."sent_at" + interval '5 minutes';

-- (2) The canned one-line notices keep no sent log, so they are matched by their
-- fixed wording. Substrings are chosen to avoid apostrophes and em dashes (whose
-- encoding can vary), while staying distinctive enough that a person would not
-- type them: the instant-applied change notice, the money request, the door-code
-- -changed notice, and the experience-order cancel request (an order thread, so
-- not reachable through the booking join above).
update "public"."messages"
   set "automated" = true
 where "automated" = false
   and (
         "body" like '% updated the booking %No change to the price, so it%'
      or "body" like '%asked you for %follow up here%'
      or "body" like '%the door code has changed to %'
      or "body" like '%no longer able to make this booking and would like to cancel%'
   );

-- PostgREST caches the schema; nudge it so the new column is reachable at once.
notify pgrst, 'reload schema';

-- Read back:
--   select column_name, data_type, column_default
--     from information_schema.columns
--    where table_schema='public' and table_name='messages' and column_name='automated';
--   -- expected: automated | boolean | false
--   select count(*) filter (where automated)     as automated,
--          count(*) filter (where not automated) as human
--     from public.messages;
