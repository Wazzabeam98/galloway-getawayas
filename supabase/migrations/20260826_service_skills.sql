-- Free-text skills, without the four-tags-for-one-job problem.
--
-- A handyman is defined by what he has picked up rather than by a category
-- anybody could write in advance — bricklaying, fencing, laying slabs, dry
-- stone dyking. So the tags are theirs to write. The whole design problem is
-- that pure free text gives you "bricklaying", "brick laying", "brickwork" and
-- "bricks" as four tags, and a host searching one of them misses three
-- tradesmen who do exactly that job.
--
-- THREE THINGS STOP THAT
--
--   `slug`     lowercased, punctuation stripped, whitespace collapsed. Catches
--              "Bricklaying" against "bricklaying".
--   `compact`  the slug with the spaces taken out as well, and unique — which
--              is what makes "brick laying" collide with "bricklaying" rather
--              than becoming its own tag. That one split is the common case.
--   merging    for everything else. "brickwork" and "bricks" are a judgement
--              nothing automatic can safely make, so they are tidied by hand
--              at /admin/skills.
--
-- MERGING POINTS, IT DOES NOT DELETE
--
-- `merged_into` keeps the losing tag as an alias: the providers are repointed,
-- the old word still resolves, the merge can be undone, and there is a record
-- of what was merged. Deleting the row gives none of that and cannot be
-- reversed.
--
-- REGULATED WORK
--
-- Some skills are not a matter of skill. "Boiler repair" is Gas Safe territory
-- and "rewiring" is Part P, and a host must not book somebody for work they
-- cannot lawfully do.
--
-- `regulated_concept` names which of the three registrations the site already
-- captures a tag needs. Three, not a taxonomy of every regulated trade in the
-- UK — these are the only ones with a number behind them that can be checked,
-- and a list nobody maintains is worse than no list.
--
-- Whether a provider may actually SHOW such a tag is deliberately not stored.
-- It is worked out from whether that listing holds a verified registration for
-- the concept, so it follows the registration: edit the number, it
-- un-verifies, and the tag goes private in the same statement. See
-- skillIsPublic() in lib/serviceSkills.ts.
--
-- WRITTEN SERVER-SIDE ONLY
--
-- Neither table is writable from a browser. A provider who could insert their
-- own skill row could set `regulated_concept` to null and tag themselves as a
-- gas fitter, so the reconcile happens in /api/services/skills under the
-- service role. Reading is open, because the type-ahead needs it.
--
-- Pre-flight:
--   select table_name from information_schema.tables
--    where table_schema = 'public' and table_name like 'service%skill%';
--
-- Safe to run twice. Run on test first, then production.

create table if not exists "public"."service_skills" (
    "id"                uuid primary key default gen_random_uuid(),

    -- What a host reads. "Dry stone dyking", not "dry_stone_dyking".
    "label"             text not null,

    "slug"              text not null,
    "compact"           text not null,

    "regulated_concept" text,

    -- Set when this tag has been merged into another. The row stays as an
    -- alias rather than being removed.
    "merged_into"       uuid references "public"."service_skills"("id"),

    "created_at"        timestamptz not null default now(),

    constraint "service_skills_slug_key" unique ("slug"),
    constraint "service_skills_compact_key" unique ("compact"),
    constraint "service_skills_label_check" check (btrim("label") <> ''),
    constraint "service_skills_concept_check"
        check ("regulated_concept" is null
               or "regulated_concept" in ('gas', 'oil', 'electrical')),
    -- A tag cannot be merged into itself, which would make lookups loop.
    constraint "service_skills_merge_check" check ("merged_into" is distinct from "id")
);

create table if not exists "public"."service_provider_skills" (
    "provider_id" uuid not null references "public"."service_providers"("id") on delete cascade,
    "skill_id"    uuid not null references "public"."service_skills"("id") on delete cascade,
    "created_at"  timestamptz not null default now(),

    primary key ("provider_id", "skill_id")
);

create index if not exists "service_skills_merged_idx"
    on "public"."service_skills" ("merged_into")
    where "merged_into" is not null;

create index if not exists "service_skills_regulated_idx"
    on "public"."service_skills" ("regulated_concept")
    where "regulated_concept" is not null;

create index if not exists "service_provider_skills_skill_idx"
    on "public"."service_provider_skills" ("skill_id");

alter table "public"."service_skills"          enable row level security;
alter table "public"."service_provider_skills" enable row level security;

-- Read by anyone: the type-ahead has to see every existing tag before somebody
-- can be offered one, and that is the whole anti-fragmentation mechanism.
-- Nothing is written from a browser — see the note above.
revoke all on table "public"."service_skills"          from "anon", "authenticated";
revoke all on table "public"."service_provider_skills" from "anon", "authenticated";

grant select on table "public"."service_skills"          to "anon", "authenticated";
grant select on table "public"."service_provider_skills" to "anon", "authenticated";

grant all on table "public"."service_skills"          to "service_role";
grant all on table "public"."service_provider_skills" to "service_role";

drop policy if exists "skills are public" on "public"."service_skills";
create policy "skills are public"
    on "public"."service_skills"
    for select
    using (true);

