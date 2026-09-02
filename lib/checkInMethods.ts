// How guests physically get in, and whether that involves a code.
//
// Three of the six methods a host can pick involve one; three do not. Asking a
// host who meets guests at the door for a "door code" is noise, and noise is
// what teaches people to skip a field that sometimes matters — so the field
// only exists for the methods where it means something.
//
// Kept out of the component so the rule can be tested without compiling JSX,
// and because which methods involve a code is a fact about the business rather
// than about a form.

export const CODE_METHODS = ['Lockbox', 'Smart lock', 'Keypad'];

export function methodNeedsCode(method: string | null | undefined): boolean {
    // An unrecognised method deliberately answers no. If a new one is added to
    // the picker it has to be added here too; defaulting to "yes, ask" would
    // put a credential field under something like "Doorman", which is the
    // miscategorisation this was moved to fix.
    return CODE_METHODS.indexOf(String(method || '')) !== -1;
}

// It is not always a lockbox.
export function codeHintFor(method: string | null | undefined): string {
    if (method === 'Smart lock') return 'The code guests enter on the smart lock.';
    if (method === 'Keypad') return 'The code guests enter on the door keypad.';
    return 'The code that opens the lockbox holding the key.';
}

// The three self-service methods, the ones a guest handles alone — kept
// alongside CODE_METHODS because they happen to be the same three, but named
// for the guest's experience rather than for whether a credential exists.
const SELF_CHECKIN_METHODS = ['Lockbox', 'Smart lock', 'Keypad'];

export function isSelfCheckIn(method: string | null | undefined): boolean {
    return SELF_CHECKIN_METHODS.indexOf(String(method || '')) !== -1;
}

// One sentence per method, in the guest's words. This is the copy behind the
// "Self check-in" highlight on the listing page; the Getting-there screen shows
// the same line so a guest meets the same promise in both places instead of two
// near-copies that could drift.
export const CHECKIN_BLURBS: Record<string, string> = {
    'Lockbox': 'Check yourself in with the lockbox.',
    'Smart lock': 'Let yourself in with a smart lock code.',
    'Keypad': 'Let yourself in using the door keypad.',
    'Host greets you': 'Your host will meet you at the property.',
    'Keys collected nearby': 'Keys are collected from a nearby address.',
    'Building staff': 'Building staff will let you in.',
};

// What to call the method in a heading: self-service methods read as "Self
// check-in", the rest name themselves ("Host greets you").
export function checkInMethodTitle(method: string | null | undefined): string {
    return isSelfCheckIn(method) ? 'Self check-in' : String(method || '');
}

export function checkInBlurb(method: string | null | undefined): string {
    return CHECKIN_BLURBS[String(method || '')] || '';
}
