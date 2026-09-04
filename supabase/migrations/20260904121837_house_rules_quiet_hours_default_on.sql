-- House rules: quiet hours 10pm–7am is a default every listing carries.
--
-- A guest should see sensible house rules whether or not the host ever opened
-- the House rules screen: no events, no smoking, no commercial photography, and
-- quiet hours 10pm–7am. The three "no" rules are already the false defaults of
-- their NOT NULL boolean columns, so they need nothing here. Quiet hours was the
-- one that defaulted OFF; flip its default ON so a new listing carries it too.
--
-- Presented as the listing's house rules, not as law — no claim about council or
-- nationwide noise rules. The host can change the times or turn quiet hours off
-- in the editor, exactly as before.

alter table listings alter column quiet_hours_enabled set default true;

-- Backfill listings that sat on the old default (off). House rules were never
-- shown to a guest before this change, so no host relied on quiet hours being
-- off; give every such listing the standard 10pm–7am. Listings a host had
-- already switched on keep their own times.
update listings
set quiet_hours_enabled = true,
    quiet_hours_start = coalesce(nullif(quiet_hours_start, ''), '22:00'),
    quiet_hours_end   = coalesce(nullif(quiet_hours_end, ''), '07:00')
where quiet_hours_enabled = false;
