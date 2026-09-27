// Server-only safe fetch for calendar feeds. Wraps the pure rule in lib/feedUrl
// with the network-level enforcement it can't do in the browser: resolve the
// hostname and refuse if it points at a private/loopback/link-local/metadata
// address, and re-check every redirect hop so a public URL can't 302 us inward.
//
// Used by the scheduled iCal sync and the live checkout re-check — the two places
// that fetch a HOST-SUPPLIED url. Never import this into a client component (it
// pulls in node:dns).

import dns from 'node:dns/promises';
import { feedUrlProblem, hostnameIsBlocked, ipIsBlocked, ipVersion } from '@/lib/feedUrl';

// Resolve the hostname and refuse if any address it resolves to is off-limits —
// catches a public name that points inward (DNS rebinding's simplest form).
async function assertResolvesPublic(hostname: string): Promise<void> {
    if (hostnameIsBlocked(hostname)) throw new Error('blocked host');
    if (ipVersion(hostname) !== 0) return; // an IP literal is already checked above
    let addrs: { address: string }[];
    try {
        addrs = await dns.lookup(hostname, { all: true });
    } catch {
        throw new Error('unresolvable');
    }
    if (!addrs.length) throw new Error('unresolvable');
    for (const a of addrs) if (ipIsBlocked(a.address)) throw new Error('resolves to a private address');
}

// Fetch a feed's body safely. Returns the text, or null when the address is
// unsafe or unreachable (callers fall back to the cached calendar rather than
// blocking a booking on it). Redirects are followed manually so each hop is
// re-validated.
export async function fetchIcalText(rawUrl: string, opts: { timeoutMs?: number } = {}): Promise<string | null> {
    const timeoutMs = opts.timeoutMs ?? 8000;
    let current = String(rawUrl || '');
    for (let hop = 0; hop < 4; hop++) {
        if (feedUrlProblem(current)) return null;
        let host: string;
        try { host = new URL(current).hostname; } catch { return null; }
        try { await assertResolvesPublic(host); } catch { return null; }

        let res: Response;
        try {
            res = await fetch(current, {
                headers: { 'User-Agent': 'GallowayGetawaysCalendarSync/1.0' },
                redirect: 'manual',
                signal: AbortSignal.timeout(timeoutMs),
            });
        } catch {
            return null;
        }

        if (res.status >= 300 && res.status < 400) {
            const loc = res.headers.get('location');
            if (!loc) return null;
            try { current = new URL(loc, current).toString(); } catch { return null; }
            continue; // re-validate the new hop at the top of the loop
        }
        if (!res.ok) return null;
        return await res.text();
    }
    return null; // too many redirects
}
