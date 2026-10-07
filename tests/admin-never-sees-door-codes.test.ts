// No admin screen shows a host's door code or wifi password. Checked by hand
// on 7 Oct 2026: the admin pages and admin API routes never read the code
// tables, the wifi password, a message's text or the decrypt helpers; the
// message threads they link to refuse an admin (403); the code and wifi routes
// the listing editor uses refuse an admin moderating a listing (can_listing,
// no admin bypass); and the error log held none of them. This keeps it so: a
// change that makes an admin screen read one of them fails here, and has to
// be a decision rather than an accident.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const DIRS = ['app/admin', 'app/api/admin'];
const FORBIDDEN: [RegExp, string][] = [
    [/listing_access_codes/, 'the door-code table'],
    [/booking_access_codes/, 'the per-booking door-code table'],
    [/wifi_password/, 'the wifi password'],
    [/\b(revealSecret|openSecret|renderSecretTokens)\b/, 'a helper that opens or fills in a code'],
    [/from\(\s*['"]messages['"]\s*\)\s*\.select\([^)]*\bbody\b/, 'the text of messages (where check-in codes are shown)'],
];

function files(dir: string): string[] {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) return [];
    return fs.readdirSync(full, { withFileTypes: true }).flatMap((e) => {
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) return files(rel);
        return /\.(tsx?|jsx?)$/.test(e.name) ? [rel] : [];
    });
}

test('no admin page or admin API reads a door code, a wifi password or message text', () => {
    const all = DIRS.flatMap(files);
    assert.ok(all.length > 10, 'the admin files were found');
    const hits: string[] = [];
    for (const f of all) {
        const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
        for (const [re, what] of FORBIDDEN) if (re.test(src)) hits.push(`${f} reads ${what}`);
    }
    assert.deepEqual(hits, []);
});
