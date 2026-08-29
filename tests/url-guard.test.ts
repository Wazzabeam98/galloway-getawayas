// What the server may be talked into fetching.
//
// /api/import-listing takes a link from the caller and fetches it server-side,
// so whatever our server can reach, the caller can reach through us. The
// allowlist was `hostname.includes('airbnb.')`, which `airbnb.evil.com`
// satisfies — register that, point its DNS at the cloud metadata service, and
// the server fetches it and hands the contents back.
//
// The substring cases below are the actual exploit. Everything else is there
// because an allowlist is the kind of rule that looks obviously right, and the
// only way to know it is right is to write down what it must refuse.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

/* eslint-disable @typescript-eslint/no-var-requires */
const {
    isAllowedImportHost,
    isPrivateAddress,
    checkImportUrl,
    ALLOWED_IMPORT_DOMAINS,
} = require('@/lib/urlGuard');

// A stand-in for DNS, so these tests never touch the network.
const resolves = (...addresses: { address: string; family: number }[]) =>
    async () => addresses;
const publicV4 = resolves({ address: '151.101.1.140', family: 4 });

/* ------------------------------------------------- the hole that was here */

test('the substring bypasses are refused', () => {
    // Every one of these passed the old `.includes()` check.
    assert.equal(isAllowedImportHost('airbnb.evil.com'), false);
    assert.equal(isAllowedImportHost('booking.com.evil.com'), false);
    assert.equal(isAllowedImportHost('my-booking.com-notreally.example'), false);
    assert.equal(isAllowedImportHost('notairbnb.com'), false);
    assert.equal(isAllowedImportHost('airbnb.com.attacker.net'), false);
});

test('the real thing is still allowed', () => {
    assert.equal(isAllowedImportHost('airbnb.com'), true);
    assert.equal(isAllowedImportHost('www.airbnb.com'), true);
    assert.equal(isAllowedImportHost('www.airbnb.co.uk'), true);
    assert.equal(isAllowedImportHost('booking.com'), true);
    assert.equal(isAllowedImportHost('www.booking.com'), true);
});

test('case and a trailing dot do not get you past it', () => {
    // "WWW.AIRBNB.EVIL.COM." is a valid hostname and resolves the same as the
    // lower-case version, so the check has to normalise before comparing.
    assert.equal(isAllowedImportHost('WWW.AIRBNB.COM'), true);
    assert.equal(isAllowedImportHost('www.airbnb.com.'), true);
    assert.equal(isAllowedImportHost('AIRBNB.EVIL.COM'), false);
});

test('nothing is allowed by default', () => {
    assert.equal(isAllowedImportHost(''), false);
    assert.equal(isAllowedImportHost(null as any), false);
    assert.equal(isAllowedImportHost('localhost'), false);
    assert.equal(isAllowedImportHost('169.254.169.254'), false);
});

/* --------------------------------------------------------- the addresses */

test('the cloud metadata address is private', () => {
    // The one that matters most: 169.254.169.254 is where AWS, GCP and Azure
    // hand out instance credentials to anything that asks from inside.
    assert.equal(isPrivateAddress('169.254.169.254', 4), true);
});

test('the usual private ranges are private', () => {
    for (const ip of [
        '10.0.0.1', '127.0.0.1', '172.16.0.1', '172.31.255.255',
        '192.168.1.1', '0.0.0.0', '100.64.0.1', '198.18.0.1', '224.0.0.1',
    ]) {
        assert.equal(isPrivateAddress(ip, 4), true, ip + ' should be private');
    }
});

test('ordinary public addresses are not', () => {
    for (const ip of ['151.101.1.140', '8.8.8.8', '172.15.0.1', '172.32.0.1', '1.1.1.1']) {
        assert.equal(isPrivateAddress(ip, 4), false, ip + ' should be public');
    }
});

test('an IPv4 address wearing an IPv6 hat is still caught', () => {
    // ::ffff:169.254.169.254 is the same destination. A v4-only blocklist
    // walks straight past it.
    assert.equal(isPrivateAddress('::ffff:169.254.169.254', 6), true);
    assert.equal(isPrivateAddress('::ffff:127.0.0.1', 6), true);
    assert.equal(isPrivateAddress('::ffff:8.8.8.8', 6), false);
});

test('IPv6 loopback, link-local and unique-local are private', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'fd00::1', 'fc00::1', 'ff02::1']) {
        assert.equal(isPrivateAddress(ip, 6), true, ip + ' should be private');
    }
    assert.equal(isPrivateAddress('2606:4700::1111', 6), false);
});

