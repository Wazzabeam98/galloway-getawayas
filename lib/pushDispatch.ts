// The push job: sends each recorded push exactly once.
//
// Runs from /api/cron/push-outbox every minute, and straight away after a
// message is sent (lib/pushOutbox records, this delivers). It is the only place
// a recorded push is sent from — never payment, payout or settlement code.
//
// EXACTLY ONCE. A row is claimed with a compare-and-set (pending → sending)
// before anything is sent, so two runs that overlap can't both send it; the
// outbox's unique dedupe key means the event was only recorded once in the
// first place. A run that dies mid-row leaves it 'sending'; after fifteen
// minutes it is marked failed rather than retried — a missed push is better
// than a doubled one.
//
// WHO GETS IT.
//   - the user on the row, or the account behind the email it went to (a
//     provider's contact address resolves to the provider's owner)
//   - an email to an owner alert address (DISPUTES_/SERVICES_/ACCOUNTS_/
//     REPORTS_ALERT_EMAIL) goes to every admin, filed under 'admin'
//   - a business's co-hosts with messages: a message to its owner on an order
//     or job thread (their email copies carry their own pushes)
//   - co-hosts: when the push is to a listing's owner and the rule names a
//     permission (bookings, messages, calendar, listing, earnings), every
//     active co-host on that listing holding it gets it too. Payout details
//     are never delegated, so payout set-up and security pushes name none.
// Then each person's switches (account settings → Notifications) decide.

import { pushToUserReport, type PushReport } from './push';
import { pushAllowed, isPushCategory, type PushCategory } from './pushCategories';

const BATCH = 100;
const STALE_MINUTES = 15;
const KEEP_DAYS = 30;

const ALERT_VARS = ['DISPUTES_ALERT_EMAIL', 'SERVICES_ALERT_EMAIL', 'ACCOUNTS_ALERT_EMAIL', 'REPORTS_ALERT_EMAIL'];

