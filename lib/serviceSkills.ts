// Free-text skills that do not fragment into four tags for one job.
//
// A handyman is defined by what he has picked up rather than by a category
// anybody could write in advance. So the words are his — and the whole problem
// is that pure free text turns one job into "bricklaying", "brick laying",
// "brickwork" and "bricks", and a host searching one of them misses three
// tradesmen who do exactly that work.
//
// Pure functions, no queries, same shape as lib/listingRules.ts — so the
// sign-up, the reconcile route and the merge tool all normalise identically
// and can be tested without a database.

export type RegulatedConcept = 'gas' | 'oil' | 'electrical';

// The display form is what a host reads; the slug is what two spellings have
// to agree on; the compact form is what makes "brick laying" collide with
// "bricklaying" rather than becoming a tag of its own.
export interface SkillKey {
    label: string;
    slug: string;
    compact: string;
}

const MAX_LABEL = 40;

export function skillSlug(text: string | null | undefined): string {
    return String(text || '')
        .toLowerCase()
        // Accents folded, so "façade" and "facade" are one tag.
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        // Punctuation and dashes become spaces rather than vanishing, so
        // "brick-laying" reads as two words and not as "bricklaying" only by
        // accident.
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

export function skillCompact(text: string | null | undefined): string {
    return skillSlug(text).replace(/ /g, '');
}

// The three shapes of one tag. Returns null for anything that is not a tag:
// blank, or punctuation on its own.
//
// The label keeps the words the provider typed but not their capitals — "Dry
// Stone Dyking" and "dry stone dyking" should not look like two answers on a
// profile, and sentence case is what the seed list uses.
export function skillKey(text: string | null | undefined): SkillKey | null {
    const slug = skillSlug(text);
    if (!slug) return null;
    if (slug.length > MAX_LABEL) return null;

    const label = slug.charAt(0).toUpperCase() + slug.slice(1);

    return { label: label, slug: slug, compact: skillCompact(slug) };
}

// ---------------------------------------------------------------------------
// REGULATED WORK
// ---------------------------------------------------------------------------
//
// Deliberately three concepts rather than a taxonomy of every regulated trade
// in the UK. These are the only ones the site captures a checkable number for,
// and a list nobody maintains is worse than no list — it goes stale, and being
// confidently wrong about who may touch a boiler is worse than saying nothing.
//
// Matched loosely on purpose. This FLAGS, it never blocks: a false positive
// costs one item in the queue, and a miss is caught by reading the queue. That
// asymmetry is the entire argument for not blocking, and it is why nobody
// needs to get these patterns exactly right.
const REGULATED_PATTERNS: Array<{ concept: RegulatedConcept; pattern: RegExp }> = [
    // Oil first. "oil boiler servicing" contains "boiler", and OFTEC rather
    // than Gas Safe is the honest answer for it — most of Galloway is off the
    // gas grid, so this is the common case rather than the exception.
    { concept: 'oil', pattern: /\b(oftec|oil (boiler|tank|burner|fired)|kerosene)\b/ },

    { concept: 'gas', pattern: /\b(gas|boiler|combi|flue|lpg|hob|gas safe|central heating)\b/ },

    { concept: 'electrical', pattern: /\b(rewir\w*|electric\w*|consumer unit|fuse ?board|part ?p|socket\w*|distribution board|pat test\w*)\b/ },
];

// Which registration a tag needs, if any. Runs on the slug, so spelling and
// punctuation have already been settled.
export function regulatedConceptFor(text: string | null | undefined): RegulatedConcept | null {
    const slug = skillSlug(text);
    if (!slug) return null;

    for (const rule of REGULATED_PATTERNS) {
        if (rule.pattern.test(slug)) return rule.concept;
    }

    return null;
}

// Which registration scheme satisfies a concept. Part P is four bodies, so
// this returns a list rather than a scheme.
export function schemesSatisfying(concept: RegulatedConcept): string[] {
    if (concept === 'gas') return ['gas_safe'];
    if (concept === 'oil') return ['oftec'];
    return ['part_p_niceic', 'part_p_napit', 'part_p_elecsa', 'part_p_stroma'];
}

export interface SkillRow {
    id?: string;
    label?: string | null;
    slug?: string | null;
    regulated_concept?: string | null;
    merged_into?: string | null;
}

export interface VerifiedRegistration {
    scheme?: string | null;
    verified?: boolean;
}

// Whether a tag may be shown to a host.
//
// Not stored, worked out — so it follows the registration rather than needing
// to be kept in step with it. Edit the Gas Safe number and it un-verifies in
// the same statement, and "boiler repair" stops being public at the same
// moment, with nothing to remember and no job to run.
//
// An unregulated tag is always public. That is most of them.
export function skillIsPublic(
    skill: SkillRow | null | undefined,
    registrations: VerifiedRegistration[] | null | undefined
): boolean {
    if (!skill) return false;

    const concept = (skill.regulated_concept || null) as RegulatedConcept | null;
    if (!concept) return true;

    const allowed = schemesSatisfying(concept);

    return (registrations || []).some(
        (r) => r.verified === true && allowed.indexOf(String(r.scheme || '')) !== -1
    );
}

// The tags a provider has claimed that they cannot lawfully show. This is what
// the queue lists and what the sign-up explains.
export function blockedSkills(
    skills: SkillRow[] | null | undefined,
    registrations: VerifiedRegistration[] | null | undefined
): SkillRow[] {
    return (skills || []).filter((s) => !skillIsPublic(s, registrations));
}

// What a provider is told, which has to be a route rather than a refusal.
//
// A handyman tagging "boiler repair" can never satisfy the gate, because the
// handyman form does not ask about gas at all — so telling them "add your
// number" would send them looking for a field that is not there. Telling them
// which trade it belongs under is the thing we actually want them to do.
export function blockedSkillReason(
    skill: SkillRow | null | undefined,
    trade: string,
    asksForIt: boolean
): string {
    const concept = (skill && skill.regulated_concept) || '';
    const label = (skill && skill.label) || 'That';

    const body = concept === 'gas'
        ? 'Gas Safe registration'
        : concept === 'oil'
            ? 'OFTEC registration'
            : 'a Part P competent person scheme';

    if (asksForIt) {
        return label + ' needs ' + body + '. Add your number above and we will check it.';
    }

    const where = concept === 'electrical' ? 'Electrician' : 'Plumber';

    return label + ' needs ' + body + ', which we do not ask a '
        + trade + ' for. List it under ' + where + ' with your number and it will show there.';
}

// Type-ahead. Existing tags first, and only then the option of a new one —
// which is the mechanism, not a convenience: somebody offered "bricklaying"
// takes it, and somebody offered nothing types "brick laying".
//
// A merged tag never appears: it is an alias, and offering both halves of a
// merge back to people would undo the tidying.
export function suggestSkills(
    all: SkillRow[] | null | undefined,
    typed: string,
    already: string[] | null | undefined,
    limit?: number
): SkillRow[] {
    const slug = skillSlug(typed);
    const held = (already || []).map((s) => skillSlug(s));
    const max = limit || 8;

    if (!slug) return [];

    const live = (all || []).filter((s) => !s.merged_into);

    const scored = live
        .filter((s) => held.indexOf(String(s.slug || '')) === -1)
        .map((s) => {
            const candidate = String(s.slug || '');
            const compact = skillCompact(candidate);
            const typedCompact = skillCompact(slug);

            // Exact, then starts-with, then contains. A tradesman half way
            // through typing wants the thing he is typing, not an alphabetical
            // list of everything containing those letters.
            if (candidate === slug || compact === typedCompact) return { s, rank: 0 };
            if (candidate.indexOf(slug) === 0 || compact.indexOf(typedCompact) === 0) return { s, rank: 1 };
            if (candidate.indexOf(slug) !== -1 || compact.indexOf(typedCompact) !== -1) return { s, rank: 2 };
            return { s, rank: -1 };
        })
        .filter((x) => x.rank >= 0);

    scored.sort((a, b) => (a.rank - b.rank) || String(a.s.label).localeCompare(String(b.s.label)));

    return scored.slice(0, max).map((x) => x.s);
}

// Whether what they have typed would make a new tag rather than match one.
export function wouldCreateNew(
    all: SkillRow[] | null | undefined,
    typed: string
): boolean {
    const key = skillKey(typed);
    if (!key) return false;

    return !(all || []).some(
        (s) => String(s.slug || '') === key.slug || skillCompact(s.slug) === key.compact
    );
}