-- A provider's own tags are theirs to see whatever state their listing is in;
-- everyone else sees the tags of a listing that is live.
drop policy if exists "skills of approved providers are public" on "public"."service_provider_skills";
create policy "skills of approved providers are public"
    on "public"."service_provider_skills"
    for select
    using (exists (
        select 1 from "public"."service_providers" p
         where p."id" = "service_provider_skills"."provider_id"
           and (p."status" = 'approved' or p."owner_id" = auth.uid())
    ));

-- ---------------------------------------------------------------------------
-- THE STARTER LIST
-- ---------------------------------------------------------------------------
--
-- Seeded because the first ten tradesmen are exactly when fragmentation
-- happens: with an empty table the type-ahead offers nothing, everybody
-- invents their own wording, and the tidying job starts on day one.
--
-- These are the layer underneath the offerings tick boxes rather than a repeat
-- of them — "blocked toilet" is already a checkbox, so it is not here. What is
-- here is the work nobody could have written a category for in advance.
--
-- Regulated ones are seeded WITH their concept, so the very first "boiler
-- repair" is gated correctly rather than depending on the pattern matcher
-- catching it.
insert into "public"."service_skills" ("label", "slug", "compact", "regulated_concept")
values
    ('Bricklaying',            'bricklaying',            'bricklaying',          null),
    ('Pointing and repointing','pointing and repointing','pointingandrepointing',null),
    ('Plastering',             'plastering',             'plastering',           null),
    ('Rendering',              'rendering',              'rendering',            null),
    ('Dry stone dyking',       'dry stone dyking',       'drystonedyking',       null),
    ('Fencing',                'fencing',                'fencing',              null),
    ('Gates',                  'gates',                  'gates',                null),
    ('Laying slabs',           'laying slabs',           'layingslabs',          null),
    ('Block paving',           'block paving',           'blockpaving',          null),
    ('Decking',                'decking',                'decking',              null),
    ('Tiling',                 'tiling',                 'tiling',               null),
    ('Grouting and sealing',   'grouting and sealing',   'groutingandsealing',   null),
    ('Plasterboarding',        'plasterboarding',        'plasterboarding',      null),
    ('Coving and cornice',     'coving and cornice',     'covingandcornice',     null),
    ('Skirting and architrave','skirting and architrave','skirtingandarchitrave',null),
    ('Hanging doors',          'hanging doors',          'hangingdoors',         null),
    ('Sash window repair',     'sash window repair',     'sashwindowrepair',     null),
    ('Double glazing repair',  'double glazing repair',  'doubleglazingrepair',  null),
    ('Guttering',              'guttering',              'guttering',            null),
    ('Slating',                'slating',                'slating',              null),
    ('Leadwork',               'leadwork',               'leadwork',             null),
    ('Chimney repair',         'chimney repair',         'chimneyrepair',        null),
    ('Flat roofing',           'flat roofing',           'flatroofing',          null),
    ('Roughcasting',           'roughcasting',           'roughcasting',         null),
    ('Damp proofing',          'damp proofing',          'dampproofing',         null),
    ('Insulation',             'insulation',             'insulation',           null),
    ('Loft boarding',          'loft boarding',          'loftboarding',         null),
    ('Kitchen fitting',        'kitchen fitting',        'kitchenfitting',       null),
    ('Bathroom fitting',       'bathroom fitting',       'bathroomfitting',      null),
    ('Wet rooms',              'wet rooms',              'wetrooms',             null),
    ('Flooring',               'flooring',               'flooring',             null),
    ('Laminate and vinyl',     'laminate and vinyl',     'laminateandvinyl',     null),
    ('Painting and decorating','painting and decorating','paintinganddecorating',null),
    ('Wallpapering',           'wallpapering',           'wallpapering',         null),
    ('Pressure washing',       'pressure washing',       'pressurewashing',      null),
    ('Groundworks',            'groundworks',            'groundworks',          null),
    ('Drainage',               'drainage',               'drainage',             null),
    ('Septic tanks',           'septic tanks',           'septictanks',          null),
    ('Stove installation',     'stove installation',     'stoveinstallation',    null),
    ('Log burners',            'log burners',            'logburners',           null),
    ('Hot tub servicing',      'hot tub servicing',      'hottubservicing',      null),
    ('Appliance repair',       'appliance repair',       'appliancerepair',      null),
    ('Locksmithing',           'locksmithing',           'locksmithing',         null),
    ('Furniture assembly',     'furniture assembly',     'furnitureassembly',    null),
    ('Boiler repair',          'boiler repair',          'boilerrepair',         'gas'),
    ('Boiler servicing',       'boiler servicing',       'boilerservicing',      'gas'),
    ('Gas fitting',            'gas fitting',            'gasfitting',           'gas'),
    ('Oil boiler servicing',   'oil boiler servicing',   'oilboilerservicing',   'oil'),
    ('Oil tank replacement',   'oil tank replacement',   'oiltankreplacement',   'oil'),
    ('Rewiring',               'rewiring',               'rewiring',             'electrical'),
    ('Consumer unit upgrades', 'consumer unit upgrades', 'consumerunitupgrades', 'electrical'),
    ('Electrical testing',     'electrical testing',     'electricaltesting',    'electrical')
on conflict ("compact") do nothing;
