// Contact details in a LISTING — a wall, not a signal.
//
// Airbnb's rule, and ours: a listing's title, description, house rules and
// arrival notes may not carry an email address, a phone number, a web address
// or a social handle. A guest who can ring the host from the listing page books
// around the platform, loses the cover a booking gives them, and the host loses
// the protection of a paid booking. Once they have booked, they can message the
// host — that is where contact happens.
//
// This is deliberately a SEPARATE module from lib/contactDetails.ts. That one
// reads messages between a booked guest and a host, only counts, and never
// blocks (the 26 Aug 2026 decision). Nothing here touches messages.
//
// Because this one does block, it is written to be STRICT about what it calls
// contact details and to leave ordinary writing alone:
//   - "@" used for "at" ("check in @ 4pm", "tea@4") is fine;
//   - a postcode, a price, a year, "sleeps 2-4" are fine (too few digits);
//   - "e.g." and "approx. 5 miles" are not web addresses.
// What it does catch is the host's way round a filter: "pods@thecroft" (an
// email with the .com left off), "@thecroftpods", "thecroft.co.uk", and a
// number with spaces, dots or dashes in it.
//
// Pure, no imports — used in the browser (the inline message under a field)
// and on the server (the save, arrival and publish routes refuse it), so the
// two cannot disagree. Mirrors lib/listingRules.ts.

export type ListingContactKind = 'email' | 'phone' | 'web' | 'handle';

// The message the host sees, word for word on every surface.
export const LISTING_CONTACT_MESSAGE =
    'To keep guests safe and bookings protected, contact details can’t go in your listing; guests can message you once they book.';

const KIND_LEAD: Record<ListingContactKind, string> = {
    email: 'That looks like an email address.',
    phone: 'That looks like a phone number.',
    web: 'That looks like a web address.',
    handle: 'That looks like a social media handle.',
};

// "That looks like a phone number. To keep guests safe…" — the lead says what
// to take out, so a host is never left hunting for it.
export function listingContactMessage(kind: ListingContactKind): string {
    return KIND_LEAD[kind] + ' ' + LISTING_CONTACT_MESSAGE;
}

// name@domain, with or without the ".com" — "pods@thecroft" is the one a
// host types when the full address was refused. Both sides at least two
// characters and the domain starting with a letter, so "tea@4" and "B@B" pass.
const EMAIL = /[a-z0-9][a-z0-9._%+\-]*[a-z0-9]?@[a-z][a-z0-9\-]+(?:\.[a-z0-9\-]+)*/i;

