// Your own messages are never unread for you, and a team hears what its
// members say.
//
// 20/10/2026: Liam wrote in a thread on a stay he had booked at his own place
// (guest and host are one account, so the message was addressed to him). Back
// on the list it showed as unread to him — bold, in the badge and the menu dot
// — and Jamie, his co-host, was neither pushed nor shown it as new: a co-host
// is never the recipient of anything, so nothing was ever unread for them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { isUnreadFor, isInboundFor, TEAM_READS_FROM } = require('../lib/threadReads');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { needsReply } = require('../lib/conversations');

const LATER = '2026-10-21T10:00:00Z';
const msg = (over: any) => ({ sender_id: 'guest', recipient_id: 'owner', read_at: null, created_at: LATER, automated: false, ...over });

test('something you sent is never unread for you, even when it is addressed to you', () => {
    assert.equal(isUnreadFor(msg({ sender_id: 'liam', recipient_id: 'liam' }), 'liam', true), false,
        'a stay booked at your own place: your message to "the guest" is to you');
    assert.equal(isUnreadFor(msg({ sender_id: 'liam', recipient_id: 'liam' }), 'liam', false), false);
    assert.equal(isUnreadFor(msg({ sender_id: 'owner', recipient_id: 'guest' }), 'owner', true), false);
    assert.equal(isInboundFor(msg({ sender_id: 'liam', recipient_id: 'liam' }), 'liam', true), false,
        'nor does it bring an archived conversation back');
});

test('a message to you is unread until you open it, as before', () => {
    assert.equal(isUnreadFor(msg({}), 'owner', true), true);
    assert.equal(isUnreadFor(msg({ read_at: LATER }), 'owner', true), false);
    assert.equal(isUnreadFor(msg({}), 'guest', false), false, 'the guest wrote it');
});

test('a co-host sees the owner’s reply and the guest’s question as new until they read the thread', () => {
    const ownerReply = msg({ sender_id: 'owner', recipient_id: 'guest' });
    const guestAsk = msg({ sender_id: 'guest', recipient_id: 'owner' });
    assert.equal(isUnreadFor(ownerReply, 'jamie', true), true);
    assert.equal(isUnreadFor(guestAsk, 'jamie', true), true);
    assert.equal(isUnreadFor(ownerReply, 'jamie', true, '2026-10-21T11:00:00Z'), false, 'read past it');
    assert.equal(isUnreadFor(ownerReply, 'jamie', false), false, 'not on the team: not theirs');
});

test('the owner sees a co-host’s reply as new; the guest does not see it twice', () => {
    const coHostReply = msg({ sender_id: 'jamie', recipient_id: 'guest' });
    assert.equal(isUnreadFor(coHostReply, 'owner', true), true);
    assert.equal(isUnreadFor(coHostReply, 'guest', false), true, 'addressed to the guest: the read_at rule');
});

test('history before team read positions existed, and automated messages, are never new to the team', () => {
    assert.equal(isUnreadFor(msg({ sender_id: 'owner', recipient_id: 'guest', created_at: '2026-10-01T09:00:00Z' }), 'jamie', true), false);
    assert.ok(new Date(TEAM_READS_FROM).getTime() <= new Date('2026-10-20T16:00:00Z').getTime(),
        'Liam’s message to the guest on 20/10/2026 counts as new for Jamie');
    assert.equal(isUnreadFor(msg({ sender_id: 'owner', recipient_id: 'guest', automated: true }), 'jamie', true), false,
        'the check-in message is the team’s own words');
});

test('an answer from anyone on the team answers the guest', () => {
    const last = { sender_id: 'owner', created_at: LATER };
    assert.equal(needsReply(last, 'jamie', null, ['owner', 'jamie']), false, 'the owner replied: not waiting on the co-host');
    assert.equal(needsReply({ sender_id: 'guest', created_at: LATER }, 'jamie', null, ['owner', 'jamie']), true);
    assert.equal(needsReply(last, 'jamie'), true, 'without the team, the old per-person rule');
});
