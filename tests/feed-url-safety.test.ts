// Calendar-feed addresses are host-supplied and then fetched server-side, so they
// are an SSRF surface. The shared guard (lib/feedUrl + lib/feedFetch) must allow
// only public https and refuse anything pointing at localhost, private, link-local
// or cloud-metadata addresses — and refuse a redirect onto one too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const { feedUrlProblem, ipIsBlocked, hostnameIsBlocked } = require('@/lib/feedUrl');
const { fetchIcalText } = require('@/lib/feedFetch');

test('public https calendar links are allowed', () => {
    for (const u of [
        'https://calendar.google.com/calendar/ical/abc/basic.ics',
        'https://www.airbnb.co.uk/calendar/ical/12345.ics?s=token',
        'https://admin.booking.com/hotel/ical.html?t=xyz',
    ]) {
        assert.equal(feedUrlProblem(u), null, u);
    }
});

test('insecure, private, loopback, link-local and metadata addresses are refused', () => {
    const bad = [
        'http://calendar.google.com/x.ics',       // not https
        'ftp://example.com/x.ics',                // not https
        'https://localhost/x.ics',
        'https://foo.localhost/x.ics',
        'https://printer.local/x.ics',
        'https://127.0.0.1/x.ics',                // loopback
        'https://10.1.2.3/x.ics',                 // private
        'https://172.16.5.5/x.ics',               // private
        'https://192.168.0.1/x.ics',              // private
        'https://169.254.169.254/latest/meta',    // cloud metadata
        'https://100.64.1.1/x.ics',               // CGNAT
        'https://[::1]/x.ics',                     // IPv6 loopback
        'https://[fd00::1]/x.ics',                 // IPv6 unique-local
        'https://[fe80::1]/x.ics',                 // IPv6 link-local
        'not-a-url',
    ];
    for (const u of bad) assert.notEqual(feedUrlProblem(u), null, 'should refuse ' + u);
});

test('ipIsBlocked / hostnameIsBlocked cover the ranges directly', () => {
    for (const ip of ['127.0.0.1', '10.0.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '::1', 'fd00:ec2::254', 'fe80::1']) {
        assert.equal(ipIsBlocked(ip), true, ip);
    }
    for (const ip of ['8.8.8.8', '93.184.216.34', '1.1.1.1', '2606:4700:4700::1111']) {
        assert.equal(ipIsBlocked(ip), false, ip);
    }
    assert.equal(hostnameIsBlocked('localhost'), true);
    assert.equal(hostnameIsBlocked('calendar.google.com'), false);
});

test('fetchIcalText refuses a redirect that lands on a blocked address', async () => {
    const realFetch = globalThis.fetch;
    let hops = 0;
    (globalThis as any).fetch = async () => {
        hops++;
        // First (and only) hop 302s toward the metadata endpoint.
        return { status: 302, ok: false, headers: { get: (h: string) => (h.toLowerCase() === 'location' ? 'https://169.254.169.254/latest/meta-data/' : null) }, text: async () => '' };
    };
    try {
        const out = await fetchIcalText('https://93.184.216.34/cal.ics', { timeoutMs: 1000 });
        assert.equal(out, null, 'the redirect to metadata is refused');
        assert.equal(hops, 1, 'the blocked hop is never fetched — only the first request went out');
    } finally {
        (globalThis as any).fetch = realFetch;
    }
});

test('fetchIcalText returns the body on a clean public fetch', async () => {
    const realFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => ({ status: 200, ok: true, headers: { get: () => null }, text: async () => 'BEGIN:VCALENDAR' });
    try {
        assert.equal(await fetchIcalText('https://93.184.216.34/cal.ics', { timeoutMs: 1000 }), 'BEGIN:VCALENDAR');
    } finally {
        (globalThis as any).fetch = realFetch;
    }
});
