-- A name and a line is what a real chef will actually write.
--
-- The guest "who they are" profile was five fields: provider_name, based_line,
-- about, what_to_expect, headshot (plus the photo gallery). Walking it, two of
-- them earned their place and two did not: `about` (a bio paragraph) overlapped
-- based_line and the description, and `what_to_expect` (allergies, access,
-- cancellation) half-repeated the description — and, with real cancellation and
-- refunds now built, its cancellation half is said better in the flow than in a
-- box a chef would mostly leave blank.
--
-- So the profile is cut back to what gets filled in: a name, a one-line
-- subtitle, a photo of the person, and the gallery — which is the listing. This
-- drops the two columns. Their grants to `authenticated` go with them.
--
-- SAFE TO DROP. Guest experiences are behind a flag and there are no approved
-- providers on production, so no real listing loses words. Lands on test first.
alter table public.service_providers
    drop column if exists about,
    drop column if exists what_to_expect;
