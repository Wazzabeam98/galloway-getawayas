// The experience card's availability hint is the next time only — "Next: Mon
// 10am" — with no "· 61 dates" count after it (Liam, 5 Oct 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();
const { nextSessionLabel } = require('@/components/marketplace/present');

test('the card shows the next time and no date count', () => {
    const p: any = {
        sessions: [
            { date: '2026-10-12', time: '14:00' },
            { date: '2026-10-12', time: '10:00' },
            { date: '2026-10-13', time: '10:00' },
            { date: '2026-10-20', time: '10:00' },
        ],
        declaredSessions: [],
    };
    assert.equal(nextSessionLabel(p), 'Next: Mon 10am');
});

test('a declared session earlier than the open hours is the next one', () => {
    const p: any = {
        sessions: [{ date: '2026-10-14', time: '09:00' }],
        declaredSessions: [{ date: '2026-10-13', time: '07:30' }],
    };
    assert.equal(nextSessionLabel(p), 'Next: Tue 7:30am');
});

test('nothing bookable shows nothing', () => {
    assert.equal(nextSessionLabel({ sessions: [], declaredSessions: [] } as any), '');
});
