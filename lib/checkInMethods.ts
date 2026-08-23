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
