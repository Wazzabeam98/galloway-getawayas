import { adminClient } from '@/lib/supabaseAdmin';

// How often a stranger may do something.
//
// WHAT THIS IS PROTECTING. /api/services/apply has no auth gate — it cannot,
// because a tradesman has no account until it makes them one. Every call asks
// Supabase to send a confirmation email, and the project's outbound mail is one
// shared allowance. Exhaust it and real password resets stop working for
// everybody. The junk rows are annoying; that is an outage.
//
// THE GLOBAL LIMIT IS THE ONE THAT MATTERS, AND IT IS NOT THE OBVIOUS ONE.
//
// A per-IP limit is the reflex, and on its own it is close to decorative: the
// caller chooses their own address, and the header it is read from can be set
// by anyone who can reach the route. It raises the bar and it does not close
// the door.
//
// A limit on the total, across everybody, does close it. However the requests
// are spread — one address or ten thousand — the number of emails the site can
// be made to send in an hour is bounded. That is the property worth having,
// because it is the one that maps onto "the site's email still works".
//
// So both are applied, and the global one is the load-bearing half.
//
// ON THE RACE. Counting and then recording is not atomic, so two requests
// arriving together can both see room and both take it. For a limit whose job
// is to stop a flood, being out by one occasionally costs nothing — the flood
// still stops. Making it exact means a transaction or an advisory lock per
// request, which is a lot of machinery for a number that is deliberately
// generous anyway.

export interface Limit {
    /** Names the thing being limited, e.g. 'services-apply:ip'. */
    bucket: string;
    /** Who or what is being counted. Use GLOBAL_KEY for a site-wide cap. */
    key: string;
    /** How many are allowed in the window. */
    max: number;
    /** How long the window is, in minutes. */
    windowMinutes: number;
}

/** The key for a limit that applies to everybody at once. */
export const GLOBAL_KEY = '*';

export interface LimitVerdict {
    ok: boolean;
    /** Which limit refused, for the log. Never shown to the caller. */
    hit?: string;
}

/**
 * Whether this caller may proceed, recording the attempt if they may.
 *
 * Limits are checked in the order given and the first refusal wins, so put the
 * cheapest and most important first. Nothing is recorded when a limit refuses:
 * a blocked attempt must not push the counter further up, or an attacker
 * holding the door shut also extends how long it stays shut for everyone else.
 */
export async function withinLimits(
    limits: Limit[],
    now: Date = new Date(),
    client?: any
): Promise<LimitVerdict> {
    const admin = client || adminClient();

    for (const limit of limits) {
        const since = new Date(now.getTime() - limit.windowMinutes * 60000).toISOString();

        const { count, error } = await admin
            .from('rate_limit_hits')
            .select('id', { count: 'exact', head: true })
            .eq('bucket', limit.bucket)
            .eq('key', limit.key)
            .gte('created_at', since);

        // FAIL OPEN, DELIBERATELY, AND ONLY HERE. If the count cannot be read
        // the database is in trouble, and refusing every applicant because the
        // rate limiter is broken turns a database wobble into a closed shop.
        // The caller reports it; see the call site.
        if (error) return { ok: true, hit: 'unreadable' };

        if ((count || 0) >= limit.max) {
            return { ok: false, hit: limit.bucket + '=' + limit.key };
        }
    }

    // Recorded only once every limit has room, one row per limit so each
    // window counts independently.
    const rows = limits.map((l) => ({
        bucket: l.bucket,
        key: l.key,
        created_at: now.toISOString(),
    }));
    await admin.from('rate_limit_hits').insert(rows);

    return { ok: true };
}

/**
 * The caller's address, as well as it can be known.
 *
 * `x-forwarded-for` is a list; the client's own value sits at the front and is
 * whatever they chose to send, so this reads the LAST entry — the one the edge
 * in front of us appended, which is the address it actually saw. `x-real-ip`
 * is preferred where the platform sets it.
 *
 * Treat the result as a hint. It is good enough to slow somebody down and not
 * good enough to be the only thing standing between a stranger and your email
 * allowance, which is why there is a global limit as well.
 */
export function callerAddress(headers: Headers): string {
    const real = (headers.get('x-real-ip') || '').trim();
    if (real) return real;

    const forwarded = (headers.get('x-forwarded-for') || '').split(',');
    const last = forwarded[forwarded.length - 1].trim();
    return last || 'unknown';
}
