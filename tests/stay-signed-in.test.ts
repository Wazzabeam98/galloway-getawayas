// Staying signed in (lib/staySignedIn) and the resend countdown
// (lib/signInMemory, lib/signInCode).
//
// What matters: a sign-in cookie is re-issued from the server with a year's
// life by default; a refreshed token always beats the one the browser sent (re-
// stamping the old one would sign the person out); "don't stay" makes it a
// browser-session cookie; and a code sent under a minute ago is reported as
// still good with the exact seconds left, never as "wait a minute".

import { test } from 'node:test';
import assert from 'node:assert/strict';

/* eslint-disable @typescript-eslint/no-var-requires */
const stay = require('../lib/staySignedIn');
const memory = require('../lib/signInMemory');
const code = require('../lib/signInCode');
/* eslint-enable @typescript-eslint/no-var-requires */

const TOKEN = 'sb-hviwjxigqivjfhmhpjiy-auth-token';

test('only Supabase sign-in cookies are touched', () => {
    assert.equal(stay.isAuthCookie(TOKEN), true);
    assert.equal(stay.isAuthCookie(TOKEN + '.0'), true);
    assert.equal(stay.isAuthCookie('gg_mode'), false);
    assert.equal(stay.isAuthCookie('sb-x-auth-token-code-verifier'), false);
});

// A token whose payload carries session_id, as Supabase's do.
function tokenFor(sessionId: string): string {
    const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return b64({ alg: 'HS256' }) + '.' + b64({ sub: 'u', session_id: sessionId, exp: 2_000_000_000 }) + '.sig';
}
const SID = '5d8a6b60-ad5c-4c10-9fff-fc0b8359769e';
const OLD_SID = 'd1c8b8e7-292b-4078-aeab-934cdbd7e25a';

test('staying is the default; "don\'t stay" counts only for the sign-in it was chosen for', () => {
    assert.equal(stay.wantsToStay(undefined, SID), true);
    assert.equal(stay.wantsToStay('pending', SID), false, 'just chosen, not yet bound');
    assert.equal(stay.wantsToStay(SID, SID), false, 'bound to this session');
    assert.equal(stay.wantsToStay(OLD_SID, SID), true, 'left by an earlier sign-in: ignored');
});

test('the middleware binds a fresh choice and deletes a stale one, whatever route the sign-in came by', () => {
    assert.deepEqual(stay.resolveStayChoice(undefined, SID), { stay: true, rewrite: null });
    assert.deepEqual(stay.resolveStayChoice('pending', SID), { stay: false, rewrite: { value: SID } });
    assert.deepEqual(stay.resolveStayChoice(SID, SID), { stay: false, rewrite: null });
    assert.deepEqual(stay.resolveStayChoice(OLD_SID, SID), { stay: true, rewrite: 'delete' });
    // The old cookie's "0" is a different cookie altogether, and is deleted on sight.
    assert.notEqual(stay.STAY_COOKIE, stay.LEGACY_STAY_COOKIE);
    assert.deepEqual(stay.resolveStayChoice('0', SID), { stay: true, rewrite: 'delete' });
});

test('the session id is read from the sign-in cookie as the browser stores it', () => {
    const raw = encodeURIComponent(JSON.stringify([tokenFor(SID), 'refresh', null, null, null]));
    assert.equal(stay.sessionIdFromAuthCookie(raw), SID);
    assert.equal(stay.sessionIdFromAccessToken(tokenFor(SID)), SID);
    assert.equal(stay.sessionIdFromAuthCookie('garbage'), null);
});

test('a pending "don\'t stay" is short-lived, so an abandoned sign-in cannot leave it behind', () => {
    assert.ok(stay.STAY_PENDING_MAX_AGE_SECONDS <= 15 * 60);
});

test('a year, matched to Airbnb, renewed on each visit', () => {
    const [s] = stay.stampsFor([{ name: TOKEN, value: 'old' }], [], true, true);
    assert.equal(s.options.maxAge, 365 * 24 * 60 * 60);
    assert.equal(stay.serializeStamp(s), TOKEN + '=old; Path=/; SameSite=Lax; Max-Age=31536000; Secure');
});

test('"don\'t stay" re-issues it as a cookie that ends with the browser', () => {
    const [s] = stay.stampsFor([{ name: TOKEN, value: 'old' }], [], false, true);
    assert.equal(s.options.maxAge, undefined);
    assert.doesNotMatch(stay.serializeStamp(s), /Max-Age/);
});

