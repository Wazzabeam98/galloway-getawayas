// What a listing needs before it can be on the site, in one place.
//
// These rules used to exist twice: once inside the wizard, step by step, and
// once — a subset of them — inside the edit screen. That is how a listing went
// live with no title. The wizard learned to check for one and the edit screen
// did not, because nothing connected the two, and nothing ever will connect
// two copies of a rule.
//
// So: one list, and every surface asks it rather than answering for itself.
// The wizard asks per step and again on publish, the edit screen asks on save,
// and /api/listings/save asks last, on the server, where a browser cannot
// argue with it.
//
// Nothing here applies to drafts. Save & finish later exists precisely so a
// half-written listing can be put down, and holding a draft to the standard of
// a published listing would break the one feature that makes the wizard
// survivable.

// Every real UK format, from "M1 1AA" to "EC1A 1BB". Used to catch a town name
// typed into the postcode box, not to prove the place exists.
export const UK_POSTCODE = /^[A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2}$/i;

// A listing cannot be PUBLISHED without a real street address and postcode —
// you can't list accommodation that doesn't exist, and a booked guest has to be
// sent somewhere. This is the SERVER half of the address/postcode PUBLISH_RULES
// below: the wizard shows them client-side, but the publish endpoint must refuse
// a publish that lacks them too, or a direct API call (or a listing that
// predates the rule) slips through. Gates the FIRST publish only — re-showing an
// already-live listing (visibility un-hide) is left alone, so a host can still
// manage a grandfathered address-less listing. Takes a raw listings row and
// returns a host-readable sentence, or null when it's fit to publish. The
// address stays hidden from guests until they book (walling is elsewhere).
export function addressBlockerForPublish(
    row: { street_address?: string | null; postcode?: string | null },
): string | null {
    const street = String(row.street_address || '').trim();
    const postcode = String(row.postcode || '').trim();
    if (!street) return 'Add the street address before publishing — a booked guest needs somewhere to be sent.';
    if (!postcode) return 'Add a postcode before publishing.';
    if (!UK_POSTCODE.test(postcode)) return 'That postcode doesn’t look right — please check it before publishing.';
    return null;
}

// Not a business rule — a typo catcher, for the extra zero on £500. Raise it if
// a big group property ever needs more.
export const MAX_PRICE_PER_NIGHT = 5000;

// Three, because it is the number that costs an honest host nothing and an
// empty listing everything. Any real self-catering property has wifi, parking
// or a kitchen — most have all three — so a host who has actually filled the
// form in never meets this rule. What it stops is the listing that went up
// with nothing ticked, which sits next to a filled-in one in search results
// and loses the booking to it.
export const MIN_AMENITIES = 3;

// ---------------------------------------------------------------------------
// WHAT EARNS A BADGE ON A CARD
//
// Two at most, and only these. A badge is not a summary of the property, it is
// the one or two things that make somebody click this card instead of the one
// beside it — and the moment there are three of them nobody reads any.
//
// WHY THESE TWO AND NOT THE OTHER SIXTEEN
//
// Because they are what people type into Google, which is not the same as what
// is interesting about a cottage. The evidence is what the big agencies spend
// their own SEO money on: Sykes, cottages.com, holidaycottages.co.uk, Snaptrip
// and Independent Cottages all keep a standing landing page for hot tubs and
// another for dog-friendly, and Sykes keeps BOTH of them cut to Dumfries &
// Galloway specifically — "dog-friendly-cottages-dumfries-galloway" and
// "dumfries-galloway-hot-tub-breaks". There are also whole businesses that
// exist to list nothing but hot tub cottages. Nobody runs a landing page for
// outdoor furniture.
//
// So this list is a claim about search demand, not about quality. A log burner
// or a sea view might sell a particular cottage harder; they are not what an
// unfamiliar guest types, and the badge is aimed at the guest who has not
// arrived yet.
//
// The order is the order they appear in. It agrees with DECIDES_ON in
// components/AmenityList.tsx, which ranks the same two first and fourth for
// the same reason — if these two lists ever disagree, that one is about the
// detail page and this one is about the card, and this one wins here.
//
// The cap is enforced below rather than by this list being short, because the
// list getting longer is exactly how the cap would otherwise be lost.
export const BADGE_AMENITIES: Array<{ amenity: string; label: string; title: string }> = [
    { amenity: 'Hot tub', label: 'Hot tub', title: 'Hot tub' },
    { amenity: 'Pets allowed', label: 'Pet friendly', title: 'Dogs welcome' },
];