test('an address that will not parse is refused, not allowed', () => {
    // Fail closed. "Not provably public" and "public" must not be the same
    // answer.
    assert.equal(isPrivateAddress('not-an-ip', 4), true);
    assert.equal(isPrivateAddress('999.1.1.1', 4), true);
});

/* ------------------------------------------------------- the whole check */

test('a normal Airbnb link passes', async () => {
    const v = await checkImportUrl('https://www.airbnb.co.uk/rooms/12345', publicV4);
    assert.equal(v.ok, true);
});

test('http is refused even on an allowed host', async () => {
    const v = await checkImportUrl('http://www.airbnb.co.uk/rooms/1', publicV4);
    assert.equal(v.ok, false);
    assert.match(v.reason, /https/);
});

test('a non-http scheme is refused', async () => {
    for (const url of ['file:///etc/passwd', 'gopher://airbnb.com/', 'ftp://booking.com/']) {
        const v = await checkImportUrl(url, publicV4);
        assert.equal(v.ok, false, url + ' should be refused');
    }
});

test('the exploit is refused end to end', async () => {
    // The attacker's domain, resolving to cloud metadata. Refused at the
    // domain gate, before DNS is even consulted.
    let asked = false;
    const v = await checkImportUrl('https://airbnb.evil.com/x', async () => {
        asked = true;
        return [{ address: '169.254.169.254', family: 4 }];
    });
    assert.equal(v.ok, false);
    assert.equal(asked, false, 'refused on the name alone — no lookup needed');
});

test('an allowed host that resolves somewhere private is still refused', async () => {
    // The belt-and-braces gate. Should never happen for a real Airbnb name,
    // which is exactly why it must not be the only thing standing there.
    const v = await checkImportUrl(
        'https://www.airbnb.com/rooms/1',
        resolves({ address: '169.254.169.254', family: 4 })
    );
    assert.equal(v.ok, false);
    assert.match(v.reason, /will not fetch/);
});

test('every address is checked, not just the first', async () => {
    // A name answering with one public address and one private one is the
    // whole trick — checking addresses[0] would pass this.
    const v = await checkImportUrl(
        'https://www.airbnb.com/rooms/1',
        resolves(
            { address: '151.101.1.140', family: 4 },
            { address: '127.0.0.1', family: 4 }
        )
    );
    assert.equal(v.ok, false);
});

test('a name that will not resolve is refused', async () => {
    const v = await checkImportUrl('https://www.airbnb.com/x', async () => { throw new Error('NXDOMAIN'); });
    assert.equal(v.ok, false);
    const empty = await checkImportUrl('https://www.airbnb.com/x', async () => []);
    assert.equal(empty.ok, false);
});

test('the refusal never names the address it resolved to', async () => {
    // The caller chose the hostname; they did not necessarily know where it
    // pointed. Echoing the resolved address back turns a refusal into a
    // working internal DNS lookup.
    const v = await checkImportUrl(
        'https://www.airbnb.com/rooms/1',
        resolves({ address: '10.1.2.3', family: 4 })
    );
    assert.equal(v.ok, false);
    assert.ok(!/10\.1\.2\.3/.test(v.reason), 'the reason leaked the address: ' + v.reason);
});

/* --------------------------------------------- the route uses all of this */

test('the route checks redirects, not just the first URL', () => {
    // fetch() follows redirects by default and re-checks nothing. A page on a
    // genuinely allowed domain answering "302 → http://169.254.169.254/"
    // would be followed straight past the allowlist, which makes the
    // allowlist decorative.
    const fs = require('fs');
    const path = require('path');
    const body = fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'app/api/import-listing/route.ts'),
        'utf8'
    );
    assert.match(body, /redirect:\s*'manual'/, 'redirects must not be followed blindly');
    assert.ok(
        (body.match(/checkImportUrl/g) || []).length >= 2,
        'the redirect target has to go through the same check as the first URL'
    );
});

test('the route no longer trusts getSession', () => {
    const fs = require('fs');
    const path = require('path');
    const raw = fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'app/api/import-listing/route.ts'),
        'utf8'
    );
    // Comments stripped first. The route explains in a comment why it does
    // NOT use getSession, and a check that cannot tell the explanation from
    // the thing being explained is a check that fails on a correct file.
    const code = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/getSession\(\)/.test(code),
        'getSession only decodes the cookie; anyone who writes their own passes it');
    assert.match(code, /getUser\(\)/);
});

test('the allowed list is short and deliberate', () => {
    // Not a rule so much as a tripwire: if this grows, somebody widened the
    // server's reach and should have to say so in a diff.
    assert.ok(ALLOWED_IMPORT_DOMAINS.length <= 6,
        'adding a domain here widens what the server can be made to fetch');
});
