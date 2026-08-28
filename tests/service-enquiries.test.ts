// The rules an enquiry runs on.
//
// Everything here is a pure function over a row, so none of it needs a
// database. What it is pinning is the handful of decisions that would be
// expensive to get wrong quietly:
//
//   * silence means two OPPOSITE things, and which one is decided in one place
//   * an emergency is a short wait rather than no wait, which is a reversal of
//     what this flow shipped with
//   * a requested date must never read as a booked one
//
// The emails, the token round trip and the RLS grants are still uncovered —
// see the walk-through notes. This is the pure half.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

import {
    ENQUIRY_STATUSES,
    EMERGENCY_MINUTES,
    URGENCY_LEVELS,
    contactReleased,
    isOpen,
    canRespond,
    canWithdraw,
    expiresAt,
    hasExpired,
    dueOutcome,
    releasesOnSilence,
    needsDate,
    requestedWhen,
    enquiryProblems,
    enquiryReference,
    offersEmergency,
    priceSnapshot,
    snapshotLine,
    hostStatusSummary,
} from '@/lib/serviceEnquiries';

import { townForLocation, pointForListing } from '@/lib/serviceProviders';

// --- silence, and its two endings ------------------------------------------

// The single most expensive thing to get backwards in this flow. One ending
// tells a host to try somebody else; the other hands out a tradesman's phone
// number. Reversed, it either strands somebody mid-emergency or gives away a
// number because a quote went quiet.
test('silence releases a number on an emergency and gives up on everything else', () => {
    const past = new Date(Date.now() - 60_000).toISOString();

    assert.equal(
        dueOutcome({ status: 'sent', urgency: 'emergency', expires_at: past }),
        'released'
    );
    assert.equal(
        dueOutcome({ status: 'viewed', urgency: 'soon', expires_at: past }),
        'expired'
    );
    assert.equal(
        dueOutcome({ status: 'sent', urgency: 'planned', expires_at: past }),
        'expired'
    );

    // Only emergencies. If a fourth urgency is ever added it defaults to the
    // safe ending — giving up — rather than to handing out a number.
    assert.equal(releasesOnSilence('emergency'), true);
    assert.equal(releasesOnSilence('soon'), false);
    assert.equal(releasesOnSilence('planned'), false);
    assert.equal(releasesOnSilence('whatever'), false);
});

test('nothing is due before its time, or after it has been answered', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();

    assert.equal(dueOutcome({ status: 'sent', urgency: 'emergency', expires_at: future }), null);

    // An answered row is never swept, whatever the clock says. The sweep also
    // guards its update on the status it read, but this is the first line.
    for (const status of ['accepted', 'declined', 'withdrawn', 'released', 'expired']) {
        assert.equal(
            dueOutcome({ status, urgency: 'emergency', expires_at: past }),
            null,
            status + ' is not swept again'
        );
    }
});

// --- the emergency reversal ------------------------------------------------

// This flow shipped handing the number over on the spot, with no accept at
// all. That was reversed because an introduction nobody accepted is not
// evidence the platform found anybody work — and that evidence is the entire
// argument for the subscription these trades are about to start paying.
//
// So: an emergency HAS a deadline. A version of this where emergencies do not
// expire is the old behaviour wearing a new name.
test('an emergency waits, briefly, rather than not at all', () => {
    const sent = new Date('2026-09-01T21:00:00Z');

    const emergency = expiresAt('emergency', sent);
    assert.ok(emergency, 'an emergency has a deadline');
    assert.equal(
        new Date(emergency).getTime() - sent.getTime(),
        EMERGENCY_MINUTES * 60 * 1000
    );

    // Minutes, not days. If somebody "tidies" this into hours the host waits
    // through the flood.
    assert.ok(EMERGENCY_MINUTES <= 30, 'a burst pipe cannot wait half an hour');
    assert.ok(EMERGENCY_MINUTES >= 10, 'shorter than this and the accept never happens');

    // And it is much shorter than the others, which is the whole point.
    for (const level of URGENCY_LEVELS) {
        if (level.key === 'emergency') continue;
        assert.ok(
            level.minutes > EMERGENCY_MINUTES,
            level.key + ' waits longer than an emergency'
        );
    }
});

