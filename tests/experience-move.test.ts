import test from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

// experienceMove pulls in lib/email, which imports siblings via the '@/' alias;
// install the runtime resolver before that import is evaluated.
installAliases();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { whenLabel, moveProviderEmail } = require('@/lib/experienceMove');

// whenLabel is presentation only — the RPC already hands back a YYYY-MM-DD date
// and an HH:MM time.
test('whenLabel joins a date and time, and degrades gracefully', () => {
    assert.equal(whenLabel('2026-10-05', '14:00'), '2026-10-05 at 14:00');
    assert.equal(whenLabel('2026-10-05', '14:00:00'), '2026-10-05 at 14:00', 'trims seconds');
    assert.equal(whenLabel('2026-10-05', null), '2026-10-05', 'a date with no time is just the date');
    assert.equal(whenLabel(null, '14:00'), 'the booked time', 'no date is unusable');
});

// The whole point of the provider notice is the CHANGE, so both the old and the
// new time must be named — in the subject and in the body.
test('the provider move email names BOTH the old and the new time', () => {
    const mail = moveProviderEmail({
        business: 'Loch Sauna',
        itemName: 'Evening sauna session',
        fromDate: '2026-10-05', fromTime: '18:00',
        toDate: '2026-10-12', toTime: '20:00',
        seats: 2,
    });

    // Subject carries the change.
    assert.match(mail.subject, /2026-10-05 at 18:00/);
    assert.match(mail.subject, /2026-10-12 at 20:00/);

    // Body names both, labelled Was / Now, and the item and party size.
    assert.match(mail.html, /2026-10-05 at 18:00/, 'old time in body');
    assert.match(mail.html, /2026-10-12 at 20:00/, 'new time in body');
    assert.match(mail.html, /Was/);
    assert.match(mail.html, /Now/);
    assert.match(mail.html, /Evening sauna session/);
    assert.match(mail.html, /2 places/);
});

test('a single-place move reads "1 place", not "1 places"', () => {
    const mail = moveProviderEmail({
        business: 'Loch Sauna', itemName: 'Private hour',
        fromDate: '2026-10-05', fromTime: '18:00',
        toDate: '2026-10-06', toTime: '18:00',
        seats: 1,
    });
    assert.match(mail.html, /1 place\b/);
    assert.doesNotMatch(mail.html, /1 places/);
});
