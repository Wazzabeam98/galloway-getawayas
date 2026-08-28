// Approving and declining host listings, and doing ten at once.
//
// The promise this exists for: hosts register in the weeks before soft launch,
// sit in a queue, and everything goes live on the day. That makes bulk approval
// the load-bearing case, and the failures worth testing are the ones that would
// spoil a launch morning — a half-finished property going live, a decision
// landing twice, or nine working and the tenth failing silently.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const ROUTE = '@/app/api/admin/listings/decide/route';
const OWNER = 'owner-1';
const HOST = 'host-1';

/** A listing with everything the publish rules ask for. */
function finished(overrides: any = {}) {
    return {
        id: 'l-1',
        title: 'Harbour Cottage',
        host_id: HOST,
        status: 'pending_review',
        images: ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'],
        property_type: 'cottage',
        street_address: '1 Harbour Street',
        location: 'Kirkcudbright, Dumfries & Galloway',
        postcode: 'DG6 4JS',
        price_per_night: 120,
        max_guests: 4,
        bedrooms: 2,
        beds: 2,
        bathrooms: 1,
        check_in_method: 'lockbox',
        amenities: ['Wifi', 'Kitchen', 'Parking'],
        description: 'A comfortable cottage a short walk from the harbour, with a small garden.',
        ...overrides,
    };
}

function load(listings: any[], { isAdmin = true, emailOk = true, hostEmail = 'host@example.invalid', raceOnRead = false } = {}) {
    const updates: any[] = [];
    const emails: any[] = [];
    const byId: Record<string, any> = {};
    for (const l of listings) byId[l.id] = { ...l };

    const admin: any = {
        from(table: string) {
            const filters: Record<string, any> = {};
            const chain: any = new Proxy({}, {
                get(_t, prop: string) {
                    if (prop === 'eq') {
                        return (col: string, val: any) => { filters[col] = val; return chain; };
                    }
                    if (prop === 'maybeSingle') {
                        return async () => {
                            if (table === 'profiles') {
                                return filters.id === OWNER
                                    ? { data: { is_admin: isAdmin }, error: null }
                                    : { data: { email: hostEmail, full_name: 'Jo Host' }, error: null };
                            }
                            const row = byId[filters.id] || null;
                            // Somebody else deciding in the gap between this
                            // read and the write that follows it. Handing back
                            // the row as it was, then changing it, is the only
                            // way to exercise the guard on the write — flipping
                            // it beforehand only re-tests the guard on the read.
                            if (row && raceOnRead && row.status === 'pending_review') {
                                const asRead = { ...row };
                                row.status = 'published';
                                return { data: asRead, error: null };
                            }
                            return { data: row, error: null };
                        };
                    }
                    if (prop === 'update') {
                        return (patch: any) => {
                            // The route narrows on status too; model that, because
                            // "only if it is still pending" is the whole guard
                            // against two owners approving at once.
                            const finish = async () => {
                                const row = byId[filters.id];
                                // Postgres matches on every filter, and an update
                                // that matches nothing is not an error — it returns
                                // no rows. Modelling that is the whole point.
                                const statusOk = filters.status === undefined || (row && row.status === filters.status);
                                if (row && statusOk) {
                                    updates.push({ id: filters.id, patch });
                                    Object.assign(row, patch);
                                    return { data: [{ id: filters.id }], error: null };
                                }
                                return { data: [], error: null };
                            };
                            const updateChain: any = new Proxy({}, {
                                get(_t2, p2: string) {
                                    if (p2 === 'eq') return (c: string, v: any) => { filters[c] = v; return updateChain; };
                                    if (p2 === 'select') return () => updateChain;
                                    if (p2 === 'then') return (resolve: any) => finish().then(resolve);
                                    return () => updateChain;
                                },
                            });
                            return updateChain;
                        };
                    }
                    if (prop === 'then') return (resolve: any) => resolve({ data: null, error: null });
                    return () => chain;
                },
            });
            return chain;
        },
    };

    stubModule('@supabase/supabase-js', { createClient: () => admin });
    stubModule('@supabase/auth-helpers-nextjs', {
        createRouteHandlerClient: () => ({
            auth: { getUser: async () => ({ data: { user: { id: OWNER } } }) },
        }),
    });
    stubModule('next/headers', { cookies: () => ({}) });
    stubModule('@/lib/email', {
        SITE_URL: 'http://example.invalid',
        escapeHtml: (v: string) => String(v || ''),
        button: () => '',
        emailLayout: (body: string) => body,
        sendEmail: async (to: string, subject: string, html: string) => {
            emails.push({ to, subject, html });
            return emailOk;
        },
    });
    stubModule('@/lib/logError', { logError: async () => {} });
    stubModule('next/server', {
        NextResponse: {
            json: (body: any, init?: any) => ({ body, status: (init && init.status) || 200 }),
        },
    });

    clearModule('@/lib/supabaseAdmin');
    clearModule(ROUTE);
    return { route: require(ROUTE), updates, emails, byId };
}