test("'direct' is gone — a number is never handed over unasked", () => {
    // The status that meant "the number went across and nobody was ever
    // asked". Its absence is the reversal, so it is asserted rather than
    // assumed.
    assert.equal((ENQUIRY_STATUSES as readonly string[]).indexOf('direct'), -1);
    assert.ok((ENQUIRY_STATUSES as readonly string[]).indexOf('released') !== -1);
});

test('details are out only once somebody accepted, or the clock released them', () => {
    assert.equal(contactReleased('accepted'), true);
    assert.equal(contactReleased('released'), true);

    for (const status of ['sent', 'viewed', 'declined', 'expired', 'withdrawn']) {
        assert.equal(contactReleased(status), false, status + ' shows no phone number');
    }
});

test('an open enquiry can be answered and withdrawn, a settled one cannot', () => {
    for (const status of ['sent', 'viewed']) {
        assert.equal(isOpen(status), true);
        assert.equal(canRespond(status), true);
        assert.equal(canWithdraw(status), true);
    }

    // Including 'released'. A tradesman answering after the number went across
    // would be accepting something the host has already rung him about.
    for (const status of ['accepted', 'declined', 'expired', 'withdrawn', 'released']) {
        assert.equal(canRespond(status), false, status + ' cannot be answered');
    }
});

// --- a request, not a booking ----------------------------------------------

// There is no capacity model. Nothing knows whether he is free, nothing holds
// the window, and four hosts can ask for the same one. The words are the only
// thing keeping that honest, so the words are pinned.
test('a requested date always reads as asked for, never as booked', () => {
    const line = requestedWhen({
        preferred_date: '2026-09-03',
        window_from: '11:00',
        window_to: '15:00',
    });

    assert.ok(line);
    assert.ok(line!.startsWith('Asked for'), 'it is a request: ' + line);
    assert.ok(/thursday/i.test(line!), 'names the day: ' + line);
    assert.ok(line!.indexOf('11am') !== -1 && line!.indexOf('3pm') !== -1, line!);

    for (const word of ['Booked', 'Confirmed', 'Scheduled', 'Appointment']) {
        assert.equal(line!.indexOf(word), -1, 'must not say ' + word);
    }
});

test('no window is a real answer, and no date says nothing at all', () => {
    const anyTime = requestedWhen({ preferred_date: '2026-09-03' });
    assert.ok(anyTime && anyTime.indexOf('any time that day') !== -1, String(anyTime));

    // Null rather than "Asked for" with nothing after it, which reads like
    // something failed to load.
    assert.equal(requestedWhen({}), null);
    assert.equal(requestedWhen({ preferred_date: 'not a date' }), null);
});

test('only planned work is made to name a day', () => {
    assert.equal(needsDate('planned'), true);
    assert.equal(needsDate('soon'), false, 'no date in mind is a real answer');
    assert.equal(needsDate('emergency'), false, 'it is happening now');
});

// --- what has to be filled in ----------------------------------------------

const draft = (over: any = {}) => ({
    trade: 'plumber',
    provider_id: 'p-1',
    urgency: 'soon',
    summary: 'No hot water since Sunday, combi boiler.',
    host_name: 'Liam',
    host_phone: '07700 900000',
    ...over,
});

test('a complete enquiry has no problems', () => {
    assert.deepEqual(enquiryProblems(draft()), []);
});

test('planned work without a day is refused, soon without one is not', () => {
    const problems = enquiryProblems(draft({ urgency: 'planned' }));
    assert.equal(problems.filter((p) => p.field === 'preferred_date').length, 1);

    assert.deepEqual(
        enquiryProblems(draft({ urgency: 'planned', preferred_date: '2026-09-03' })),
        []
    );
    assert.deepEqual(enquiryProblems(draft({ urgency: 'soon' })), []);
});

test('half a window, or a backwards one, is a typo rather than a preference', () => {
    const half = enquiryProblems(draft({ window_from: '11:00' }));
    assert.equal(half.filter((p) => p.field === 'window_to').length, 1);

    const backwards = enquiryProblems(draft({ window_from: '15:00', window_to: '11:00' }));
    assert.equal(backwards.filter((p) => p.field === 'window_to').length, 1);

    assert.deepEqual(enquiryProblems(draft({ window_from: '11:00', window_to: '15:00' })), []);
});

test('a trade that is not in the shop cannot be enquired about through the form either', () => {
    const problems = enquiryProblems(draft({ trade: 'sponge' }));
    assert.equal(problems.filter((p) => p.field === 'trade').length, 1);
});

