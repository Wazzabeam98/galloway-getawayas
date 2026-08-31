-- Guest experiences, v2: the person behind the price, and the "something else"
-- trade that has no fixed category.
--
-- NOT LIVE UNTIL THE CODE IS. This lands on test first. It adds columns only;
-- it changes no existing row and no existing behaviour. Every column is
-- nullable, so an existing provider stays valid with all of them empty.
--
-- TWO THINGS ARE HAPPENING HERE, AND THEY ARE KEPT APART BY WHO MAY WRITE THEM.
--
-- 1. WHO THEY ARE. A guest is choosing someone to come into the cottage they
--    are sleeping in, so the listing has to carry a bit of the person and not
--    only what they charge. These five are the provider's own words about
--    themselves, edited from the browser the same way description and photos
--    are — so they are granted to `authenticated`, insert and update.
--
-- 2. WHAT STRIPE IS TOLD, FOR AN "OTHER" PROVIDER. A chef is always a caterer
--    (MCC 5811, from the table in lib/serviceOrders.ts). "Something else" has
--    no fixed category by definition — the owner reads what they described and
--    assigns the code by hand at approval. Those columns are the platform's,
--    written only by the admin route under the service role, and are NOT
--    granted to authenticated: a browser that could set its own MCC could hand
--    itself a payout category we never chose. Same posture as status and
--    commission_rate.

-- 1. WHO THEY ARE — provider's own words, browser-editable.
alter table public.service_providers
    -- The person, not just the business. Many of these are one person, and
    -- "Baxter Plumbing" framing is wrong for a chef coming to cook dinner.
    add column if not exists provider_name text,
    -- Their story in their own words: who they are, where they are from, how
    -- long they have done this. The trust paragraph.
    add column if not exists about text,
    -- A single portrait, kept apart from the work gallery (photos). A face
    -- matters when someone is coming into your home; a plate of food does not
    -- answer "who is arriving". A storage path, like logo and photos.
    add column if not exists headshot text,
    -- A short line shown under the name — "Kirkcudbright · cooking since 2019".
    -- Deliberately a one-liner (a subtitle), not a second paragraph, so it does
    -- not duplicate `about`.
    add column if not exists based_line text,
    -- What a guest needs to know before booking that is not the price: allergies
    -- and dietary limits, the cancellation terms, whether they bring their own
    -- equipment. Said in the provider's own words rather than captured as
    -- fields, because every trade's version of it is different.
    add column if not exists what_to_expect text;

-- The provider sets and edits these from the browser, so they are granted to
-- authenticated exactly as experience_price is
-- (20260829030000_service_orders_and_provider_connect). The Stripe/category
-- columns below are deliberately absent from this grant.
grant insert (provider_name, about, headshot, based_line, what_to_expect),
      update (provider_name, about, headshot, based_line, what_to_expect)
    on table public.service_providers to authenticated;

-- 2. THE "OTHER" CATEGORY — assigned by the owner at approval, service role only.
alter table public.service_providers
    -- The Merchant Category Code the owner picks for a "something else" provider
    -- after reading what they described. For every other guest trade this stays
    -- null and the code comes from the trade's own entry in TRADE_MCC. See
    -- lib/serviceOrders.ts mccForProvider / stripeProfileForProvider.
    add column if not exists stripe_mcc text,
    -- What the connected account is told it sells, alongside the MCC. Set with
    -- the code, for an "other" provider only.
    add column if not exists stripe_product_description text,
    -- The word a guest reads on the shop. "Private chef" is fixed for a chef;
    -- "something else" is meaningless to a guest, so the owner types the real
    -- word ("Massage therapy", "Photographer") when they assign the code. Null
    -- for the fixed trades, which read their word off the trade.
    add column if not exists custom_label text,
    -- Who assigned the category, and when. It decides a payout category — a
    -- money-path decision — so it is recorded the same way a verified
    -- registration records verified_by.
    add column if not exists category_assigned_by uuid references auth.users(id),
    add column if not exists category_assigned_at timestamptz;

comment on column public.service_providers.stripe_mcc is
    'Owner-assigned MCC for an "other" provider, set at approval by the admin '
    'route under the service role. Null for fixed trades, which read the code '
    'from TRADE_MCC. See lib/serviceOrders.ts mccForProvider.';

comment on column public.service_providers.custom_label is
    'The guest-facing category word for an "other" provider, assigned with the '
    'MCC. The shop shows this instead of the meaningless "something else".';
