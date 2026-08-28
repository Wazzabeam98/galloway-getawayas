// Which edits need looking at again, and which do not.
//
// The rule this encodes: re-check what somebody chooses a provider on, not
// what the provider needs to keep accurate. Contact details and coverage are
// deliberately outside it — a stale phone number costs them work and there is
// nothing to judge, and friction on coverage makes people under-declare it.
//
// The digest is the trustworthy half. A provider writes their own row from the
// browser, so a flag the browser sets is one they could decline to set; the
// digest is written only by the admin route under the service role, so a
// mismatch cannot be suppressed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const {
    REVIEWABLE_FIELDS,
    reviewDigest,
    hasUnreviewedChanges,
    submitStatusPatch,
} = require('@/lib/serviceProviders');

const live = {
    status: 'approved',
    business_name: 'Solway Sparkle',
    trade: 'sponge',
    description: 'Changeover cleans and deep cleans for holiday cottages across the Stewartry.',
    audience: 'host',
    photos: ['providers/a.jpg', 'providers/b.jpg'],
    contact_email: 'hello@solwaysparkle.test',
    contact_phone: '01557 000000',
};

const approved = (p: any) => ({ ...p, approved_digest: reviewDigest(p) });

test('the reviewable fields are the shop window, and nothing else', () => {
    assert.deepEqual(
        [...REVIEWABLE_FIELDS].sort(),
        [
            'audience', 'business_name', 'description',
            // Turning one of these on after approval is a new claim about work
            // the law restricts, so it comes back round rather than appearing
            // quietly. The numbers themselves are not in here: they live in
            // their own table with a stronger check, where editing one
            // un-verifies it in the same statement.
            'does_gas', 'does_oil',
            'logo', 'photos', 'trade',
        ]
    );
});

test('a live plumber who starts claiming gas work comes back round', () => {
    const plumber = approved({ ...live, trade: 'plumber', does_gas: false, does_oil: false });

    assert.equal(hasUnreviewedChanges(plumber), false, 'nothing has changed yet');
    assert.equal(
        hasUnreviewedChanges({ ...plumber, does_gas: true }),
        true,
        'saying you do gas work is not a quiet edit'
    );
});

test('an untouched provider has nothing outstanding', () => {
    assert.equal(hasUnreviewedChanges(approved(live)), false);
});

// The whole point: these five put them in the queue but leave them live.

for (const [field, changed] of [
    ['business_name', 'Solway Sparkle Ltd'],
    ['trade', 'chef'],
    ['description', 'Actually we do wedding catering now, across the whole region.'],
    ['audience', 'guest'],
] as Array<[string, string]>) {
    test('changing ' + field + ' needs looking at again', () => {
        const before = approved(live);
        const after = { ...before, [field]: changed };
        assert.equal(hasUnreviewedChanges(after), true);
    });
}

test('adding a photo needs looking at again', () => {
    const before = approved(live);
    const after = { ...before, photos: [...live.photos, 'providers/c.jpg'] };
    assert.equal(hasUnreviewedChanges(after), true);
});

test('removing a photo needs looking at again', () => {
    const before = approved(live);
    const after = { ...before, photos: ['providers/a.jpg'] };
    assert.equal(hasUnreviewedChanges(after), true);
});

// And these do not. This is the half that keeps an honest provider live.

test('fixing a typo in the phone number does not take them off the site', () => {
    const before = approved(live);
    const after = { ...before, contact_phone: '01557 111111' };
    assert.equal(hasUnreviewedChanges(after), false);
});

test('changing the contact email does not take them off the site', () => {
    const before = approved(live);
    const after = { ...before, contact_email: 'jobs@solwaysparkle.test' };
    assert.equal(hasUnreviewedChanges(after), false,
        'they need this accurate to get work — waiting 48 hours for it is a punishment');
});

test('coverage is theirs to change, and does not queue them', () => {
    // Coverage lives in service_areas, so it is not in the digest at all —
    // asserted here because it is a decision, not an oversight.
    const before = approved(live);
    assert.equal(REVIEWABLE_FIELDS.indexOf('areas'), -1);
    assert.equal(hasUnreviewedChanges({ ...before }), false);
});