export const MAX_CARD_BADGES = 2;

// What to show on one card, in order, capped.
//
// Reads the amenities the host has already ticked — there is no separate flag
// to set and nothing for a host to keep in step, which is the whole reason the
// paw was built this way and the reason the hot tub matches it.
export function cardBadges(amenities: string[] | null | undefined) {
    if (!Array.isArray(amenities)) return [];

    return BADGE_AMENITIES
        .filter((b) => amenities.indexOf(b.amenity) !== -1)
        .slice(0, MAX_CARD_BADGES);
}

// The shape the rules read. Every surface builds one of these out of whatever
// it happens to hold — wizard state, edit-screen state, a database row — so no
// rule has to know where its answer came from.
export interface ListingForRules {
    propertyType?: string | null;
    flat?: string | null;
    propertyName?: string | null;
    street?: string | null;
    city?: string | null;
    region?: string | null;
    postcode?: string | null;
    photoCount?: number;
    title?: string | null;
    description?: string | null;
    price?: number | string | null;
    // Optional and usually absent: only the calendar's Pricing tab collects
    // one. A listing without a weekend price passes the ceiling rule below
    // rather than failing it.
    weekendPrice?: number | string | null;
    amenities?: string[] | null;
    checkInMethod?: string | null;
}

export interface Rule {
    // Stable name, used to compare one listing's problems against another's.
    // Never change one without thinking about grandfathering below.
    key: string;
    // The wizard step this belongs to, so a failure can send somebody to the
    // page that fixes it. Surfaces without steps ignore it.
    step: number;
    message: string;
    failed: (listing: ListingForRules) => boolean;
}

const text = (value: string | null | undefined): string => String(value || '').trim();

export const PUBLISH_RULES: Rule[] = [
    {
        key: 'property_type',
        step: 1,
        message: 'Please choose a property type to continue.',
        failed: (l) => !text(l.propertyType),
    },
    {
        // A real street address has to exist before a place can be published —
        // you can't list accommodation that doesn't. It stays hidden from guests
        // until they book (that walling is elsewhere); this only requires it to
        // be there. A property name no longer stands in for it: "The Old Manse"
        // with no street is not something a guest can find or a court can serve.
        key: 'address',
        step: 3,
        message: 'Please add the street address, so guests can find the place once they’ve booked.',
        failed: (l) => !text(l.street),
    },
    {
        key: 'town',
        step: 3,
        message: 'Please fill in your town/city and region.',
        failed: (l) => !text(l.city) || !text(l.region),
    },
    {
        key: 'postcode',
        step: 3,
        message: 'Please add a postcode.',
        failed: (l) => !text(l.postcode),
    },
    {
        key: 'postcode_format',
        step: 3,
        message: 'That postcode doesn’t look right — please check it.',
        failed: (l) => !!text(l.postcode) && !UK_POSTCODE.test(text(l.postcode)),
    },
    {
        // A guest books somewhere and is told nothing about how they get
        // through the door. The host still has to answer it, only later, by
        // message, one guest at a time.
        key: 'check_in_method',
        step: 4,
        message: 'Please choose how guests will get in.',
        failed: (l) => !text(l.checkInMethod),
    },
    {
        key: 'amenities',
        step: 5,
        message: 'Please choose at least ' + MIN_AMENITIES + ' things your place offers.',
        failed: (l) => (Array.isArray(l.amenities) ? l.amenities.length : 0) < MIN_AMENITIES,
    },
    {
        key: 'photos',
        step: 6,
        message: 'Please add at least one photo of your place.',
        failed: (l) => Number(l.photoCount || 0) < 1,
    },
    {
        key: 'title',
        step: 7,
        message: 'Please add a title and description.',
        failed: (l) => !text(l.title) || !text(l.description),
    },
    {
        key: 'price',
        step: 9,
        message: 'Please set a price of more than £0 a night.',
        failed: (l) => {
            const value = Number(l.price);
            return !text(String(l.price ?? '')) || !isFinite(value) || value <= 0;
        },
    },
    {
        key: 'price_ceiling',
        step: 9,
        message: 'That price looks like a typo — the most you can set is £'
            + MAX_PRICE_PER_NIGHT + ' a night.',
        failed: (l) => Number(l.price) > MAX_PRICE_PER_NIGHT,
    },
    {
        // Same ceiling, same reason — a weekend price is a price per night,
        // and the extra zero goes in just as easily. Only the calendar's
        // Pricing tab sets one, so everywhere else this reads undefined and
        // the rule stands down.
        key: 'weekend_price_ceiling',
        step: 9,
        message: 'That weekend price looks like a typo — the most you can set is £'
            + MAX_PRICE_PER_NIGHT + ' a night.',
        failed: (l) =>
            l.weekendPrice !== null &&
            l.weekendPrice !== undefined &&
            String(l.weekendPrice).trim() !== '' &&
            Number(l.weekendPrice) > MAX_PRICE_PER_NIGHT,
    },
];