// An @ at the start of a word, followed by a name: "@thecroftpods",
// "follow us @the_croft". Not "@ 4pm" (a space) and not "@4pm" (a time).
const HANDLE = /(?:^|[\s(\[{,;:"'“‘])@([a-z_][a-z0-9_.]{1,29})/gi;

// "@home", "@ night" etc. — ordinary English that happens to use the symbol.
const HANDLE_WORDS = new Set([
    'home', 'night', 'noon', 'midday', 'midnight', 'dawn', 'dusk', 'sunset',
    'sunrise', 'weekends', 'the', 'a', 'an', 'least', 'last', 'all', 'once',
]);

// A scheme or a www. is a web address whatever follows it.
const URL_PREFIX = /\b(?:https?:\/\/|www\.)\S+/i;

// A bare domain: a name, a dot, and an ending people actually register. Listed
// rather than "any two letters" so "e.g.", "approx.", "St.Mary's" and a
// what3words-ish "loud.cats.pace" never match.
// Endings that are also English words (.house, .cottage, .farm, .me, .shop…)
// are left out on purpose: "the beach.Cottage sleeps four", a missed space
// after a full stop, is far commoner in a description than a .cottage domain.
const TLDS = [
    'com', 'co\\.uk', 'org\\.uk', 'me\\.uk', 'uk', 'scot', 'net', 'org', 'io',
    'co', 'biz', 'info', 'ie', 'eu',
];
const DOMAIN = new RegExp(
    '\\b[a-z0-9][a-z0-9\\-]*(?:\\.[a-z0-9\\-]+)*\\.(?:' + TLDS.join('|') + ')(?![a-z0-9\\-])(?:\\/\\S*)?',
    'i',
);

// A run of digits with only spaces, dots, dashes or brackets between them,
// optionally starting with +. Counted afterwards: 10 to 13 digits is a phone
// number (UK numbers are 10 or 11, +44 makes 12). A date, a price, a postcode,
// "sleeps 2-4" and a year range are all far shorter.
const DIGIT_RUN = /\+?\(?\d[\d\s().\-]{7,}\d/g;

// The phone run that looks like a number, or null. Returned (not just a bool)
// so the host can be told exactly what to take out.
function phoneMatch(text: string): string | null {
    const runs = text.match(DIGIT_RUN) || [];
    for (const run of runs) {
        const digits = run.replace(/\D/g, '').length;
        if (digits >= 10 && digits <= 13) return run.trim();
    }
    return null;
}

// The @handle that is a handle (not "@ 4pm" or an ordinary word), or null.
function handleMatch(text: string): string | null {
    HANDLE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = HANDLE.exec(text))) {
        const name = m[1].replace(/[._]+$/, '').toLowerCase();
        if (name.length >= 2 && !HANDLE_WORDS.has(name)) return '@' + m[1].replace(/[._]+$/, '');
    }
    return null;
}

// The first contact detail in the text — its kind AND the exact substring, so a
// message can say "remove pods@thecroft". Email before handle and web so
// "pods@thecroft.co.uk" reads as the email it is.
export function listingContactScan(text: string | null | undefined): { kind: ListingContactKind; match: string } | null {
    const body = String(text || '');
    if (!body.trim()) return null;
    const email = body.match(EMAIL);
    if (email) return { kind: 'email', match: email[0] };
    const handle = handleMatch(body);
    if (handle) return { kind: 'handle', match: handle };
    const url = body.match(URL_PREFIX) || body.match(DOMAIN);
    if (url) return { kind: 'web', match: url[0] };
    const phone = phoneMatch(body);
    if (phone) return { kind: 'phone', match: phone };
    return null;
}

// The first kind of contact detail in the text, or null when it is clean.
export function listingContactKind(text: string | null | undefined): ListingContactKind | null {
    return listingContactScan(text)?.kind ?? null;
}

// The free-text parts of a listing a guest reads, by column, with the word a
// host would use for each. The arrival notes live in listing_arrival (the
// "last bit" directions); wifi and what3words are not free text and are not
// read here — a wifi password or a ///three.word.address is not a phone number.
// The old parking note is left out: hosts can no longer edit it and guests no
// longer see it (5 Oct 2026).
export const LISTING_CONTACT_FIELDS: Record<string, string> = {
    title: 'title',
    description: 'description',
    neighbourhood: 'neighbourhood description',
    additional_rules: 'house rules',
    checkout_note: 'checkout instructions',
    arrival_directions: 'directions',
};

export interface ListingContactProblem {
    field: string;
    label: string;
    kind: ListingContactKind;
    // The exact offending substring (e.g. "pods@thecroft"), so the message can
    // name it and the host knows precisely what to take out.
    match: string;
    message: string;
}

// The inline message, naming the field and quoting what to remove — the wording
// shown on every surface: "Contact details can’t go in your listing, as guests
// can message you once they book. Please remove pods@thecroft from your title."
export function listingContactFieldMessage(label: string, match: string): string {
    const base = 'Contact details can’t go in your listing, as guests can message you once they book.';
    return `${base} Please remove ${match} from your ${label}.`;
}

// The first field in a row (or a save patch) that carries contact details. Only
// the fields listed above, and only the ones present — so a patch that changes
// the price never trips over an old description.
export function listingContactProblem(row: Record<string, any> | null | undefined): ListingContactProblem | null {
    if (!row) return null;
    for (const field of Object.keys(LISTING_CONTACT_FIELDS)) {
        if (!(field in row)) continue;
        const value = row[field];
        if (typeof value !== 'string') continue;
        const scan = listingContactScan(value);
        if (scan) {
            const label = LISTING_CONTACT_FIELDS[field];
            return { field, label, kind: scan.kind, match: scan.match, message: listingContactFieldMessage(label, scan.match) };
        }
    }
    return null;
}

// Every field that carries contact details — for the admin queue, which names
// them all rather than just the first.
export function listingContactProblems(row: Record<string, any> | null | undefined): ListingContactProblem[] {
    if (!row) return [];
    const out: ListingContactProblem[] = [];
    for (const field of Object.keys(LISTING_CONTACT_FIELDS)) {
        const p = listingContactProblem({ [field]: row[field] });
        if (p) out.push(p);
    }
    return out;
}
