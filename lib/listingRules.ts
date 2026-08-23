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
        // A rural cottage may have a name and no street, so either will do —
        // what is not allowed is nothing but the town.
        key: 'address',
        step: 3,
        message: 'Please add a street address or a property name, so guests can find the place.',
        failed: (l) => !text(l.street) && !text(l.propertyName) && !text(l.flat),
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
        amenities: Array.isArray(row.amenities) ? row.amenities : [],
        checkInMethod: row.check_in_method,
    };
}
