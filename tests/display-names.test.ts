// "Show my full legal name" — one switch, two audiences.
//
// The rule the site promises, in the toggle's own words on the account page:
// turn it off and other guests and hosts see your preferred name, or no name
// at all if you have not set one. It does NOT promise that the company cannot
// see who you are — the privacy policy says the opposite, plainly, because
// approving a host and settling a dispute are decisions about a real person.
//
// So there are two functions and they disagree on purpose. Most of what is
// below asserts that disagreement stays exactly where it is meant to be:
// displayName() for anything a guest or a host can load, adminName() only
// under app/admin.
//
// The source-level checks at the bottom exist because of how this repo
// changes. Whole files get pasted in from the work laptop, and a paste that
// carries an older copy of an admin page would silently swap the rule back
// without anybody deciding to. A grep in a test is what notices.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const fs = require('fs');
const path = require('path');

/* eslint-disable @typescript-eslint/no-var-requires */
const { displayName, firstName, adminName } = require('@/lib/utils');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const MORAG = { full_name: 'Morag MacLellan', preferred_name: '', show_full_name: true };
const HIDDEN = { full_name: 'Morag MacLellan', preferred_name: '', show_full_name: false };
const HIDDEN_WITH_PREFERRED = { full_name: 'Morag MacLellan', preferred_name: 'Mo', show_full_name: false };

/* ------------------------------------------- what another guest or host sees */

test('the legal name shows while the switch is on', () => {
    assert.equal(displayName(MORAG, 'Guest'), 'Morag MacLellan');
});

test('a preferred name always wins, switch on or off', () => {
    assert.equal(displayName({ ...MORAG, preferred_name: 'Mo' }, 'Guest'), 'Mo');
    assert.equal(displayName(HIDDEN_WITH_PREFERRED, 'Guest'), 'Mo');
});

test('switch off and no preferred name means NO name, not a shortened one', () => {
    // The decision of 31 August 2026, and the reason this test is worded like
    // an argument: "first name and initial" was considered and rejected.
    // Somebody who turned this off was told on screen they would appear as
    // "Host" or "Guest", and "Morag M." is more identifiable than that. The
    // promise the toggle made is the promise the site keeps.
    const shown = displayName(HIDDEN, 'Guest');
    assert.equal(shown, 'Guest');
    assert.equal(shown.indexOf('Morag'), -1);
    assert.equal(shown.indexOf('MacLellan'), -1);
});

test('a missing column counts as on, which is how the site behaved before the switch existed', () => {
    assert.equal(displayName({ full_name: 'Morag MacLellan' }, 'Guest'), 'Morag MacLellan');
    assert.equal(displayName({ full_name: 'Morag MacLellan', show_full_name: null }, 'Guest'), 'Morag MacLellan');
});

test('whitespace is not a name', () => {
    assert.equal(displayName({ full_name: '   ', preferred_name: '  ', show_full_name: true }, 'Guest'), 'Guest');
});

test('no profile at all falls back rather than throwing', () => {
    assert.equal(displayName(null, 'Guest'), 'Guest');
    assert.equal(displayName(undefined, 'Host'), 'Host');
});

/* --------------------------------- first name only, where two people message */

// The intent, decided 4 September 2026: in a booking message thread a guest and
// their host see each other's FIRST name only — enough to talk, and neither is
// handed the other's surname just for booking direct. firstName() sits on top
// of displayName(), so the switch is honoured exactly as above: off with no
// preferred name is still the bare fallback, never a shortened legal name.

test('the counterparty is named by first name only while the switch is on', () => {
    assert.equal(firstName(MORAG, 'Guest'), 'Morag');
    assert.equal(firstName(MORAG, 'Guest').indexOf('MacLellan'), -1);
});

test('a preferred name is shown as-is, switch on or off', () => {
    assert.equal(firstName({ ...MORAG, preferred_name: 'Mo' }, 'Guest'), 'Mo');
    assert.equal(firstName(HIDDEN_WITH_PREFERRED, 'Guest'), 'Mo');
});

test('switch off and no preferred name means the bare fallback, not a first name', () => {
    // The same promise displayName keeps: turning the switch off yields "Guest"
    // /"Host", never "Morag". first-name-only narrows what a counterparty sees;
    // it does not widen it back for someone who asked to be hidden.
    const shown = firstName(HIDDEN, 'Guest');
    assert.equal(shown, 'Guest');
    assert.equal(shown.indexOf('Morag'), -1);
    assert.equal(shown.indexOf('MacLellan'), -1);
});

test('firstName with no profile falls back rather than throwing', () => {
    assert.equal(firstName(null, 'Guest'), 'Guest');
    assert.equal(firstName(undefined, 'Host'), 'Host');
});

test('the booking message thread names the other person by first name, honouring the switch', () => {
    // Both directions: the list route and the single-thread route each name the
    // counterparty (a host to a guest, a guest to a host). Both must use
    // firstName, and both must read show_full_name so the switch is not
    // invisible to them (selecting only full_name would read as "on").
    for (const rel of ['app/api/messages/threads/route.ts', 'app/api/messages/threads/[bookingId]/route.ts']) {
        const src = read(rel);
        assert.ok(
            src.indexOf('firstName(') !== -1,
            rel + ' no longer names the other person by first name only'
        );
        assert.equal(
            src.indexOf('displayName('), -1,
            rel + ' still calls displayName, so it can show a counterparty their surname'
        );
        assert.ok(
            src.indexOf('show_full_name') !== -1,
            rel + ' does not select show_full_name, so the name switch is invisible to it'
        );
    }
});

/* ------------------------------------------------------ what an admin sees */

