// Spotting a phone number or an email address in a message.
//
// A SIGNAL, NOT A WALL. Nothing here blocks anything, and it is not meant to.
//
// The decision, taken 26 Aug 2026: contact details stay off a provider's
// listing so the first approach happens on the platform, and message content
// is never filtered. A cleaner, a plumber and a roofer all stand in the
// property — they will swap numbers on the doorstep in the first five minutes,
// and a filter reaches none of that. It would only police the one channel that
// does not matter, while blocking a Gas Safe number, a house number, a
// postcode or a boiler model on a site whose whole pitch is that registration
// numbers are visible and checkable.
//
// What this is for is measuring the rate, so a wall is never built on a guess.
//
// WHAT IT DELIBERATELY DOES NOT RETURN
//
// The matched text. Only which kinds matched and how many. Recording the
// number itself would put people's phone numbers in a log in order to find out
// how often people share phone numbers, which is worse than the thing being
// measured.
//
// Pure functions, no queries, same shape as lib/listingRules.ts — so it can be
// used on a server or in a browser and tested without a database.

export type ContactKind = 'email' | 'phone' | 'spelled_out' | 'off_platform_app';

export interface ContactSignal {
    looksLikeContact: boolean;
    kinds: ContactKind[];
}

// Deliberately loose. A missed one costs a slightly low number in a report; a
// false positive costs nothing at all, because nothing happens to the message.
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

// UK shapes, with any amount of spacing, dots or dashes between the digits —
// which is how somebody writes a number they half-know they should not be
// writing.
const UK_MOBILE = /(?:\+?44|0)\s*7[\d\s.\-()]{8,14}\d/;
const UK_LANDLINE = /(?:\+?44|0)\s*1[\d\s.\-()]{8,14}\d/;

// A long run of digits that is not a date, a price or a registration number,
// which are all shorter than this.
const LONG_RUN = /(?:\d[\s.\-()]*){11,}/;

const NUMBER_WORDS = [
    'zero', 'oh', 'one', 'two', 'three', 'four', 'five',
    'six', 'seven', 'eight', 'nine', 'double', 'triple',
];

// "oh seven nine, double three" — the way somebody reads a number out when
// they suspect writing it down is not allowed. Three in a row, because two is
// an ordinary sentence: "one or two things", "double bed".
const SPELLED_OUT = new RegExp(
    '\\b(?:' + NUMBER_WORDS.join('|') + ')\\b[\\s,.\\-]*'
    + '\\b(?:' + NUMBER_WORDS.join('|') + ')\\b[\\s,.\\-]*'
    + '\\b(?:' + NUMBER_WORDS.join('|') + ')\\b',
    'i'
);

const OFF_PLATFORM = /\b(whats\s?app|telegram|signal|messenger)\b/i;

export function contactSignal(text: string | null | undefined): ContactSignal {
    const body = String(text || '');
    const kinds: ContactKind[] = [];

    if (EMAIL.test(body)) kinds.push('email');

    if (UK_MOBILE.test(body) || UK_LANDLINE.test(body) || LONG_RUN.test(body)) {
        kinds.push('phone');
    }

    if (SPELLED_OUT.test(body)) kinds.push('spelled_out');
    if (OFF_PLATFORM.test(body)) kinds.push('off_platform_app');

    return { looksLikeContact: kinds.length > 0, kinds: kinds };
}

// What a log line should carry: which kinds, never the text.
export function contactSignalSummary(text: string | null | undefined): string | null {
    const signal = contactSignal(text);
    return signal.looksLikeContact ? signal.kinds.join(',') : null;
}