test('a summary of two words is not a call-out worth making', () => {
    assert.equal(
        enquiryProblems(draft({ summary: 'broken' })).filter((p) => p.field === 'summary').length,
        1
    );
});

// --- every problem, not the first one --------------------------------------

// Reported from a walk-through as "I submitted with both blank and it only
// asked for the number". The validation was right — the REPORTING showed
// problems[0], and the phone happens to be checked before the name. So the
// host filled in a number, pressed send, and was then asked for something
// else. Two round trips for one mistake, and it reads as the form not knowing
// its own mind.
//
// The fix is in the form, which now renders all of them. This pins the half
// that lives here: both problems must actually be in the list.
test('a blank name and a blank phone are two problems, not one', () => {
    const problems = enquiryProblems(draft({ host_name: '', host_phone: '' }));

    assert.equal(problems.filter((p) => p.field === 'host_name').length, 1, 'the name is asked for');
    assert.equal(problems.filter((p) => p.field === 'host_phone').length, 1, 'the number is asked for');
    assert.ok(problems.length >= 2, 'both are reported at once');
});

test('an emergency asks for a name like everything else', () => {
    // Nothing about urgency relaxes who you are. He is being sent to a
    // property to meet somebody.
    const problems = enquiryProblems(draft({ urgency: 'emergency', host_name: '' }));
    assert.equal(problems.filter((p) => p.field === 'host_name').length, 1);
});

// --- who can be asked in an emergency --------------------------------------

test('a provider with no number cannot be the answer to an emergency', () => {
    // Whatever he ticked. The number IS the mechanism.
    assert.equal(offersEmergency({ contact_phone: '' }, ['plumb_out_of_hours']), false);
    assert.equal(offersEmergency({ contact_phone: '01557 555 0117' }, ['plumb_out_of_hours']), true);
    assert.equal(offersEmergency({ contact_phone: '01557 555 0117' }, ['plumb_same_day']), true);

    // The tick is the consent, and it is his. Somebody who only listed the
    // faults he handles has not agreed to be rung at nine at night.
    assert.equal(offersEmergency({ contact_phone: '01557 555 0117' }, ['plumb_leak']), false);
    assert.equal(offersEmergency({ contact_phone: '01557 555 0117' }, []), false);
});

// --- prices are shown, never computed --------------------------------------

test('a published price is quoted back, and an unpublished one renders as nothing', () => {
    const shown = snapshotLine(priceSnapshot(
        { trade: 'plumber', callout_fee: 45, hourly_rate: 55, callout_waived: true }
    ));
    assert.ok(shown && shown.indexOf('£45 call-out, waived if you go ahead') !== -1, String(shown));
    assert.ok(shown!.indexOf('£55 an hour') !== -1, String(shown));

    // Null, not "£0". A roofer who quotes after a look has published nothing,
    // and nothing is the honest thing to show.
    assert.equal(snapshotLine(priceSnapshot({ trade: 'roofer' })), null);
    assert.equal(snapshotLine(priceSnapshot({ trade: 'roofer', callout_fee: 0 })), null);
});

// --- the reference ---------------------------------------------------------

test('a reference can be read down a phone', () => {
    let n = 0;
    const ref = enquiryReference(() => { n += 0.37; return n % 1; });

    assert.match(ref, /^GG-[A-Z0-9]{4}$/);

    // No I, O, 0 or 1 — this gets read aloud and written on the back of a hand.
    for (const bad of ['I', 'O', '0', '1']) {
        assert.equal(ref.slice(3).indexOf(bad), -1, 'reference must not contain ' + bad);
    }
});

// --- where we search from --------------------------------------------------

// A host has already told us where their cottages are. These are the two ways
// of reading that answer, and the fallback when neither works.
test('a listing says where to search from, coordinates first', () => {
    const exact = pointForListing({
        latitude: 54.8362,
        longitude: -4.0530,
        location: '18 Dovecroft, Kirkcudbright, Dumfries and Galloway',
    });
    assert.equal(exact!.from, 'coordinates');
    assert.equal(exact!.lat, 54.8362);
    assert.equal(exact!.label, 'Kirkcudbright');

    // Nullable columns, and plenty of listings predate them.
    const byTown = pointForListing({
        latitude: null,
        longitude: null,
        location: '2 Market Street, Castle Douglas, Dumfries and Galloway',
    });
    assert.equal(byTown!.from, 'town');
    assert.equal(byTown!.label, 'Castle Douglas');

    // Neither answers — the picker comes back, which is a fallback rather
    // than a failure.
    assert.equal(pointForListing({ location: 'Somewhere in France' }), null);
    assert.equal(pointForListing(null), null);
});

