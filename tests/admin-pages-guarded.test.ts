// Every page under /admin must ask lib/access who is calling.
//
// The check was written out nine times — once per page — byte for byte
// identical apart from whether the variable was called `data` or `auth`. Every
// copy was correct. Nothing made the tenth correct, and the tenth is the one
// somebody writes by pasting the ninth and changing the query underneath it.
//
// This is the rule that says there will not be a tenth copy. It is deliberately
// the same shape as tests/routes-verify-identity, which does the same job for
// the API routes.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const ADMIN = path.join(ROOT, 'app', 'admin');

function adminPages(dir: string = ADMIN, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) adminPages(full, out);
        else if (entry.name === 'page.tsx') out.push(path.relative(ROOT, full));
    }
    return out;
}

const code = (rel: string) =>
    fs.readFileSync(path.join(ROOT, rel), 'utf8')
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');

test('there are admin pages to check', () => {
    // If this ever empties the rule below is vacuously true, which is the
    // failure mode the whole file exists to prevent.
    assert.ok(adminPages().length >= 8, 'found ' + adminPages().length + ' admin pages');
});

test('every admin page calls requireAdmin', () => {
    const unguarded = adminPages().filter((rel) => !/requireAdmin\s*\(/.test(code(rel)));

    assert.deepEqual(
        unguarded, [],
        'These pages under /admin do not call requireAdmin:\n  ' + unguarded.join('\n  ')
        + '\n\nEvery one of them shows money or personal data. Import it from'
        + '\n@/lib/access rather than writing the check again.'
    );
});

test('no admin page has its own copy of the check', () => {
    // The thing being prevented: a page that calls requireAdmin AND still
    // carries the old inline version, or one that grows a second variant
    // beside it.
    const offenders = adminPages().filter((rel) => {
        const body = code(rel);
        return /\.select\(\s*'is_admin'\s*\)/.test(body);
    });

    assert.deepEqual(
        offenders, [],
        'These read is_admin themselves instead of asking lib/access:\n  '
        + offenders.join('\n  ')
    );
});

test('the shared check verifies the caller rather than decoding their cookie', () => {
    const body = code('lib/access.ts');
    const fn = body.slice(body.indexOf('export async function requireAdmin'));

    assert.match(fn, /getUser\(\)/);
    assert.ok(!/getSession\(\)/.test(fn),
        'getSession never checks the signature — the id would be whatever the caller wrote');
});

test('the shared check fails closed and says nothing', () => {
    const body = code('lib/access.ts');
    const fn = body.slice(body.indexOf('export async function requireAdmin'));

    assert.match(fn, /is_admin !== true/,
        'a truthy non-true value must refuse too, not just a falsy one');
    assert.match(fn, /!profile \|\| profile\.is_admin !== true/,
        'a missing row and a failed read have to refuse as well');
    assert.equal((fn.match(/notFound\(\)/g) || []).length, 2,
        'both the signed-out and the not-an-admin path must 404');
    assert.ok(!/redirect\(|status:\s*403/.test(fn),
        'a 403 or a redirect confirms /admin exists and is worth attacking; a 404 says nothing');
});