test('an admin sees the real name even with the switch off', () => {
    assert.equal(adminName(HIDDEN, 'Host'), 'Morag MacLellan');
    assert.equal(adminName(HIDDEN_WITH_PREFERRED, 'Host'), 'Morag MacLellan');
});

test('an admin sees the legal name in preference to a preferred one', () => {
    // The opposite of displayName, and the point of having two functions: on
    // an admin screen "Mo" is not enough to approve somebody or pay them.
    assert.equal(adminName({ ...MORAG, preferred_name: 'Mo' }, 'Host'), 'Morag MacLellan');
});

test('an account with no legal name falls back to the preferred one', () => {
    assert.equal(adminName({ full_name: '', preferred_name: 'Mo', show_full_name: false }, 'Host'), 'Mo');
    assert.equal(adminName({ full_name: '', preferred_name: '', show_full_name: true }, 'Host'), 'Host');
});

/* ------------------------------------------------- where each one may appear */

const ADMIN_PAGES = [
    'app/admin/listings/page.tsx',
    'app/admin/payouts/page.tsx',
    'app/admin/earnings/page.tsx',
    'app/admin/commission/page.tsx',
];

test('every admin screen that names a host uses adminName, not displayName', () => {
    for (const rel of ADMIN_PAGES) {
        const src = read(rel);
        assert.ok(
            src.indexOf('adminName(') !== -1,
            rel + ' no longer calls adminName — an admin screen has stopped showing real names'
        );
        assert.equal(
            src.indexOf('displayName('), -1,
            rel + ' calls displayName, so it is masking a name the owner needs to see'
        );
    }
});

test('adminName is not reachable from anything a guest or host loads', () => {
    // Walks the tree rather than listing files, so a new page cannot quietly
    // become the exception.
    const offenders: string[] = [];

    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
            const rel = dir + '/' + entry.name;
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name === '.next') continue;
                walk(rel);
            } else if (/\.tsx?$/.test(entry.name)) {
                if (rel.indexOf('app/admin/') === 0) continue;
                if (rel === 'lib/utils.ts') continue;
                if (fs.readFileSync(path.join(ROOT, rel), 'utf8').indexOf('adminName(') !== -1) {
                    offenders.push(rel);
                }
            }
        }
    };

    walk('app');
    walk('components');
    walk('lib');

    assert.deepEqual(
        offenders, [],
        'These are outside app/admin and call adminName, so they show a real name to '
        + 'somebody who is not an admin: ' + offenders.join(', ')
    );
});

/* ------------------------------------------- the two that name a third party */

test('a guest named to a host in an email goes through the switch', () => {
    const src = read('app/api/notify/route.ts');

    // The guest named TO the host, and the sender named TO the recipient. Both
    // are somebody else's name, so both take the honouring path.
    assert.ok(
        src.indexOf("otherFirstNameFor(admin, booking.guest_id, 'A guest')") !== -1,
        'the new-booking email no longer honours the switch when naming the guest'
    );
    assert.ok(
        src.indexOf("otherFirstNameFor(admin, uid, 'Someone')") !== -1,
        'the new-message email no longer honours the switch when naming the sender'
    );

    // And the honouring path has to actually read the column — selecting only
    // full_name would leave show_full_name undefined, which displayName reads
    // as "on". That is a silent failure, so it is asserted rather than assumed.
    const other = src.slice(src.indexOf('async function otherFirstNameFor'));
    assert.ok(
        other.slice(0, 600).indexOf('show_full_name') !== -1,
        'otherFirstNameFor does not select show_full_name, so the switch is invisible to it'
    );
});

test('greeting somebody by their own name does not consult the switch', () => {
    // Not an oversight. "Hi there" in your own email, to a named account, reads
    // as a site that has forgotten who you are — and your own name in your own
    // inbox discloses nothing.
    const src = read('app/api/notify/route.ts');
    assert.ok(src.indexOf("ownFirstNameFor(admin, booking.host_id, 'there')") !== -1);
    assert.ok(src.indexOf("ownFirstNameFor(admin, booking.guest_id, 'there')") !== -1);
    assert.ok(src.indexOf("ownFirstNameFor(admin, recipientId, 'there')") !== -1);
});

test('the name stored on an experience order is the masked one', () => {
    // This one is stored rather than looked up when it is read, so an
    // unhonoured value would outlive the setting that should have masked it —
    // and the reader is a third-party business, not a host.
    const src = read('app/api/stripe/webhook/route.ts');
    assert.ok(
        src.indexOf("guest_name: displayName(guest, '') || null") !== -1,
        'service_orders.guest_name is no longer written through displayName'
    );
    assert.ok(
        src.indexOf("'id, full_name, preferred_name, show_full_name, phone, email'") !== -1,
        'the guest lookup behind guest_name no longer selects show_full_name'
    );
});

/* ------------------------------------------------------------ the promises */

test('the account toggle still promises what the code does', () => {
    // If somebody softens this wording to "a shortened name", the code above
    // becomes a lie. The warning is only true while displayName returns the
    // bare fallback.
    const src = read('app/account/page.tsx');
    assert.ok(
        src.indexOf('Show my full legal name') !== -1,
        'the toggle has been renamed — check the privacy policy still matches'
    );
    assert.ok(
        src.indexOf('instead of a name') !== -1,
        'the amber warning no longer says other people see no name at all'
    );
});

test('the privacy policy says admins see the real name', () => {
    const src = read('app/privacy/page.tsx');
    assert.ok(
        src.indexOf('Show my full legal name') !== -1
        && src.indexOf('real name') !== -1,
        'the privacy policy no longer states that the directors see real names'
    );
});
