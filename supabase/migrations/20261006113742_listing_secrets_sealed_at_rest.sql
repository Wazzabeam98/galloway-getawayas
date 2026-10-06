-- Door codes and wifi passwords are encrypted in the app before they are
-- stored (lib/secretBox: AES-256-GCM, key LISTING_SECRETS_KEY, set only in
-- Vercel), so a copy of this database shows only ciphertext. Every write goes
-- through the server routes, which seal; this makes the database refuse a
-- plain value written any other way — a script, a hand-typed SQL insert, an
-- old build — so "only ciphertext at rest" holds whatever writes the row.
--
-- Sealed values start "v1:". No row means no code; a null wifi password means
-- none.
--
-- APPLY ONLY AFTER every existing value is sealed: run
-- /api/cron/seal-listing-secrets (Vercel → the project → Settings → Cron Jobs →
-- seal-listing-secrets → Run) with the key set, and check it reports nothing
-- left to seal. VALIDATE then checks every existing row; if anything plain is
-- left, this fails and changes nothing.

alter table public.listing_access_codes
    add constraint listing_access_codes_code_sealed
    check (code like 'v1:%') not valid;
alter table public.listing_access_codes
    validate constraint listing_access_codes_code_sealed;

alter table public.booking_access_codes
    add constraint booking_access_codes_code_sealed
    check (code like 'v1:%') not valid;
alter table public.booking_access_codes
    validate constraint booking_access_codes_code_sealed;

alter table public.listing_arrival
    add constraint listing_arrival_wifi_password_sealed
    check (wifi_password is null or wifi_password like 'v1:%') not valid;
alter table public.listing_arrival
    validate constraint listing_arrival_wifi_password_sealed;