// Details of the fingerprint itself.

test('whitespace either side of a description is not a change', () => {
    const before = approved(live);
    const after = { ...before, description: '  ' + live.description + '\n' };
    assert.equal(hasUnreviewedChanges(after), false,
        'nobody needs to review a trailing newline');
});

test('the same photos in a different order are not a change', () => {
    const before = approved(live);
    const after = { ...before, photos: ['providers/b.jpg', 'providers/a.jpg'] };
    assert.equal(hasUnreviewedChanges(after), false,
        'the order they come back in is not something the provider chose');
});

test('a description that differs only mid-string is still caught', () => {
    const before = approved(live);
    const after = { ...before, description: live.description.replace('cleans', 'cleanz') };
    assert.equal(hasUnreviewedChanges(after), true);
});

// State guards.

test('a provider who is not live is never "changed"', () => {
    const pending = { ...approved(live), status: 'pending_review', description: 'something else' };
    assert.equal(hasUnreviewedChanges(pending), false,
        'a pending row is already in the queue on its own account');
});

test('an approval from before the digest existed is trusted', () => {
    const legacy = { ...live, status: 'approved', approved_digest: null };
    assert.equal(hasUnreviewedChanges(legacy), false,
        'no baseline means no way to tell, and flagging everything would be noise');
});


// ---------------------------------------------------------------------------
// What pressing the button does, depending on where they already are.
//
// This is the rule the whole changes model exists for. It lived inside the
// sign-up page until a mutation putting the old destructive behaviour back was
// caught by no test at all — so it lives here now.
// ---------------------------------------------------------------------------

const WHEN = new Date('2026-08-25T10:00:00.000Z');

test('a live provider saving changes is not knocked back into the queue', () => {
    const patch = submitStatusPatch('approved', WHEN);

    assert.deepEqual(patch, {},
        'this is the bug: editing a description took a live business off the site');
});

test('a first application goes into the queue', () => {
    const patch = submitStatusPatch('draft', WHEN);

    assert.equal(patch.status, 'pending_review');
    assert.equal(patch.submitted_at, WHEN.toISOString());
    assert.equal(patch.review_note, null);

    // There IS a trial again — 90 free days on the subscription plan — and
    // this assertion matters more than it did when there was not one. The
    // clock starts at approval, in the same write that puts them live and the
    // email that gives them the date. A submission is somebody joining a
    // queue: it must not quietly eat a free period while they wait to be
    // looked at. See tests/service-provider-decision.test.ts for the other
    // half of this, where the stamping actually happens.
    assert.equal('trial_ends_at' in patch, false, 'the queue does not start the clock');
    assert.equal('plan' in patch, false, 'and nothing is agreed before it is approved');
});

test('sending it back after a decline queues them and clears the old reason', () => {
    const patch = submitStatusPatch('declined', WHEN);

    assert.equal(patch.status, 'pending_review');
    assert.equal(patch.review_note, null, 'the reason they fixed should not still be on screen');
});

test('a hidden provider sending it back goes into the queue', () => {
    const patch = submitStatusPatch('hidden', WHEN);
    assert.equal(patch.status, 'pending_review');
});

// ---------------------------------------------------------------------------
// WHY A LISTING IS IN THE QUEUE
//
// The admin page used to be three independent filters written out inline, and
// a fourth reason could be added to the model without any of them noticing —
// the row simply never appeared and the first anybody heard of it was a
// provider asking why their tag never went live. Same shape as canBeBooked
// reading "not priced by the hour" instead of "not maintenance": the page
// asserted the reasons that existed rather than the rule.
//
// So the reasons are a list, and this loops it. A fifth reason added to
// ATTENTION_REASONS without a case here fails the last test in this file,
// which is the point of writing it that way.
// ---------------------------------------------------------------------------

const {
    needsAttention,
    ATTENTION_REASONS,
    attentionLabel,
} = require('@/lib/serviceProviders');