// Everything wrong with a listing, in step order.
export function publishProblems(listing: ListingForRules): Rule[] {
    return PUBLISH_RULES.filter((rule) => rule.failed(listing));
}

// What is still missing at a given wizard step, or null if that step is done.
export function problemAtStep(listing: ListingForRules, step: number): string | null {
    const rule = PUBLISH_RULES.filter((r) => r.step === step && r.failed(listing))[0];
    return rule ? rule.message : null;
}

// The first thing missing anywhere, with the step it belongs to.
//
// Publishing asks about every step, not just the one you are standing on.
// Resuming a saved draft can reach the Publish button without walking back
// through the wizard, which is how a listing once went live with no name.
export function firstPublishProblem(
    listing: ListingForRules
): { step: number; message: string; key: string } | null {
    const rule = publishProblems(listing)[0];
    return rule ? { step: rule.step, message: rule.message, key: rule.key } : null;
}

// Problems an edit would introduce — the ones the listing does not already
// have.
//
// This is the whole of the grandfathering policy, and it is deliberately not
// "published listings are exempt". A listing already on the site that predates
// a rule keeps saving, because refusing to save it would leave a host unable to
// fix a price or a typo until they had also satisfied a rule that did not exist
// when they published. But nothing may take a listing that currently passes and
// push it below the line, and nothing new may go up below it at all.
export function newProblems(before: ListingForRules, after: ListingForRules): Rule[] {
    const had: Record<string, boolean> = {};
    publishProblems(before).forEach((rule) => {
        had[rule.key] = true;
    });
    return publishProblems(after).filter((rule) => !had[rule.key]);
}

// A database row in the shape the rules read. The column names are the
// authority; every surface that holds a listing as form state converts to this
// same shape rather than inventing its own.
export function fromRow(row: any): ListingForRules {
    if (!row) return {};
    return {
        propertyType: row.property_type,
        // The row keeps the street as one built string rather than the parts
        // the wizard collects, so any of it satisfies the address rule.
        street: row.street_address,
        propertyName: null,
        flat: null,
        // location is "Town, Region", built by buildLocation and split back the
        // same way. A row with neither fails the rule, which is what it is for.
        city: String(row.location || '').split(',')[0],
        region: String(row.location || '').split(',').slice(1).join(',').trim() || null,
        postcode: row.postcode,
        photoCount: Array.isArray(row.images) ? row.images.length : 0,
        title: row.title,
        description: row.description,
        price: row.price_per_night,
        weekendPrice: row.weekend_price,
        amenities: Array.isArray(row.amenities) ? row.amenities : [],
        checkInMethod: row.check_in_method,
    };
}
