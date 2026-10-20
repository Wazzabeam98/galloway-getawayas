// Pending co-host invitations shown on the site (banner on the dashboard and
// home page, a line and a dot in the menu), so an invitation can't be missed
// when the email lands in junk and no push arrives.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const { pendingInvitesFor } = require('../lib/pendingInvites');
const { listUnsubscribe } = require('../lib/email');
const { pushForEmail } = require('../lib/pushRules');

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
                then: (res: any) => res({ data: (tables[t] || []).filter((r) => f.every((x) => x(r))), error: null }),
            };
            return b;
        },
    };
}

const DATA = () => ({
    listing_access: [
        { invite_token: 't-new', listing_id: 'l1', role: 'co_host', invited_by: 'liam', invited_at: '2026-10-19T21:10:00Z', email: 'Jamie@Hotmail.co.uk', status: 'invited' },
        { invite_token: 't-old', listing_id: 'l1', role: 'co_host', invited_by: 'liam', invited_at: '2026-10-19T19:12:00Z', email: 'jamie@hotmail.co.uk', status: 'invited' },
        { invite_token: 't-2', listing_id: 'l2', role: 'staff', invited_by: 'liam', invited_at: '2026-10-19T19:00:00Z', email: 'jamie@hotmail.co.uk', status: 'invited' },
        { invite_token: 't-gone', listing_id: 'l3', role: 'co_host', invited_by: 'liam', invited_at: '2026-10-19T18:00:00Z', email: 'jamie@hotmail.co.uk', status: 'revoked' },
        { invite_token: 't-other', listing_id: 'l1', role: 'co_host', invited_by: 'liam', invited_at: '2026-10-19T18:00:00Z', email: 'jamie_x@hotmail.co.uk', status: 'invited' },
        { invite_token: 't-live', listing_id: 'l4', role: 'co_host', invited_by: 'liam', invited_at: '2026-08-19T18:00:00Z', email: 'jamie@hotmail.co.uk', status: 'active' },
    ],
    listings: [{ id: 'l1', title: 'Modern 3 Bedroom, Kirkcudbright' }, { id: 'l2', title: 'Modern Cottage, with Hot Tub' }, { id: 'l3', title: 'Gone' }, { id: 'l4', title: 'Townhouse' }],
    profiles: [{ id: 'liam', first_name: 'Liam', preferred_name: null }],
});

test('the invitations waiting on someone: open ones, to their address, newest per listing', async () => {
    const list = await pendingInvitesFor(db(DATA()), 'jamie@hotmail.co.uk');
    assert.deepEqual(list.map((i: any) => [i.token, i.listingTitle, i.role, i.inviterFirst]), [
        ['t-new', 'Modern 3 Bedroom, Kirkcudbright', 'co_host', 'Liam'],
        ['t-2', 'Modern Cottage, with Hot Tub', 'staff', 'Liam'],
    ]);
});

test('nobody signed in, or no address: nothing', async () => {
    assert.deepEqual(await pendingInvitesFor(db(DATA()), ''), []);
    assert.deepEqual(await pendingInvitesFor(db(DATA()), null), []);
    assert.deepEqual(await pendingInvitesFor(db(DATA()), 'someone@else.com'), []);
});

test('the banner is on the dashboard and the home page, and the menu carries a line and the dot', () => {
    assert.match(fs.readFileSync(path.join(ROOT, 'app/dashboard/page.tsx'), 'utf8'), /<CohostInvites /);
    assert.match(fs.readFileSync(path.join(ROOT, 'app/page.tsx'), 'utf8'), /<CohostInvites /);
    assert.match(fs.readFileSync(path.join(ROOT, 'components/base/NavMenu.tsx'), 'utf8'), /<InvitesLink /);
    assert.match(fs.readFileSync(path.join(ROOT, 'components/base/MenuUnreadDot.tsx'), 'utf8'), /invites > 0/);
    const banner = fs.readFileSync(path.join(ROOT, 'components/CohostInvites.tsx'), 'utf8');
    assert.match(banner, /'\/api\/listing-access\/accept'/, 'Accept uses the existing accept route and its checks');
    assert.match(banner, /'\/api\/listing-access\/decline'/);
});

test('declining is only for the person it was sent to, and tells the owner', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app/api/listing-access/decline/route.ts'), 'utf8');
    assert.match(src, /getUser\(\)/);
    assert.match(src, /\(user\.email \|\| ''\)\.toLowerCase\(\) !== String\(invite\.email \|\| ''\)\.toLowerCase\(\)/);
    assert.match(src, /\.eq\('status', 'invited'\)/);
    const p = pushForEmail('Jamie declined your co-host invitation', '');
    assert.deepEqual([p.title, p.category], ['Jamie declined your invitation', 'listings']);
});

test('emails with an unsubscribe link carry the List-Unsubscribe header; others don’t', () => {
    const html = '<a href="https://gallowaygetaways.co.uk/unsubscribe?token=abc&amp;type=new_message">Unsubscribe</a>';
    assert.deepEqual(listUnsubscribe(html), { headers: { 'List-Unsubscribe': '<https://gallowaygetaways.co.uk/unsubscribe?token=abc&type=new_message>, <mailto:hello@gallowaygetaways.co.uk?subject=unsubscribe>' } });
    assert.deepEqual(listUnsubscribe('<a href="https://gallowaygetaways.co.uk/trips">Trips</a>'), {});
});
