import test from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { orphanBookedTimes } = require('@/lib/providerSessions');

test('a confirmed booking with a matching seat row is NOT an orphan', () => {
    const sessions = [{ session_date: '2026-10-02', session_time: '16:00:00' }];
    const orders = [{ service_date: '2026-10-02', service_time: '16:00:00', item_unit: 'person', quantity: 2 }];
    assert.deepEqual(orphanBookedTimes(sessions, orders), []);
});

test('a confirmed booking whose session row is gone surfaces as an orphan', () => {
    const orders = [{ service_date: '2026-09-21', service_time: '16:00:00', item_unit: 'person', quantity: 2 }];
    assert.deepEqual(orphanBookedTimes([], orders), [
        { date: '2026-09-21', time: '16:00', seats: 2, private: false },
    ]);
});

test('orphan seats fold across orders sharing a time', () => {
    const orders = [
        { service_date: '2026-09-23', service_time: '16:00:00', item_unit: 'person', quantity: 4 },
        { service_date: '2026-09-23', service_time: '16:00:00', item_unit: 'person', quantity: 1 },
    ];
    assert.deepEqual(orphanBookedTimes([], orders), [
        { date: '2026-09-23', time: '16:00', seats: 5, private: false },
    ]);
});

test('a whole-session (non-multiplying) unit marks the orphan private', () => {
    const orders = [{ service_date: '2026-09-23', service_time: '10:00:00', item_unit: 'flat', quantity: 1 }];
    assert.equal(orphanBookedTimes([], orders)[0].private, true);
});

test('a request-shape order with no time is never an orphan session', () => {
    const orders = [{ service_date: '2026-09-23', service_time: null, item_unit: 'flat', quantity: 1 }];
    assert.deepEqual(orphanBookedTimes([], orders), []);
});
