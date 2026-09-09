-- The guest experience's content answers, given a home on the provider row.
--
-- NOT LIVE UNTIL THE CODE IS. Test first. It adds one nullable column and
-- changes no existing row: an existing provider stays valid with it null.
--
-- WHY A COLUMN NOW, AND WHY JSONB.
--
-- The seven answers a guest writes about their experience — how long they have
-- done it, their title, their qualifications, any endorsements, what a guest
-- can expect, what is included, what to bring — had no column. They rode only
-- in service_applications.payload (jsonb) and were materialised at the emailed
-- link, because the applicant was anonymous for the whole wizard and could not
-- write a provider row.
--
-- That is changing: the guest now signs in up front (email OTP, straight after
-- the category pick), so the wizard runs authenticated and writes its own
-- provider row as it goes — like a returning provider already does. For that to
-- carry these seven answers they need somewhere on the row to live.
--
-- One jsonb column rather than seven text columns: they are a single blob of
-- the provider's own words, read together at review and shown together on the
-- listing, never queried field by field. `what_to_expect` already has a text
-- column from 20260831210000; it is left as it is and this becomes the single
-- home the wizard writes, so there is one place to read rather than a split.
--
-- Browser-editable, the same as description, photos and the other own-words
-- columns, so it is granted to authenticated for insert and update. RLS still
-- confines each write to the owner's own row ("owners manage their own
-- provider", 20260824050425).

alter table public.service_providers
    add column if not exists guest_details jsonb;

comment on column public.service_providers.guest_details is
    'The guest experience content answers in the provider''s own words — '
    'years_experience, professional_title, qualifications, recognition, '
    'what_to_expect, whats_included, what_to_bring — written by the applicant '
    'during the (now signed-in) wizard. See GUEST_CONTENT_KEYS in '
    'lib/serviceApplications.ts and guestContentFields in ProviderSignUp.';

grant insert (guest_details), update (guest_details)
    on table public.service_providers to authenticated;

-- PostgREST caches the schema; a new column 404s on write until it reloads.
notify pgrst, 'reload schema';
