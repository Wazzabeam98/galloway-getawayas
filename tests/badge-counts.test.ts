// One request for both menu numbers, and the archived rule in one place.
//
// WHAT THIS IS ABOUT. Three components take the two count hooks —
// MenuUnreadDot takes both, MessagesLink takes unread, BookingsLink takes
// pending — and each hook used to own an interval and a fetch. A signed-in
// host with the menu open ran four pollers for two numbers, every two
// minutes, before anything about auth changed. Once the routes started
// verifying the caller with getUser(), that became four round trips to the
// auth server as well.
//
// /api/badges answers both after one verification, and the hooks share one
// poller. The point of the tests below is that it stays that way: this is the
// kind of thing that regresses the next time somebody needs a number in a new
// component and reaches for a fetch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel: string) =>
    read(rel).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/* --------------------------------------------------- one fetch, one verify */

test('the badges route exists and verifies the caller once', () => {
    const body = code('app/api/badges/route.ts');
    assert.equal((body.match(/getUser\(\)/g) || []).length, 1,
        'one verification for both numbers is the entire point');
    assert.ok(!/getSession\(\)/.test(body));
    assert.match(body, /unreadFor/);
    assert.match(body, /pendingFor/);
});

test('the two counts are fetched in parallel', () => {
    // They touch different tables and neither needs the other's answer, so
    // the request should cost the slower of the two rather than the sum.
    assert.match(code('app/api/badges/route.ts'), /Promise\.all/);
});

test('no component fetches a count endpoint directly', () => {
    // The regression this guards: somebody needs a number in a new component
    // and adds a fetch, and the site is back to a poller per component.
    const offenders: string[] = [];
    const walk = (dir: string) => {
        for (const name of fs.readdirSync(path.join(ROOT, dir))) {
            const rel = dir + '/' + name;
            if (fs.statSync(path.join(ROOT, rel)).isDirectory()) { walk(rel); continue; }
            if (!/\.tsx?$/.test(name)) continue;
            if (rel === 'components/base/useBadgeCounts.ts') continue;
            const body = code(rel);
            if (/fetch\(['"`]\/api\/badges/.test(body)) {
                offenders.push(rel);
            }
        }
    };
    walk('components');
    walk('app');

    assert.deepEqual(offenders, [],
        'These fetch a count themselves instead of using useBadgeCounts:\n  '
        + offenders.join('\n  ')
        + '\n\nOne poller, shared. Four components each fetching is where this started.');
});

test('the hooks are wrappers over the shared poller, not pollers themselves', () => {
    for (const rel of ['components/base/useUnreadCount.ts', 'components/base/usePendingCount.ts']) {
        const body = code(rel);
        assert.ok(!/setInterval/.test(body), rel + ' owns an interval again');
        assert.ok(!/fetch\(/.test(body), rel + ' fetches again');
        assert.match(body, /useBadgeCounts/, rel + ' no longer uses the shared poller');
    }
});

test('the shared poller keeps one interval and one request in flight', () => {
    const body = code('components/base/useBadgeCounts.ts');
    // The call, not the `ReturnType<typeof setInterval>` on the timer
    // declaration — counting the bare name matches that too.
    assert.equal((body.match(/setInterval\(/g) || []).length, 1);
    assert.match(body, /inFlight/,
        'three components mounting together must not each fire the same fetch');
    assert.match(body, /listeners\.size === 0/,
        'the interval has to stop when the last subscriber goes, or it leaks');
});

test('the things that made the badge feel live are still there', () => {
    // Accepting a request is the one moment the badge is certainly wrong and
    // the host is looking straight at it; a tab left open all day comes back
    // stale. Both behaviours moved with the polling and are easy to lose in
    // a move.
    const body = code('components/base/useBadgeCounts.ts');
    assert.match(body, /BOOKINGS_CHANGED/);
    assert.match(body, /visibilitychange/);
});

test('BookingActions can still announce a change', () => {
    // It imports bookingsChanged from usePendingCount, which now re-exports
    // it. A move that quietly dropped the export would leave the badge stale
    // after an accept and nothing would fail.
    assert.match(code('components/base/usePendingCount.ts'), /bookingsChanged/);
    assert.match(code('components/BookingActions.tsx'), /bookingsChanged/);
});

/* ------------------------------------------- the rule that had no test */

test('the archived-conversation rule lives in one place', () => {
    // It was the body of the unread-count route, which is why it had no test —
    // a rule in a route handler is a rule nothing can reach. That route is
    // gone now; the rule is in lib/badgeCounts and /api/badges calls it.
    assert.match(code('app/api/badges/route.ts'), /unreadFor/);
    assert.match(code('lib/badgeCounts.ts'), /isArchived/,
        'the rule has left lib/badgeCounts — where did it go?');
    assert.ok(!/isArchived/.test(code('app/api/badges/route.ts')),
        'the route has grown its own copy of the rule');
});

// The test that used to sit here pinned /api/messages/unread-count and
// /api/bookings/pending-count alive "for one deploy", so a browser holding the
// pre-/api/badges bundle kept its badge working until it reloaded. That deploy
// has been out since 29 August; the routes are deleted and this went with them,
// deliberately, in the same commit — rather than being left to fail later and
// get patched by somebody who did not know why it was there.