test('a token refreshed by the middleware wins over the one the browser sent', () => {
    const out = stay.stampsFor([{ name: TOKEN, value: 'old' }, { name: 'gg_mode', value: 'host' }], [{ name: TOKEN, value: 'new' }], true, true);
    assert.deepEqual(out.map((s: any) => [s.name, s.value]), [[TOKEN, 'new']]);
});

test('a cookie the refresh deleted is not brought back', () => {
    const out = stay.stampsFor([{ name: TOKEN + '.1', value: 'chunk' }], [{ name: TOKEN + '.1', value: '' }], true, true);
    assert.deepEqual(out, []);
});

test('raw cookie values survive untouched (they are encoded JSON)', () => {
    const raw = '%5B%22eyJ%22%2C%22r%22%5D';
    assert.deepEqual(stay.parseCookieHeader('gg_stay=1; ' + TOKEN + '=' + raw), [{ name: 'gg_stay', value: '1' }, { name: TOKEN, value: raw }]);
    assert.deepEqual(
        stay.parseSetCookies(TOKEN + '=' + raw + '; Path=/; Max-Age=100, other=x; Path=/'),
        [{ name: TOKEN, value: raw }, { name: 'other', value: 'x' }]
    );
});

function store() {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

test('resend: the exact seconds left, per address', () => {
    const s = store();
    memory.recordCodeSent('a@b.com', 1_000_000, s);
    assert.equal(memory.secondsUntilResend('a@b.com', 1_000_000 + 18_000, s), 42);
    assert.equal(memory.secondsUntilResend('a@b.com', 1_000_000 + 61_000, s), 0);
    assert.equal(memory.secondsUntilResend('other@b.com', 1_000_000, s), 0);
});

test('Supabase\'s cooldown is read as seconds left; the site-wide limit is not', () => {
    assert.equal(code.retryAfterSeconds({ status: 429, message: 'For security purposes, you can only request this after 37 seconds.' }), 37);
    assert.equal(code.retryAfterSeconds({ status: 429, message: 'For security purposes' }), 60);
    assert.equal(code.retryAfterSeconds({ status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' }), 0);
    assert.equal(code.retryAfterSeconds({ status: 500, message: 'boom' }), 0);
});

/* ---------------------------------------------- signing out of this device */

// A fake document.cookie: writes with Max-Age=0 delete, others set.
function fakeBrowser(initial: Record<string, string>, protocol = 'https:') {
    const jar = new Map(Object.entries(initial));
    const writes: string[] = [];
    const g: any = globalThis as any;
    g.location = { protocol };
    g.document = {
        get cookie() { return Array.from(jar.entries()).map(([k, v]) => k + '=' + v).join('; '); },
        set cookie(line: string) {
            writes.push(line);
            const [pair] = line.split(';');
            const i = pair.indexOf('=');
            const name = pair.slice(0, i);
            if (/Max-Age=0/i.test(line)) jar.delete(name); else jar.set(name, pair.slice(i + 1));
        },
    };
    return { jar, writes, done: () => { delete g.document; delete g.location; } };
}

test('log out ends THIS device only — scope local, never global', async () => {
    const b = fakeBrowser({ [TOKEN]: 'x', gg_stay: '0', gg_nostay: SID, gg_seen: SID + '.1790000000' });
    const calls: any[] = [];
    await stay.signOutThisDevice({ auth: { signOut: async (o: any) => { calls.push(o); return { error: null }; } } });
    b.done();
    assert.deepEqual(calls, [{ scope: 'local' }]);
    assert.equal(b.jar.has(TOKEN), false);
    assert.equal(b.jar.has('gg_stay'), false, 'the next sign-in chooses afresh');
    assert.equal(b.jar.has('gg_nostay'), false, 'the next sign-in chooses afresh');
    assert.equal(b.jar.has('gg_seen'), false, 'a chosen log out is never reported as lost');
});

test('the cookie goes even when the server refuses (403 session not found) or throws', async () => {
    for (const signOut of [
        async () => ({ error: { status: 403, message: 'Session from session_id claim in JWT does not exist' } }),
        async () => { throw new Error('offline'); },
    ]) {
        const b = fakeBrowser({ [TOKEN]: 'x', [TOKEN + '.1']: 'y', gg_mode: 'host' });
        await stay.signOutThisDevice({ auth: { signOut } });
        b.done();
        assert.equal(b.jar.has(TOKEN), false);
        assert.equal(b.jar.has(TOKEN + '.1'), false, 'every chunk');
        assert.equal(b.jar.get('gg_mode'), 'host', 'other cookies are left alone');
        assert.ok(b.writes.some((w) => w.startsWith(TOKEN + '=;') && /Secure/.test(w)), 'the Secure copy the middleware wrote is deleted too');
    }
});

test('no per-device log out calls the global default any more', () => {
    const fs = require('fs');
    const path = require('path');
    const ROOT = path.resolve(__dirname, '..', '..');
    for (const rel of ['components/common/SignOut.tsx', 'components/legal/AgreementGate.tsx', 'components/auth/AuthPanel.tsx', 'components/auth/EmailFirstStep.tsx']) {
        const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        assert.doesNotMatch(src, /auth\.signOut\(\s*\)/, rel + ' must not sign out every device');
        assert.match(src, /signOutThisDevice\(supabase\)/, rel);
    }
});

/* ------------------------------------------ every sign-in records the choice */

test('recording "stay" deletes any choice, old or new; "don\'t stay" is pending until bound', () => {
    const b = fakeBrowser({ gg_stay: '0', gg_nostay: OLD_SID });
    stay.recordStayChoice(true);
    assert.equal(b.jar.has('gg_stay'), false);
    assert.equal(b.jar.has('gg_nostay'), false);
    stay.recordStayChoice(false);
    assert.equal(b.jar.get('gg_nostay'), 'pending');
    assert.ok(b.writes.some((w) => /^gg_nostay=pending;.*Max-Age=900/.test(w)));
    b.done();
});

// The guard against the bug coming back: any page or component that signs
// someone in must record the stay choice first. A new sign-in route that
// forgets fails here. (The emailed-link callback is server-side and needs
// nothing: the middleware binds or discards whatever it finds.)
test('every route that signs someone in records the stay choice', () => {
    const fs = require('fs');
    const path = require('path');
    const ROOT = path.resolve(__dirname, '..', '..');
    const SIGNS_IN = /\b(verifySignInCode|verifyCode|logInWithPassword|signInWithPassword|signInWithOAuth|signInWithIdToken)\s*\(/;
    const RECORDS = /\b(recordStayChoice|carryStayChoice)\s*\(/;
    const files: string[] = [];
    const walk = (dir: string) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (/\.tsx?$/.test(e.name)) files.push(p);
        }
    };
    walk(path.join(ROOT, 'app'));
    walk(path.join(ROOT, 'components'));
    const signers = files.filter((f) => !/\/api\//.test(f) && !/app\/auth\/callback\//.test(f) && SIGNS_IN.test(fs.readFileSync(f, 'utf8')));
    assert.ok(signers.length >= 5, 'found the sign-in routes: ' + signers.length);
    for (const f of signers) {
        assert.match(fs.readFileSync(f, 'utf8'), RECORDS, path.relative(ROOT, f) + ' signs someone in without recording the stay choice');
    }
});

/* ---------------------------------------------------- noticing a lost sign-in */

test('a lost sign-in is reported once, on a page load, only where this device had one', () => {
    const seen = stay.parseSeen(stay.seenValue(SID, 1_790_000_000));
    assert.deepEqual(seen, { sessionId: SID, at: 1_790_000_000 });
    assert.equal(stay.lostSignInToReport({ seen, hasAuthCookie: false, sessionOk: false, isDocument: true }), 'cookie_gone');
    assert.equal(stay.lostSignInToReport({ seen, hasAuthCookie: true, sessionOk: false, isDocument: true }), 'session_refused');
    assert.equal(stay.lostSignInToReport({ seen, hasAuthCookie: true, sessionOk: true, isDocument: true }), null);
    assert.equal(stay.lostSignInToReport({ seen, hasAuthCookie: false, sessionOk: false, isDocument: false }), null, 'not a prefetch burst');
    assert.equal(stay.lostSignInToReport({ seen: null, hasAuthCookie: false, sessionOk: false, isDocument: true }), null, 'never signed in here');
    assert.equal(stay.parseSeen('nonsense'), null);
});
