// Is this request from one of our own pages, or from somebody else's script?
//
// WHAT THIS PROTECTS. The two /api/address routes call Ideal Postcodes, which is
// paid per lookup from one shared allowance — spend it and the LIVE site's
// address lookup stops for real guests (lib/addressLookupMode.ts). They cannot
// sit behind a sign-in wall: a guest orders food or books a comes-to-you chef,
// and signs up, WITHOUT an account, so the address search has to work before
// anyone is logged in. The rate limit bounds the total spend; this is the other
// half — it keeps a cross-site page or a bare script from reaching the route at
// all, so only a fetch made by our own pages can draw on the allowance.
//
// HOW. A browser stamps every fetch with Sec-Fetch-Site, and a page cannot set
// it (it is a forbidden header). Our own pages fetch '/api/address/...' with a
// relative URL, so the browser sends `same-origin`. A page on another site sends
// `cross-site`; pasting the URL into the address bar sends `none`. So:
//   - Sec-Fetch-Site present -> allow only `same-origin` / `same-site`.
//   - Sec-Fetch-Site absent  -> an older browser, or a non-browser client. A
//     same-origin GET may omit Origin, so fall back to the host in Origin or
//     Referer matching the host we were reached on. A bare script sends neither,
//     so it is refused.
//
// HOST-AGNOSTIC ON PURPOSE. Our own page's fetch is `same-origin` on production,
// on a preview URL and on localhost alike, so sign-up and every address search
// keep working in every environment without this naming a single domain.

/** Whether a request was made by one of our own pages (not a cross-site page or a script). */
export function fromOwnSite(headers: Headers): boolean {
    const site = (headers.get('sec-fetch-site') || '').trim().toLowerCase();
    if (site) return site === 'same-origin' || site === 'same-site';

    // No Sec-Fetch-Site header: an older browser or a non-browser client. Match
    // the Origin/Referer host against the host we were reached on; neither
    // present means not a browser at all, which is refused.
    const host = (headers.get('host') || '').trim().toLowerCase();
    if (!host) return false;
    const fromHost = hostOf(headers.get('origin') || headers.get('referer') || '');
    return fromHost !== '' && fromHost === host;
}

function hostOf(url: string): string {
    try {
        return new URL(url).host.toLowerCase();
    } catch {
        return '';
    }
}