const post = (body: any) => new Request('http://x/api/admin/listings/decide', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
});

/* ------------------------------------------------------------- approving */

test('approving one listing publishes it and emails the host', async () => {
    const { route, updates, emails } = load([finished()]);
    const res = await route.POST(post({ decision: 'approve', id: 'l-1' }));

    assert.equal(res.body.ok, true);
    assert.equal(res.body.decided, 1);
    assert.equal(updates[0].patch.status, 'published');
    assert.ok(updates[0].patch.approved_at, 'the approval is dated');
    assert.equal(updates[0].patch.review_note, null, 'any previous note is cleared');
    assert.equal(emails.length, 1);
    assert.match(emails[0].subject, /is live/);
});

test('ten listings are approved in one press', async () => {
    // The launch-morning case, and the reason bulk exists at all.
    const many = Array.from({ length: 10 }, (_, i) => finished({ id: `l-${i}`, title: `Cottage ${i}` }));
    const { route, updates, emails } = load(many);

    const res = await route.POST(post({ decision: 'approve', ids: many.map((m) => m.id) }));

    assert.equal(res.body.decided, 10);
    assert.equal(res.body.failed, 0);
    assert.equal(updates.length, 10, 'every one written');
    assert.equal(emails.length, 10, 'every host told');
    assert.match(res.body.summary, /10 done/);
});

test('one failure in a batch does not stop the other nine', async () => {
    // Somebody else approved the third one a minute ago. The other nine must
    // still go live, and the operator must be told which did not.
    const many = Array.from({ length: 10 }, (_, i) => finished({ id: `l-${i}` }));
    many[2].status = 'published';
    const { route, updates } = load(many);

    const res = await route.POST(post({ decision: 'approve', ids: many.map((m) => m.id) }));

    assert.equal(res.body.decided, 9);
    assert.equal(res.body.failed, 1);
    assert.equal(updates.length, 9);
    const failure = res.body.outcomes.filter((o: any) => !o.ok)[0];
    assert.equal(failure.id, 'l-2');
    assert.match(failure.error, /Already live/);
    assert.match(res.body.summary, /9 done, 1 failed/);
});

test('a half-finished listing is refused, however it is asked for', async () => {
    // The queue will not let it be selected, but the screen is not the guard.
    const { route, updates, emails } = load([finished({ price_per_night: 0 })]);
    const res = await route.POST(post({ decision: 'approve', id: 'l-1' }));

    assert.equal(res.body.decided, 0);
    assert.match(res.body.outcomes[0].error, /Not finished/);
    assert.deepEqual(updates, [], 'nothing published');
    assert.deepEqual(emails, [], 'and nobody told it went live');
});

