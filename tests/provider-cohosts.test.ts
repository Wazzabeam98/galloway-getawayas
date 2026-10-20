// Co-hosts for guest experiences and trades — the holiday-let co-host system
// copied onto a business (provider_access, lib/providerAccess). What has to hold:
//   - the owner, or an ACTIVE co-host with the permission, may act; nobody else
//   - full access means every permission; only the owner may grant it
//   - an invitation to a business shows in the same pending-invites banner
//   - a business email reaches the co-hosts its permission covers, and only those
//   - owner-only things (payouts, subscription, billing) stay owner-only

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const { mayActOn, providerIdsWith, pickDashboardProvider } = require('../lib/providerAccess');
const { pendingInvitesFor } = require('../lib/pendingInvites');
const { providerTeamCopies } = require('../lib/providerTeamEmail');
const { pushForEmail } = require('../lib/pushRules');
const { recipientsFor } = require('../lib/pushDispatch');

function db(tables: Record<string, any[]>) {
    return {
        from: (t: string) => {
            const f: ((r: any) => boolean)[] = [];
            const b: any = {
                select: () => b,
                eq: (c: string, v: any) => { f.push((r) => r[c] === v); return b; },
                ilike: (c: string, v: string) => { const w = v.replace(/\\([\\%_])/g, '$1').toLowerCase(); f.push((r) => String(r[c] || '').toLowerCase() === w); return b; },
                in: (c: string, vs: any[]) => { f.push((r) => vs.includes(r[c])); return b; },
                order: () => b,
                limit: () => b,
                maybeSingle: () => ({ then: (res: any) => res({ data: (tables[t] || []).filter((r) => f.every((x) => x(r)))[0] || null, error: null }) }),
                then: (res: any) => res({ data: (tables[t] || []).filter((r) => f.every((x) => x(r))), error: null }),
            };
            return b;
        },
    };
}

const PROVIDER = { id: 'p1', owner_id: 'owner', business_name: 'Solway Sauna', contact_email: 'hello@solwaysauna.co.uk' };
const grant = (over: any) => ({
    id: 'a-' + over.user_id, provider_id: 'p1', email: over.user_id + '@example.co.uk', status: 'active',
    can_calendar: false, can_messages: false, can_bookings: false, can_listing: false, can_earnings: false, ...over,
});
const DATA = () => ({
    service_providers: [PROVIDER],
    provider_access: [
        grant({ user_id: 'cal', can_calendar: true }),
        grant({ user_id: 'full', can_calendar: true, can_messages: true, can_bookings: true, can_listing: true, can_earnings: true }),
        grant({ user_id: 'gone', can_calendar: true, can_bookings: true, status: 'revoked' }),
        grant({ user_id: 'asked', can_bookings: true, status: 'invited' }),
    ],
});

test('the owner, or an active co-host holding the permission — nobody else', async () => {
    const admin = db(DATA());
    assert.equal(await mayActOn(admin, 'owner', PROVIDER, 'can_bookings'), true);
    assert.equal(await mayActOn(admin, 'cal', PROVIDER, 'can_calendar'), true);
    assert.equal(await mayActOn(admin, 'cal', PROVIDER, 'can_bookings'), false, 'a calendar co-host cannot answer bookings');
    assert.equal(await mayActOn(admin, 'gone', PROVIDER, 'can_calendar'), false, 'a removed co-host has nothing');
    assert.equal(await mayActOn(admin, 'asked', PROVIDER, 'can_bookings'), false, 'an unaccepted invitation grants nothing');
    assert.equal(await mayActOn(admin, 'stranger', PROVIDER, 'can_calendar'), false);
    assert.equal(await mayActOn(admin, null, PROVIDER, 'can_calendar'), false);
});

test('full access is every permission ticked, and equals the owner for what it covers', async () => {
    const admin = db(DATA());
    assert.equal(await mayActOn(admin, 'full', PROVIDER, 'full'), true);
    assert.equal(await mayActOn(admin, 'owner', PROVIDER, 'full'), true);
    assert.equal(await mayActOn(admin, 'cal', PROVIDER, 'full'), false);
});

test('the businesses a person may use for a purpose: owned and co-hosted', async () => {
    const admin = db({ ...DATA(), service_providers: [PROVIDER, { id: 'p2', owner_id: 'cal' }] });
    assert.deepEqual((await providerIdsWith(admin, 'cal', 'can_calendar')).sort(), ['p1', 'p2']);
    assert.deepEqual(await providerIdsWith(admin, 'cal', 'can_messages'), ['p2']);
});

test('a dashboard shows their own business first, else the one they co-host', () => {
    const rows = [{ id: 'theirs-approved', status: 'approved' }, { id: 'mine-draft', status: 'draft' }];
    const access: any = { 'theirs-approved': { isOwner: false }, 'mine-draft': { isOwner: true } };
    assert.equal(pickDashboardProvider(rows, access).id, 'mine-draft');
    assert.equal(pickDashboardProvider([rows[0]], access).id, 'theirs-approved');
});

