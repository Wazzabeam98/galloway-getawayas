// Deciding whether the server may fetch a URL somebody else chose.
//
// WHAT THIS IS FOR. /api/import-listing takes a link from the caller and
// fetches it server-side, so whatever our server can reach, the caller can
// reach through us — including anything on the private network that has no
// business being reachable from outside. That is a server-side request
// forgery, and the interesting part is that the fetch succeeds: the caller
// gets the og: tags back, so it leaks as well as probes.
//
// THE HOLE THAT WAS HERE. The allowlist was:
//
//     ['airbnb.', 'booking.com'].some(h => target.hostname.includes(h))
//
// `.includes()` against the whole hostname, so every one of these passed:
//
//     airbnb.evil.com          — "airbnb." appears in it
//     booking.com.evil.com     — "booking.com" appears in it
//     my-booking.com-x.example
//
// Register one of those, point its DNS at 169.254.169.254 — the cloud
// metadata service — or at anything on the internal network, and the server
// fetches it and hands the contents back.
//
// This lives here rather than in the route, with tests, because an allowlist
// is exactly the kind of rule that looks obviously right and is not.

import { promises as dns } from 'dns';

// Registrable domains, matched exactly or as a parent of a subdomain. The
// anchoring dot in the endsWith is the whole point: 'airbnb.com' matches
// 'www.airbnb.com' but not 'airbnb.com.evil.net' and not 'notairbnb.com'.
//
// Airbnb runs a lot of country domains. Only the ones a host here would
// plausibly paste are listed; adding one is a deliberate act, which is the
// property the old check did not have.
export const ALLOWED_IMPORT_DOMAINS = [
    'airbnb.com',
    'airbnb.co.uk',
    'airbnb.ie',
    'booking.com',
] as const;

// Where the cover photo actually lives. An og:image on an Airbnb page points
// at their CDN, not at airbnb.com, so the page allowlist would refuse every
// image — which is not a security decision, it is a broken feature.
//
// Kept as its own list rather than folded into the one above: these hosts
// serve images to anyone and are not where a listing page lives, so widening
// one must not silently widen the other.
export const ALLOWED_IMPORT_IMAGE_DOMAINS = [
    'muscache.com',     // Airbnb's image CDN
    'bstatic.com',      // Booking.com's image CDN
    'airbnb.com',
    'airbnb.co.uk',
    'booking.com',
] as const;

export function isAllowedHost(hostname: string, domains: readonly string[]): boolean {
    const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
    if (!host) return false;

    for (const domain of domains) {
        if (host === domain) return true;
        if (host.endsWith('.' + domain)) return true;
    }
    return false;
}

export function isAllowedImportHost(hostname: string): boolean {
    return isAllowedHost(hostname, ALLOWED_IMPORT_DOMAINS);
}

export function isAllowedImportImageHost(hostname: string): boolean {
    return isAllowedHost(hostname, ALLOWED_IMPORT_IMAGE_DOMAINS);
}

// Address ranges the server must never be talked into fetching. Written out
// rather than pulled from a package: it is a short list, it does not change,
// and a dependency here is one more thing that can quietly stop being
// maintained.
function isPrivateIPv4(ip: string): boolean {
    const parts = ip.split('.').map(function (p) { return Number(p); });
    if (parts.length !== 4 || parts.some(function (n) {
        return !Number.isInteger(n) || n < 0 || n > 255;
    })) {
        // Unparseable is not provably public, so it is refused.
        return true;
    }
    const a = parts[0];
    const b = parts[1];

    if (a === 0) return true;                          // 0.0.0.0/8   "this host"
    if (a === 10) return true;                         // 10/8        private
    if (a === 127) return true;                        // 127/8       loopback
    if (a === 169 && b === 254) return true;           // 169.254/16  link-local — cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16/12   private
    if (a === 192 && b === 168) return true;           // 192.168/16  private
    if (a === 192 && b === 0) return true;             // 192.0.0/24  protocol assignments
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10   carrier NAT
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
    if (a >= 224) return true;                         // multicast and reserved

    return false;
}