test('a listing that is not waiting cannot be approved', async () => {
    const { route, updates } = load([finished({ status: 'draft' })]);
    const res = await route.POST(post({ decision: 'approve', id: 'l-1' }));

    assert.equal(res.body.decided, 0);
    assert.match(res.body.outcomes[0].error, /Not waiting/);
    assert.deepEqual(updates, []);
});

test('the same id twice is decided once, not twice', async () => {
    // A row button and a checkbox can both name the same listing. Deciding it
    // twice is how a host gets two emails.
    const { route, updates, emails } = load([finished()]);
    const res = await route.POST(post({ decision: 'approve', ids: ['l-1', 'l-1', 'l-1'] }));

    assert.equal(res.body.decided, 1);
    assert.equal(updates.length, 1);
    assert.equal(emails.length, 1);
});

/* -------------------------------------------------------------- declining */

test('declining sends the listing back to draft with the reason', async () => {
    const { route, updates, emails } = load([finished()]);
    const res = await route.POST(post({
        decision: 'decline', id: 'l-1', note: 'Could you add a photo of the kitchen?',
    }));

    assert.equal(res.body.decided, 1);
    assert.equal(updates[0].patch.status, 'draft', 'back where the host can fix it');
    assert.equal(updates[0].patch.review_note, 'Could you add a photo of the kitchen?');
    assert.ok(updates[0].patch.declined_at);
    assert.equal(emails.length, 1);
    assert.match(emails[0].html, /add a photo of the kitchen/, 'the reason is in the email, verbatim');
});

test('a decline without a reason is refused', async () => {
    // The reason is the body of the email. Without it the host has a returned
    // listing and no idea what to change.
    const { route, updates } = load([finished()]);
    const res = await route.POST(post({ decision: 'decline', id: 'l-1', note: '   ' }));

    assert.equal(res.status, 400);
    assert.match(res.body.error, /needs a reason/);
    assert.deepEqual(updates, []);
});

test('declines cannot be done in bulk', async () => {
    const { route, updates } = load([finished({ id: 'l-1' }), finished({ id: 'l-2' })]);
    const res = await route.POST(post({
        decision: 'decline', ids: ['l-1', 'l-2'], note: 'Needs better photos',
    }));

    assert.equal(res.status, 400);
    assert.match(res.body.error, /one at a time/);
    assert.deepEqual(updates, []);
});

/* ------------------------------------------------------------ permission */

test('a signed-in non-owner cannot decide anything', async () => {
    const { route, updates } = load([finished()], { isAdmin: false });
    const res = await route.POST(post({ decision: 'approve', id: 'l-1' }));

    assert.equal(res.status, 403);
    assert.deepEqual(updates, []);
});

/* ----------------------------------------------------------------- email */

test('a decision stands even when the email fails, and says so', async () => {
    // The listing is live. Pretending the host was told is the failure worth
    // avoiding — they are still waiting to hear.
    const { route, updates } = load([finished()], { emailOk: false });
    const res = await route.POST(post({ decision: 'approve', id: 'l-1' }));

    assert.equal(res.body.decided, 1);
    assert.equal(updates[0].patch.status, 'published', 'the decision is not undone');
    assert.equal(res.body.unemailed, 1);
    assert.match(res.body.summary, /could not be emailed/);
});


test('a listing decided by somebody else in between is not decided twice', async () => {
    // Two owners on a launch morning, both looking at the same queue. The read
    // succeeds — the row was still pending when this decision started — and by
    // the time it writes, the other press has landed.
    //
    // The write must match nothing, and crucially the route must NOTICE that:
    // an update matching no rows is not an error, so without checking what came
    // back the host gets a second email saying their property is live.
    const { route, updates, emails } = load([finished()], { raceOnRead: true });

    const res = await route.POST(post({ decision: 'approve', id: 'l-1' }));

    assert.equal(res.body.decided, 0);
    assert.match(res.body.outcomes[0].error, /Somebody else/);
    assert.deepEqual(updates, [], 'nothing written the second time');
    assert.deepEqual(emails, [], 'and no second email');
});