const gasSkill = { id: 's1', label: 'Boiler repair', regulated_concept: 'gas' };
const plainSkill = { id: 's2', label: 'Bricklaying', regulated_concept: null };

const verifiedGas = {
    scheme: 'gas_safe',
    number: '123456',
    verified_at: '2026-08-01T00:00:00.000Z',
    verified_number: '123456',
};

test('a settled live listing wants nothing from anybody', () => {
    const settled = approved({ ...live, trade: 'plumber' });
    assert.deepEqual(needsAttention(settled, [], []), []);
});

test('an application waiting for a decision', () => {
    assert.deepEqual(
        needsAttention({ ...live, status: 'pending_review' }, [], []),
        ['application']
    );
});

test('a live listing that has been edited', () => {
    const edited = { ...approved(live), description: 'Something else entirely, at length.' };
    assert.deepEqual(needsAttention(edited, [], []), ['changes']);
});

test('a registration nobody has checked', () => {
    const plumber = approved({ ...live, trade: 'plumber', does_gas: true });
    const reasons = needsAttention(plumber, [{ scheme: 'gas_safe', number: '123456' }], []);
    assert.deepEqual(reasons, ['registration']);
});

test('a skill claiming work they have not proved they may do', () => {
    const handyman = approved({ ...live, trade: 'handyman' });
    assert.deepEqual(needsAttention(handyman, [], [gasSkill]), ['skills']);
});

test('an ordinary skill is not a reason to look at anybody', () => {
    const handyman = approved({ ...live, trade: 'handyman' });
    assert.deepEqual(needsAttention(handyman, [], [plainSkill]), []);
});

test('a regulated skill with a checked number behind it is settled', () => {
    const plumber = approved({ ...live, trade: 'plumber', does_gas: true });
    assert.deepEqual(needsAttention(plumber, [verifiedGas], [gasSkill]), []);
});

test('several reasons at once are all reported, not just the first', () => {
    // The queue counts each reason separately, so one row can be in more than
    // one count — and a listing waiting on a decision AND carrying an
    // unchecked number is two jobs, not one.
    const plumber = { ...live, status: 'pending_review', trade: 'plumber', does_gas: true };
    const reasons = needsAttention(plumber, [{ scheme: 'gas_safe', number: '123456' }], [gasSkill]);

    assert.equal(reasons.indexOf('application') !== -1, true);
    assert.equal(reasons.indexOf('registration') !== -1, true);
    assert.equal(reasons.indexOf('skills') !== -1, true);
});

test('nothing at all is not a reason', () => {
    assert.deepEqual(needsAttention(null, [], []), []);
    assert.deepEqual(needsAttention(undefined, null, null), []);
});

// The guard. Add a reason to ATTENTION_REASONS and this fails until there is a
// case above that produces it — which is the difference between a queue that
// grows with the model and one that quietly stops being complete.
test('every reason in the list can actually be produced', () => {
    const produced: string[] = [];

    const cases = [
        needsAttention({ ...live, status: 'pending_review' }, [], []),
        needsAttention({ ...approved(live), description: 'Something else entirely, at length.' }, [], []),
        needsAttention(approved({ ...live, trade: 'plumber', does_gas: true }),
            [{ scheme: 'gas_safe', number: '123456' }], []),
        needsAttention(approved({ ...live, trade: 'handyman' }), [], [gasSkill]),
    ];

    for (const reasons of cases) {
        for (const reason of reasons) {
            if (produced.indexOf(reason) === -1) produced.push(reason);
        }
    }

    for (const reason of ATTENTION_REASONS) {
        assert.equal(produced.indexOf(reason) !== -1, true,
            reason + ' is in ATTENTION_REASONS but nothing here produces it — '
            + 'add a case, and check the admin queue actually shows it');
    }
});

test('every reason reads as something in the summary line', () => {
    for (const reason of ATTENTION_REASONS) {
        const label = attentionLabel(reason);
        assert.equal(typeof label === 'string' && label.length > 0, true, reason + ' has words');
        assert.notEqual(label, reason, reason + ' is not shown to a human as its own key');
    }
});
