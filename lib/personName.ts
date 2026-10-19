// A person's first and last name — the one rule for what counts as a name, and
// for when an account still owes one.
//
// Airbnb asks every new account for a first and a last name on a "Finish
// signing up" screen straight after the code, and does not let it be skipped.
// We used to ask for one "Full name" box, on a screen that could be walked away
// from — and every guest-facing "Hosted by" took the first word of whatever was
// in it. A provider who typed their business name ("The Dark Sky Dome") was
// shown as "Hosted by The". So the name is now two fields, stored as two
// columns (profiles.first_name / last_name), and nothing ever cuts a first name
// out of a longer string again.
//
// This file is shared by the browser (the Finish signing up form) and the
// server (/api/account/name, which is the only writer of the two columns —
// the browser has no UPDATE grant on them), so a rule checked in one is the
// rule checked in the other. Kept free of React and of '@/' imports so the
// unit test can run it directly.

export const NAME_MAX_LENGTH = 50;

export interface PersonNameRow {
    first_name?: string | null;
    last_name?: string | null;
}

export type NameCheck =
    | { ok: true; first: string; last: string }
    | { ok: false; field: 'first' | 'last'; message: string };

// Inner runs of spaces collapse to one; ends trimmed.
export function tidyName(raw: unknown): string {
    return String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
}

function problem(value: string, which: 'first' | 'last'): string | null {
    const label = which === 'first' ? 'first name' : 'last name';
    if (!value) return 'Enter your ' + label + '.';
    if (value.length > NAME_MAX_LENGTH) return 'Your ' + label + ' must be ' + NAME_MAX_LENGTH + ' characters or fewer.';
    // A name has at least one letter in it (any alphabet), and is not an email
    // address or a phone number typed into the wrong box.
    if (!/\p{L}/u.test(value)) return 'Enter your ' + label + ' using letters.';
    if (/[@<>]|\d/.test(value)) return 'Enter your ' + label + ' without numbers or symbols.';
    return null;
}

// The check, used by the form AND by the route that saves it.
export function validatePersonName(firstRaw: unknown, lastRaw: unknown): NameCheck {
    const first = tidyName(firstRaw);
    const last = tidyName(lastRaw);
    const f = problem(first, 'first');
    if (f) return { ok: false, field: 'first', message: f };
    const l = problem(last, 'last');
    if (l) return { ok: false, field: 'last', message: l };
    return { ok: true, first, last };
}

// Whether this account still owes us a first and last name. Anything with
// either half missing does: the wizards and publishing ask for it first.
export function needsPersonName(row: PersonNameRow | null | undefined): boolean {
    if (!row) return true;
    return !tidyName(row.first_name) || !tidyName(row.last_name);
}

// Accounts made from this moment on are asked for their name on a Finish
// signing up screen that cannot be skipped — the sign-in panel straight after
// the code, and site-wide on any page if they get away without (a closed tab,
// a Google sign-in that went through the callback). Accounts made before it
// are "returning" and never see that screen at sign-in (Liam, 19 Oct 2026); a
// nameless one is asked instead when it opens the listing or experience wizard
// or publishes, and its dashboard says so.
export const FINISH_SIGNUP_FROM = '2026-10-19T00:00:00Z';

//
// A reserved .test address (RFC 2606) can never belong to a real person: those
// are the seed and scenario accounts, rebuilt on every seed run, and a modal
// on every page they load would break every other session's walks. They are
// still asked in the wizards and at publish, like anyone.
export function mustFinishSignUp(
    row: PersonNameRow | null | undefined,
    accountCreatedAt: string | null | undefined,
    email?: string | null,
): boolean {
    if (!needsPersonName(row)) return false;
    if (/\.test$/i.test(String(email || '').trim())) return false;
    const made = Date.parse(String(accountCreatedAt || ''));
    if (!Number.isFinite(made)) return false;
    return made >= Date.parse(FINISH_SIGNUP_FROM);
}

// What to pre-fill the two boxes with: the names already on the profile, else
// what Google told us (given_name / family_name, or its one "name" split at the
// first space — a guess the person confirms, never saved without them pressing
// the button), else whatever full name an older screen saved.
export function suggestedName(
    row: (PersonNameRow & { full_name?: string | null }) | null | undefined,
    metadata: Record<string, any> | null | undefined,
): { first: string; last: string } {
    const first = tidyName(row && row.first_name);
    const last = tidyName(row && row.last_name);
    if (first || last) return { first, last };
    const md = metadata || {};
    const given = tidyName(md.given_name);
    const family = tidyName(md.family_name);
    if (given || family) return { first: given, last: family };
    const whole = tidyName(md.full_name || md.name || (row && row.full_name));
    // "The Dark Sky Dome" is a business, not a Mr Dome: no guess at all.
    if (!whole || /^(the|a|an)\s/i.test(whole)) return { first: '', last: '' };
    const i = whole.indexOf(' ');
    return i === -1 ? { first: whole, last: '' } : { first: whole.slice(0, i), last: whole.slice(i + 1) };
}