export function adminAlertAddresses(env: Record<string, string | undefined> = process.env): Set<string> {
    const out = new Set<string>();
    for (const v of ALERT_VARS) {
        for (const a of String(env[v] || '').split(',')) {
            const t = a.trim().toLowerCase();
            if (t) out.add(t);
        }
    }
    return out;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

type Recipient = { userId: string; category: PushCategory };

export type RowOutcome = { status: 'sent' | 'skipped' | 'failed'; result: Record<string, unknown> };

type Sender = Parameters<typeof pushToUserReport>[3];

async function adminIds(admin: any): Promise<string[]> {
    const { data } = await admin.from('profiles').select('id').eq('is_admin', true);
    return (data || []).map((r: any) => r.id);
}

// ilike for case, with its wildcards escaped: an address with an underscore
// in it must not match a different person's.
const exactly = (email: string) => email.replace(/[\\%_]/g, '\\$&');

async function userForEmail(admin: any, email: string): Promise<string | null> {
    const { data: p } = await admin.from('profiles').select('id').ilike('email', exactly(email)).limit(1);
    if (p && p[0]) return p[0].id;
    // Providers are emailed at their business contact address.
    const { data: sp } = await admin.from('service_providers').select('owner_id').ilike('contact_email', exactly(email)).limit(1);
    return sp && sp[0] ? sp[0].owner_id : null;
}

/** The listing a push is about, from its context or the page it opens. */
async function listingFor(admin: any, row: any): Promise<{ id: string; hostId: string } | null> {
    const ctx = row.context || {};
    const ids = [ctx.listing_id, ctx.booking_id, (String(row.url || '').match(UUID) || [])[0]].filter(Boolean);
    for (const id of ids) {
        const { data: b } = await admin.from('bookings').select('listing_id, host_id').eq('id', id).maybeSingle();
        if (b && b.listing_id) return { id: b.listing_id, hostId: b.host_id };
        const { data: l } = await admin.from('listings').select('id, host_id').eq('id', id).maybeSingle();
        if (l) return { id: l.id, hostId: l.host_id };
    }
    return null;
}

async function cohostsWith(admin: any, listingId: string, permission: string): Promise<string[]> {
    const { data } = await admin
        .from('listing_access')
        .select('user_id')
        .eq('listing_id', listingId)
        .eq('status', 'active')
        .eq(permission, true);
    return (data || []).map((r: any) => r.user_id).filter(Boolean);
}

/** The business (an experience or a trade) a push is about: from its order,
 *  enquiry or provider id, in its context or the page it opens. */
async function providerFor(admin: any, row: any): Promise<{ id: string; ownerId: string } | null> {
    const ctx = row.context || {};
    const ids = [ctx.provider_id, ctx.order_id, ctx.enquiry_id, (String(row.url || '').match(UUID) || [])[0]].filter(Boolean);
    for (const id of ids) {
        const { data: o } = await admin.from('service_orders').select('provider_id').eq('id', id).maybeSingle();
        const { data: e } = o ? { data: null } : await admin.from('service_enquiries').select('provider_id').eq('id', id).maybeSingle();
        const pid = (o && o.provider_id) || (e && e.provider_id) || id;
        const { data: p } = await admin.from('service_providers').select('id, owner_id').eq('id', pid).maybeSingle();
        if (p && p.owner_id) return { id: p.id, ownerId: p.owner_id };
    }
    return null;
}

async function providerCohostsWith(admin: any, providerId: string, permission: string): Promise<string[]> {
    const { data } = await admin
        .from('provider_access')
        .select('user_id')
        .eq('provider_id', providerId)
        .eq('status', 'active')
        .eq(permission, true);
    return (data || []).map((r: any) => r.user_id).filter(Boolean);
}

export async function recipientsFor(admin: any, row: any, env: Record<string, string | undefined> = process.env): Promise<Recipient[]> {
    const category: PushCategory = isPushCategory(row.category) ? row.category : 'reservations';
    const out = new Map<string, PushCategory>();

    // An owner alert recorded straight from the database (a listing sent for
    // approval): every admin.
    if (row.context && row.context.admins === true) {
        for (const id of await adminIds(admin)) out.set(id, 'admin');
        return Array.from(out, ([userId, c]) => ({ userId, category: c }));
    }

    if (row.user_id) {
        out.set(row.user_id, category);
    } else if (row.to_email) {
        const email = String(row.to_email).toLowerCase();
        // An owner alert (the rules filed it under 'admin') to an alert address
        // goes to every admin. Anything else that happens to be addressed to one
        // — a co-host invitation sent to someone's company alias — is resolved
        // like any other email, so it reaches that person and nobody else.
        // (Until 20/10/2026 it went to every admin: Jamie's invitation pushed
        // to Liam's phone.)
        if (category === 'admin' && adminAlertAddresses(env).has(email)) {
            for (const id of await adminIds(admin)) out.set(id, 'admin');
            return Array.from(out, ([userId, c]) => ({ userId, category: c }));
        }
        const id = await userForEmail(admin, email);
        if (id) out.set(id, category);
    }

    const permission = row.context && row.context.cohost;
    if (permission && out.size > 0) {
        const listing = await listingFor(admin, row);
        if (listing && out.has(listing.hostId)) {
            for (const id of await cohostsWith(admin, listing.id, permission)) {
                if (!out.has(id)) out.set(id, category);
            }
        }
    }

    // A business's co-hosts with messages hear about a message to its owner on
    // an order or a job thread, as a holiday let's do. (A business EMAIL needs
    // nothing here: each co-host is sent their own copy, which carries its own
    // push — lib/providerTeamEmail.)
    if (row.kind === 'message.new' && row.user_id && !(row.context && row.context.booking_id)) {
        const provider = await providerFor(admin, row);
        if (provider && out.has(provider.ownerId)) {
            for (const id of await providerCohostsWith(admin, provider.id, 'can_messages')) {
                if (!out.has(id)) out.set(id, category);
            }
        }
    }

    // A message FROM someone on the team — the owner or a co-host with
    // messages, of a property or a business — reaches the rest of that team,
    // as it shows unread in their inbox (lib/threadReads). And whoever wrote a
    // message is never pushed about it, whoever it was addressed to: on a stay
    // an owner booked at their own place it is addressed to them (20/10/2026).
    if (row.kind === 'message.new') {
        const message = await messageFor(admin, row);
        if (message && message.sender_id) {
            if (!message.automated) {
                for (const id of await teamFor(admin, row)) {
                    if (id !== message.sender_id && !out.has(id)) out.set(id, category);
                }
            }
            out.delete(message.sender_id);
        }
    }
    return Array.from(out, ([userId, c]) => ({ userId, category: c }));
}

/** The message a 'message:<id>' push was recorded for. */
async function messageFor(admin: any, row: any): Promise<any | null> {
    const id = String(row.dedupe_key || '').startsWith('message:') ? String(row.dedupe_key).slice(8) : null;
    if (!id) return null;
    const { data } = await admin.from('messages').select('sender_id, automated').eq('id', id).maybeSingle();
    return data || null;
}

/** Everyone answering a message's thread on the host's or the business's
 *  side, but only when the message came from one of them — a guest's message
 *  already reaches them through the fan-outs above. */
async function teamFor(admin: any, row: any): Promise<string[]> {
    const message = await messageFor(admin, row);
    if (!message) return [];
    let team: string[] = [];
    if (row.context && row.context.booking_id) {
        const listing = await listingFor(admin, row);
        if (listing) team = [listing.hostId].concat(await cohostsWith(admin, listing.id, 'can_messages'));
    } else {
        const provider = await providerFor(admin, row);
        if (provider) team = [provider.ownerId].concat(await providerCohostsWith(admin, provider.id, 'can_messages'));
    }
    return team.indexOf(message.sender_id) !== -1 ? team.filter(Boolean) : [];
}

async function prefsFor(admin: any, userId: string): Promise<Record<string, unknown> | null> {
    const { data } = await admin.from('notification_preferences').select('push').eq('user_id', userId).maybeSingle();
    return (data && data.push) || null;
}

/** Sends one claimed row. Never throws. */
export async function deliverRow(admin: any, row: any, send?: Sender, env?: Record<string, string | undefined>): Promise<RowOutcome> {
    try {
        const recipients = await recipientsFor(admin, row, env);
        if (recipients.length === 0) return { status: 'skipped', result: { reason: 'no account to push to' } };

        const per: Record<string, unknown>[] = [];
        let accepted = 0;
        let refused = 0;
        for (const r of recipients) {
            if (!pushAllowed(await prefsFor(admin, r.userId), r.category)) {
                per.push({ user: r.userId, skipped: 'switched off' });
                continue;
            }
            const report: PushReport = await pushToUserReport(admin, r.userId, {
                title: row.title,
                body: row.body,
                url: row.url,
                tag: row.kind + ':' + String(row.id || '').slice(0, 8),
            }, send);
            accepted += report.accepted;
            refused += report.failed;
            per.push({ user: r.userId, devices: report.devices, accepted: report.accepted, gone: report.gone, failed: report.failed });
        }
        return { status: accepted > 0 ? 'sent' : refused > 0 ? 'failed' : 'skipped', result: { recipients: per } };
    } catch (err: any) {
        return { status: 'failed', result: { error: (err && err.message) || String(err) } };
    }
}

/** Claim a row (pending → sending). True only for the one caller that won it. */
async function claim(admin: any, id: string): Promise<any | null> {
    const { data } = await admin
        .from('push_outbox')
        .update({ status: 'sending', claimed_at: new Date().toISOString() })
        .eq('id', id)
        .eq('status', 'pending')
        .select('*');
    return data && data[0] ? data[0] : null;
}

async function finish(admin: any, id: string, outcome: RowOutcome) {
    await admin.from('push_outbox')
        .update({ status: outcome.status, done_at: new Date().toISOString(), result: outcome.result })
        .eq('id', id);
}

export type Special = (admin: any, row: any) => Promise<RowOutcome | null>;

/** Deliver these rows (or every pending one). Never throws. */
export async function drainOutbox(
    admin: any,
    opts: { dedupeKeys?: string[]; userId?: string; kind?: string; send?: Sender; special?: Special; now?: Date } = {},
): Promise<{ claimed: number; sent: number; skipped: number; failed: number }> {
    const tally = { claimed: 0, sent: 0, skipped: 0, failed: 0 };
    try {
        const now = opts.now || new Date();
        if (!opts.dedupeKeys && !opts.userId) {
            // Housekeeping: a run that died mid-row, and rows nobody needs now.
            await admin.from('push_outbox')
                .update({ status: 'failed', done_at: now.toISOString(), result: { error: 'abandoned mid-send' } })
                .eq('status', 'sending')
                .lt('claimed_at', new Date(now.getTime() - STALE_MINUTES * 60000).toISOString());
            await admin.from('push_outbox')
                .delete()
                .lt('created_at', new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString());
        }

        let q = admin.from('push_outbox').select('id').eq('status', 'pending').order('created_at', { ascending: true }).limit(BATCH);
        if (opts.dedupeKeys) q = q.in('dedupe_key', opts.dedupeKeys);
        if (opts.userId) q = q.eq('user_id', opts.userId);
        if (opts.kind) q = q.eq('kind', opts.kind);
        const { data: pending } = await q;

        for (const p of pending || []) {
            const row = await claim(admin, p.id);
            if (!row) continue;
            tally.claimed++;
            let outcome: RowOutcome | null = null;
            if (opts.special) {
                try { outcome = await opts.special(admin, row); } catch (err: any) {
                    outcome = { status: 'failed', result: { error: (err && err.message) || String(err) } };
                }
            }
            if (!outcome) outcome = await deliverRow(admin, row, opts.send);
            await finish(admin, row.id, outcome);
            tally[outcome.status]++;
        }
    } catch {
        // Whatever was not reached stays pending for the next run.
    }
    return tally;
}