test('a town is matched however it was typed, and wherever it sits', () => {
    // townKey strips everything but letters, so the hyphen in the coverage
    // key never has to line up with the spelling on a listing.
    assert.equal(townForLocation('Castle Douglas')!.key, 'castle-douglas');
    assert.equal(townForLocation('castle douglas,')!.key, 'castle-douglas');
    assert.equal(
        townForLocation('18 Dovecroft, Kirkcudbright, Dumfries and Galloway')!.key,
        'kirkcudbright'
    );

    // THE ONE THAT WAS BROKEN. lib/places strips a leading part only when it
    // looks like a street, meaning it starts with a number — so a house NAME
    // left "Anchorlee" as the town and matched nothing. Houses named rather
    // than numbered are the ordinary case across Dumfries and Galloway, so
    // this was a large share of real listings being sent to a picker they
    // should never have seen.
    assert.equal(
        townForLocation('Anchorlee, Gatehouse of Fleet, Dumfries and Galloway')!.key,
        'gatehouse-of-fleet'
    );

    assert.equal(townForLocation('Manchester'), null);
    assert.equal(townForLocation(''), null);
});

// --- what the host is told -------------------------------------------------

// THE RELEASE IS NEVER ADVERTISED BEFORE IT HAPPENS.
//
// It was, briefly — on the urgency picker, the send button, the sent screen,
// the host's status line and two emails — and that undoes the reason it
// exists. A host told "pick emergency and you get the number in twenty
// minutes" has been handed a way to skip the tradesman: everybody picks
// emergency, everybody waits it out, nobody accepts, and the accept is the
// only evidence that survives to justify the subscription.
//
// The words are allowed once it HAS happened. This pins the before.
test('nothing offers a host the number while they are still waiting', () => {
    for (const status of ['sent', 'viewed']) {
        const waiting = hostStatusSummary(status, 'Baxter Plumbing', {
            urgency: 'emergency',
            expires_at: '2026-09-01T21:20:00Z',
        });

        for (const leak of ['number', 'minute', '21:', 'ring them']) {
            assert.equal(
                waiting.detail.toLowerCase().indexOf(leak.toLowerCase()),
                -1,
                'a waiting emergency must not mention "' + leak + '": ' + waiting.detail
            );
        }
    }

    // The urgency picker is the other place it leaked, and the most tempting
    // one to write it back into.
    const emergency = URGENCY_LEVELS.filter((u) => u.key === 'emergency')[0];
    for (const leak of ['minute', 'their number', 'we give you']) {
        assert.equal(
            emergency.hint.toLowerCase().indexOf(leak),
            -1,
            'the emergency hint must not mention "' + leak + '": ' + emergency.hint
        );
    }
});

test('no waiting status implies somebody is on the way', () => {
    // With one tradesman and no fan-out, silence is the likeliest way this
    // fails. A screen that implies somebody is coming is how a host finds that
    // out on the worst possible morning.
    for (const status of ['sent', 'viewed']) {
        for (const urgency of ['emergency', 'soon', 'planned']) {
            const summary = hostStatusSummary(status, 'Baxter Plumbing', { urgency });
            for (const phrase of ['on their way', 'coming', 'booked', 'confirmed']) {
                assert.equal(
                    summary.detail.toLowerCase().indexOf(phrase),
                    -1,
                    status + '/' + urgency + ' must not say "' + phrase + '"'
                );
            }
        }
    }
});

// The release itself still says everything, because by then it is a fact
// rather than an offer.
test('a released enquiry hands the number over in plain words', () => {
    const released = hostStatusSummary('released', 'Baxter Plumbing');
    assert.ok(/number/i.test(released.detail), released.detail);
    assert.ok(/ring/i.test(released.detail), released.detail);
});

test('every status says something', () => {
    for (const status of ENQUIRY_STATUSES) {
        const summary = hostStatusSummary(status, 'Baxter Plumbing');
        assert.ok(summary.label, status + ' has a label');
        assert.ok(summary.detail, status + ' has a detail line');
    }
});