function isPrivateIPv6(ip: string): boolean {
    const addr = ip.toLowerCase().split('%')[0];

    if (addr === '::' || addr === '::1') return true;  // unspecified, loopback

    // ::ffff:a.b.c.d — an IPv4 address wearing an IPv6 hat. Missing this is
    // how a v4-only blocklist gets walked straight past.
    const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIPv4(mapped[1]);

    if (/^fe[89ab]/.test(addr)) return true;           // fe80::/10 link-local
    if (/^f[cd]/.test(addr)) return true;              // fc00::/7  unique local
    if (/^ff/.test(addr)) return true;                 // multicast

    return false;
}

export function isPrivateAddress(ip: string, family: number): boolean {
    return family === 6 ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

export interface UrlVerdict {
    ok: boolean;
    /** Safe to show a caller. Never names the resolved address. */
    reason?: string;
}

/**
 * Whether the server may fetch this URL.
 *
 * Three gates, and all three have to pass:
 *
 *   https only        — no file:, no http:, no gopher:
 *   an allowed domain — exact or a subdomain of one, never a substring
 *   a public address  — every address the name resolves to, not the first
 *
 * The domain check does the real work: an attacker cannot control DNS for a
 * name under airbnb.com. The address check is there because a defence that
 * rests on one condition rests on that condition being right for ever.
 *
 * ON THE RACE. Between resolving here and fetching, DNS could change under us
 * — a rebinding attack. Closing that properly means connecting to the address
 * we checked and carrying the hostname in a Host header, which fetch() will
 * not do. Not built: with the domain gate in place an attacker would first
 * need to control DNS for a real Airbnb or Booking.com name, and anyone who
 * has that has better targets than this route.
 */
export async function checkUrlAgainst(
    raw: string,
    domains: readonly string[],
    resolve?: (host: string) => Promise<{ address: string; family: number }[]>
): Promise<UrlVerdict> {
    const lookup = resolve || function (host: string) {
        return dns.lookup(host, { all: true });
    };

    let target: URL;
    try {
        target = new URL(raw);
    } catch (err) {
        return { ok: false, reason: 'That doesn’t look like a valid URL.' };
    }

    if (target.protocol !== 'https:') {
        return { ok: false, reason: 'That link needs to start with https.' };
    }

    if (!isAllowedHost(target.hostname, domains)) {
        return { ok: false, reason: 'Please use an Airbnb or Booking.com listing link.' };
    }

    let addresses: { address: string; family: number }[];
    try {
        addresses = await lookup(target.hostname);
    } catch (err) {
        return { ok: false, reason: 'That address could not be looked up.' };
    }

    if (!addresses || !addresses.length) {
        return { ok: false, reason: 'That address could not be looked up.' };
    }

    // EVERY address, not the first. A name that answers with one public
    // address and one private one is the whole trick.
    for (const entry of addresses) {
        if (isPrivateAddress(entry.address, entry.family)) {
            return { ok: false, reason: 'That link points somewhere we will not fetch.' };
        }
    }

    return { ok: true };
}

/** A listing page the host pasted. */
export async function checkImportUrl(
    raw: string,
    resolve?: (host: string) => Promise<{ address: string; family: number }[]>
): Promise<UrlVerdict> {
    return checkUrlAgainst(raw, ALLOWED_IMPORT_DOMAINS, resolve);
}

/** The cover photo named by that page's og:image. */
export async function checkImportImageUrl(
    raw: string,
    resolve?: (host: string) => Promise<{ address: string; family: number }[]>
): Promise<UrlVerdict> {
    const verdict = await checkUrlAgainst(raw, ALLOWED_IMPORT_IMAGE_DOMAINS, resolve);
    if (!verdict.ok && verdict.reason && /listing link/.test(verdict.reason)) {
        return { ok: false, reason: 'That photo is hosted somewhere we do not fetch from.' };
    }
    return verdict;
}
