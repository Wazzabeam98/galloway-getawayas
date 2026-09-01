// Editing a live listing has to tell somebody.
//
// business_name, description and photos are in REVIEWABLE_FIELDS: they are the
// shop window, and they are the route by which a business approved as one
// thing quietly becomes another. The sign-up form has always called
// /api/services/submitted after saving, which is what sets changes_pending_at
// and emails the admins.
//
// The provider dashboard's business editor, added 31 August 2026, wrote the
// same columns straight from the browser and called nothing. Proven on test
// that day: renaming an approved provider the way saveDetails does left
// changes_pending_at null and its approved_digest disagreeing, with no alert
// sent. /admin/providers still worked it out from the digest, so it was
// discoverable — by somebody who went and looked, which is not the same as
// being told.
//
// A source check rather than a rendered one, matching badge-counts.test.ts:
// the guarantee is "this component does not write the shop window without
// announcing it", and that is a property of the file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const EDITOR = path.join(ROOT, 'components', 'services', 'ProviderBusinessEditor.tsx');

const source = () => fs.readFileSync(EDITOR, 'utf8');

test('the business editor announces what it changed', () => {
    assert.match(
        source(),
        /\/api\/services\/submitted/,
        'the editor writes reviewable fields and must call the route that flags them for review'
    );
});

test('every write of a reviewable field is followed by the announcement', () => {
    const body = source();

    // The two writes that touch REVIEWABLE_FIELDS: the details form
    // (business_name, description) and the photo list.
    const writes = [
        { what: 'the details form', marker: 'business_name: name.trim()' },
        { what: 'the photo list', marker: 'update({ photos: next })' },
    ];

    for (const w of writes) {
        assert.ok(body.includes(w.marker), 'expected to find ' + w.what);
    }

    // Both paths reach announceChange. Counted rather than located, because
    // where it sits is free to move and whether it is called is not.
    const calls = (body.match(/announceChange\(\)/g) || []).length;
    assert.ok(
        calls >= writes.length + 1,
        'each reviewable write must call announceChange, plus its definition — found ' + calls
    );
});

test('the announcement never costs the provider their edit', () => {
    // The row is already saved by the time it runs. Throwing here would fail a
    // save that succeeded, losing the change they just made.
    const body = source();
    const at = body.indexOf('async function announceChange');
    assert.ok(at > 0, 'announceChange should exist');

    const fn = body.slice(at, at + 700);
    assert.match(fn, /try\s*{/, 'the announcement is wrapped');
    assert.match(fn, /catch/, 'and a failure to announce is swallowed, not thrown');
});
