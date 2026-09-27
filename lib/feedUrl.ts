// Calendar-feed address safety (PURE, client-safe) — shared by the host UI that
// adds a feed, the scheduled iCal sync, and the live checkout re-check.
//
// A host types the feed address, so without a guard it is a server-side request
// forgery hole: "https://127.0.0.1/…", "http://169.254.169.254/latest/…" (the
// cloud metadata endpoint) or "http://10.0.0.5/…" would have us fetch internal
// services from inside the deploy. This module holds the syntax-level rule (only
// public https, never a private/loopback/link-local/metadata address); the
// network-level DNS + redirect enforcement lives in lib/feedFetch (server-only).
//
// No node:net/node:dns imports here on purpose, so a host's browser can run the
// exact same check when they add or edit a feed.

// 0 = not an IP, 4 = IPv4, 6 = IPv6 — a regex stand-in for node's net.isIP so
// this stays importable in the browser.
export function ipVersion(s: string): 0 | 4 | 6 {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return 4;
    if (/^[0-9a-f:]+$/i.test(s) && s.indexOf(':') !== -1) return 6;
    return 0;
}

export function ipIsBlocked(ip: string): boolean {
    const v = ipVersion(ip);
    if (v === 4) return ipv4Blocked(ip);
    if (v === 6) return ipv6Blocked(ip.toLowerCase());
    return true; // not a recognisable IP → treat as unsafe
}

function ipv4Blocked(ip: string): boolean {
    const p = ip.split('.').map((n) => Number(n));
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = p;
    if (a === 0) return true;                          // 0.0.0.0/8 "this network"
    if (a === 10) return true;                         // private
    if (a === 127) return true;                        // loopback
    if (a === 169 && b === 254) return true;           // link-local + 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return true;  // private
    if (a === 192 && b === 168) return true;           // private
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT (100.64/10)
    if (a === 192 && b === 0) return true;             // 192.0.0.0/24 special-use
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a === 255) return true;                        // broadcast
    return false;
}

function ipv6Blocked(ip: string): boolean {
    // IPv4-mapped (::ffff:a.b.c.d) — judge by the embedded IPv4.
    const mapped = ip.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return ipv4Blocked(mapped[1]);
    if (ip === '::1' || ip === '::') return true;      // loopback / unspecified
    // fe80::/10 link-local (fe80–febf) and fc00::/7 unique-local (fc/fd, incl the
    // fd00:ec2::254 metadata address).
    if (/^fe[89ab]/.test(ip)) return true;
    if (/^f[cd]/.test(ip)) return true;
    return false;
}

export function hostnameIsBlocked(hostname: string): boolean {
    const h = (hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!h) return true;
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
    if (ipVersion(h) !== 0) return ipIsBlocked(h);
    return false;
}

// A clear, host-facing message, or null when the address is acceptable at the
// syntax level (valid, https, not an obviously-private hostname). Pure — safe to
// run in the browser when a host adds or edits a feed. The DNS/redirect checks in
// lib/feedFetch run server-side at fetch time.
export function feedUrlProblem(raw: string): string | null {
    let u: URL;
    try {
        u = new URL(String(raw || '').trim());
    } catch {
        return 'That doesn’t look like a calendar link. Paste the full address — it starts with https://';
    }
    if (u.protocol !== 'https:') {
        return 'The calendar link must start with https:// — an insecure http link isn’t accepted.';
    }
    if (hostnameIsBlocked(u.hostname)) {
        return 'That address points somewhere private, not a public calendar. Paste the public export link your other site gives you.';
    }
    return null;
}