test('an invitation to a business shows in the same banner as a holiday let’s', async () => {
    const admin = db({
        listing_access: [],
        provider_access: [{ invite_token: 'pt', provider_id: 'p1', role: 'co_host', invited_by: 'owner', invited_at: '2026-10-20T10:00:00Z', email: 'Jamie@Hotmail.co.uk', status: 'invited' }],
        service_providers: [PROVIDER],
        profiles: [{ id: 'owner', first_name: 'Liam', preferred_name: null }],
    });
    const list = await pendingInvitesFor(admin, 'jamie@hotmail.co.uk');
    assert.deepEqual(list.map((i: any) => [i.token, i.kind, i.listingTitle, i.inviterFirst]), [['pt', 'provider', 'Solway Sauna', 'Liam']]);
});

test('a business email reaches the co-hosts its permission covers, and only those', async () => {
    const admin = db(DATA());
    // A new booking is bookings: the full-access co-host, not the calendar one.
    assert.deepEqual(await providerTeamCopies(PROVIDER.contact_email, 'A new booking', '<p>x</p>', admin), ['full@example.co.uk']);
    // A booking request is bookings too.
    assert.equal(pushForEmail('A guest would like to book you', '').team, 'can_bookings');
    // The subscription stays the owner's: no copy to anyone.
    assert.deepEqual(await providerTeamCopies(PROVIDER.contact_email, 'Time to add a card—Solway Sauna', '<p>x</p>', admin), []);
    // An address that isn't a business's: nothing.
    assert.deepEqual(await providerTeamCopies('someone@else.co.uk', 'A new booking', '<p>x</p>', admin), []);
});

test('payouts, the subscription and billing stay with the owner', () => {
    const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.match(read('app/api/services/connect/route.ts'), /provider\.owner_id !== user\.id/);
    assert.match(read('app/api/services/subscription/route.ts'), /p\.owner_id !== user\.id/);
    assert.match(read('app/api/account/vat/route.ts'), /data\.owner_id !== userId/);
    // The pages hide them from a co-host.
    assert.match(read('app/services/dashboard/edit/page.tsx'), /mine\.isOwner && subscription/);
    assert.match(read('app/services/dashboard/page.tsx'), /awaitingPayouts && mine\.isOwner/);
    // Refunding needs full access, as cancelling a holiday-let stay does.
    assert.match(read('app/api/services/orders/respond/route.ts'), /decision === 'refund' \? 'full' : 'can_bookings'/);
});

test('only the owner can give a co-host full access, on a business too', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app/api/listing-access/route.ts'), 'utf8');
    assert.match(src, /cohostTarget\(body && body\.kind\)/, 'one route serves both, by kind');
    assert.match(src, /if \(!auth\.isOwner && isFullGrant\(permissions\)\)/);
    assert.match(src, /if \(!auth\.isOwner && isFullGrant\(nextPerms\)\)/);
});

test('a trade returning to a saved draft gets its About-you answers back, on the step it left', () => {
    const src = fs.readFileSync(path.join(ROOT, 'components/services/ProviderSignUp.tsx'), 'utf8');
    // Read for both audiences, before the guest-only branch.
    const hubAt = src.indexOf('if (hub.professional_title) setProfessionalTitle');
    const guestBranch = src.indexOf("if (audienceForTrade(existing.trade || tradeFromUrl) === 'guest') {");
    assert.ok(hubAt > 0 && hubAt < guestBranch, 'the About-you hub is read outside the guest-only branch');
    assert.match(src, /resume_step: step/, 'a trade’s save records the step it was on');
    assert.match(src, /resolveStep\(t, hub\.resume_step\)/, 'and a saved draft reopens there');
    // Saving no longer resets the opening position (which sent them to step one).
    const save = src.slice(src.indexOf('const save = async (submit: boolean)'), src.indexOf('if (loading) {'));
    assert.doesNotMatch(save, /setRestored\(false\)/);
});

test('a message to the business’s owner pushes its co-hosts with messages too', async () => {
    const ORDER = '6e10a156-613a-4297-b18b-a7f2a4d76f93';
    const admin = db({
        ...DATA(),
        provider_access: [
            grant({ user_id: 'msgs', can_messages: true }),
            grant({ user_id: 'cal', can_calendar: true }),
        ],
        service_orders: [{ id: ORDER, provider_id: 'p1' }],
        service_enquiries: [],
        bookings: [],
        listings: [],
    });
    const row = { kind: 'message.new', user_id: 'owner', category: 'messages', url: '/services/messages/order/' + ORDER, context: null };
    const to = (await recipientsFor(admin, row)).map((r: any) => r.userId).sort();
    assert.deepEqual(to, ['msgs', 'owner'], 'the messages co-host, not the calendar one');
    // A message the business sends to the guest reaches the guest alone.
    const out = { ...row, user_id: 'guest', url: '/experiences/order/' + ORDER };
    assert.deepEqual((await recipientsFor(admin, out)).map((r: any) => r.userId), ['guest']);
});
