// The reply token, and the divergence that would look like nothing at all.
//
// THE FAILURE THIS EXISTS FOR
//
// The token is written as a hash by the create route and looked up by its hash
// in two other places. Those were three independent copies of the same line,
// and they agreed — which is precisely why it was worth fixing. The day one
// changed, nothing would throw: the token would be stored under one hash and
// searched for under another, and the only symptom is a reply link that says
// the enquiry has expired.
//
// Nobody reports that. A tradesman assumes he is late and gets on with his
// day. The host is told nobody answered. The enquiry expires on schedule.
// There is no error, no log line, and the loss is indistinguishable from a
// tradesman who could not be bothered — on a flow whose entire product is the
// accept.
//
// So the round trip is pinned, and so is the rule that there is only one
// implementation of it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const fs = require('fs');
const path = require('path');

import { newReplyToken, hashReplyToken } from '@/lib/enquiryToken';

// --- the round trip ---------------------------------------------------------

test('a token minted by the create route is found by the reply route', () => {
    // The three steps in order: mint, store the hash, look it up by hashing
    // the token out of the link. Written as the routes write it rather than as
    // one function called twice, because the bug being guarded against is the
    // two ends drifting apart.
    const token = newReplyToken();

    const stored = hashReplyToken(token);                    // create route
    const lookedUp = hashReplyToken(token);                  // respond route
    const onThePage = hashReplyToken(String(token || ''));   // reply page

    assert.equal(lookedUp, stored, 'the reply route cannot find what the create route stored');
    assert.equal(onThePage, stored, 'the reply page cannot find what the create route stored');
});

test('the hash is what actually gets stored, never the token', () => {
    const token = newReplyToken();
    const hash = hashReplyToken(token);

    assert.notEqual(hash, token, 'the token itself must never be the stored value');
    assert.match(hash, /^[0-9a-f]{64}$/, 'sha256 hex');
    assert.equal(hash.indexOf(token), -1, 'the token must not be recoverable from the hash');
});

test('two tokens are two tokens', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(newReplyToken());
    assert.equal(seen.size, 200, 'tokens must not repeat');

    // And a collision in the hash would let one link answer another enquiry.
    const hashes = new Set(Array.from(seen).map(hashReplyToken));
    assert.equal(hashes.size, 200);
});

test('a token is long enough to be worth hashing', () => {
    const token = newReplyToken();

    // 24 bytes as base64url. The SMS budget in emergencySms was measured
    // against exactly this length, so a change here shortens or overflows
    // every reply link in a text.
    assert.equal(token.length, 32, 'the SMS message budget assumes 32 characters');
    assert.match(token, /^[A-Za-z0-9_-]+$/, 'must survive being pasted into a URL');
});

test('an empty or missing token hashes to something, and to nothing findable', () => {
    // The reply page hashes whatever is in the URL, including nothing at all.
    // It must not throw — a bare /services/enquiry/ is a 404, not a 500 — and
    // it must not collide with a real token.
    const empty = hashReplyToken('');
    assert.match(empty, /^[0-9a-f]{64}$/);
    assert.notEqual(empty, hashReplyToken(newReplyToken()));
    assert.equal(hashReplyToken(undefined as any), empty);
    assert.equal(hashReplyToken(null as any), empty);
});

// --- one implementation, and only one ---------------------------------------

// The round trip above passes just as happily with three copies of the hashing
// as with one — it was passing, in effect, before any of this was extracted.
// This is the test that would actually have caught the drift: nothing outside
// lib/enquiryToken.ts may hash a token at all.
test('nothing outside lib/enquiryToken.ts hashes a reply token', () => {
    const ROOT = path.resolve(__dirname, '..', '..');

    const walk = (dir: string, out: string[] = []): string[] => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full, out);
            else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
        }
        return out;
    };

    const offenders: string[] = [];

    for (const dir of ['app', 'lib', 'components']) {
        const full = path.join(ROOT, dir);
        if (!fs.existsSync(full)) continue;

        for (const file of walk(full)) {
            if (file.endsWith(path.join('lib', 'enquiryToken.ts'))) continue;

            const source = fs.readFileSync(file, 'utf8');
            // Any sha256 of anything token-shaped, and any minting of one.
            if (/createHash\(\s*['"]sha256['"]\s*\)[\s\S]{0,120}?token/i.test(source)
                || /randomBytes\([^)]*\)[\s\S]{0,80}?base64url/i.test(source)) {
                offenders.push(path.relative(ROOT, file));
            }
        }
    }

    assert.deepEqual(
        offenders, [],
        'These hash or mint a reply token themselves:\n  ' + offenders.join('\n  ')
        + '\n\nUse newReplyToken and hashReplyToken from lib/enquiryToken.ts. Two'
        + '\nimplementations agree until one of them changes, and then a reply link'
        + '\nsimply stops working with nothing thrown and nothing logged.'
    );
});
