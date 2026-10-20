// Only the live site spends Ideal Postcodes credits.
//
// WHY. The address lookup is paid per lookup from one allowance, and the same
// key was set on Production, Preview and Development in Vercel. Every preview
// deploy, every local `next dev` and every session walking a sign-up against
// TEST was drawing on the allowance the real guests and hosts need — and when
// it runs out, the live site's lookup stops too.
//
// So /api/address/* call Ideal Postcodes only when VERCEL_ENV is 'production'.
// Everywhere else (previews, local, anything pointed at TEST) they answer from
// the fake below and never send the key anywhere, whatever key is set.
//
// THE TEST POSTCODE. ID1 1QD is Ideal Postcodes' own test postcode, so it is
// the one sessions already know to type. Searching it off production returns two
// made-up addresses in Kirkcudbright; picking one fills the form like a real
// lookup (it skips the council-area check — ID1 is nowhere). Anything else
// searched off production returns no suggestions, which the forms already read
// as "enter it by hand".
//
// ID1 CLIP is Ideal's test postcode for "no lookups remaining". Off production
// it answers exactly as a spent allowance does on the live site (the routes'
// 502 with Ideal's 402 inside), so the type-it-by-hand fallback can be walked
// without spending the allowance to find out.

export const TEST_POSTCODE = 'ID1 1QD';
export const OUT_OF_CREDIT_POSTCODE = 'ID1 CLIP';

const FAKE_ID_PREFIX = 'test-id11qd-';

/** True only on the production deployment — the one place a real lookup is made. */
export function liveAddressLookup(env: { [key: string]: string | undefined } = process.env): boolean {
    return env.VERCEL_ENV === 'production';
}

const squash = (s: string) => s.replace(/\s+/g, '').toUpperCase();

// Typing towards the postcode ("ID1 1", "ID11Q") or past it ("ID1 1QD Test") both count.
function typing(term: string, postcode: string, atLeast: number): boolean {
    const q = squash(term);
    const p = squash(postcode);
    return q.length >= atLeast && (p.startsWith(q) || q.startsWith(p));
}

const FAKE_ADDRESSES = [
    { n: 1, line: 'Test House, 1 Test Street', flat: '', street: 'Test House, 1 Test Street' },
    { n: 2, line: 'Flat 2, 3 Test Street', flat: 'Flat 2', street: '3 Test Street' },
];

/** The autocomplete answer off production: { status, body } for NextResponse.json. */
export function fakeAutocomplete(term: string): { status: number; body: any } {
    // Four characters, so a bare "ID1" is the test postcode, not the spent allowance.
    if (typing(term, OUT_OF_CREDIT_POSTCODE, 4)) {
        return {
            status: 502,
            body: { ok: false, error: 'address lookup returned 402: {"code":4020,"message":"Insufficient lookups remaining (test postcode ID1 CLIP)"}' },
        };
    }
    if (typing(term, TEST_POSTCODE, 3)) {
        return {
            status: 200,
            body: {
                ok: true,
                suggestions: FAKE_ADDRESSES.map((a) => ({
                    id: FAKE_ID_PREFIX + a.n,
                    address: `${a.line}, Kirkcudbright, ${TEST_POSTCODE}`,
                })),
            },
        };
    }
    return { status: 200, body: { ok: true, suggestions: [] } };
}

/** The resolved address off production, in the same shape mapAddress returns, or null for an unknown id. */
export function fakeAddress(id: string) {
    if (!id.startsWith(FAKE_ID_PREFIX)) return null;
    const a = FAKE_ADDRESSES.find((x) => FAKE_ID_PREFIX + x.n === id);
    if (!a) return null;
    return {
        flat: a.flat,
        street: a.street,
        town: 'Kirkcudbright',
        county: 'Dumfries and Galloway',
        postcode: TEST_POSTCODE,
        latitude: 54.8357,
        longitude: -4.0503,
    };
}
