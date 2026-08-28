// Can the e2e suite still start?
//
// WHY THIS EXISTS. On 28 August 2026 the target guard was added and
// playwright.config.ts was pointed at it. The guard file was ESM; Playwright
// compiles the config to CommonJS and `require`s what it imports. Requiring an
// ESM file fails with "exports is not defined in ES module scope", so the
// entire e2e suite could not start — on master, on a clean checkout, for
// anything.
//
// `npm test` and `npm run build` both stayed green throughout, because neither
// touches Playwright. The suite that was hardened so runners could not silently
// stop working was itself silently not working, which is as neat a
// demonstration of the problem as could be arranged.
//
// So: the cheapest possible question, asked every run. `playwright test --list`
// compiles the config and every spec through Playwright's own loader and prints
// what it would run. It needs no browsers, no network, no database and no
// .env.local — e2e/helpers.ts reads its credentials on first use rather than on
// import, precisely so this can run anywhere.
//
// It does not prove the tests pass. It proves they can be found, which is the
// failure that actually happened and the one nothing else notices.
//
// ONE SUBTLETY, LEARNED BY MUTATION-TESTING THIS FILE. The break is not "any
// ESM import from the config". A trivial one-line .mjs imports fine — Playwright
// only transpiles a file it thinks needs it, and the failure comes from that
// transpile emitting `exports.foo = ...` into a file Node then loads as ESM,
// where `exports` does not exist.
//
// So the first mutant written to prove this test worked was a one-line stub,
// and it passed happily. Only reintroducing the real guard file as ESM
// reproduced it. Worth knowing: a small ESM import from the config can look
// perfectly fine and the same import will break once the file grows.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function listSpecs(): { ok: boolean; output: string } {
    try {
        const output = execFileSync(
            'npx',
            ['playwright', 'test', '--list'],
            { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 }
        );
        return { ok: true, output: String(output) };
    } catch (err: any) {
        const output = String((err && (err.stdout || '')) + (err && (err.stderr || '')));
        return { ok: false, output };
    }
}

test('the e2e suite can be loaded and its tests found', () => {
    const { ok, output } = listSpecs();

    assert.ok(
        ok,
        'playwright could not load the suite. This is what a broken config or a\n'
        + 'module-system mismatch looks like, and no other check in this repo sees it:\n\n'
        + output.split('\n').slice(0, 12).join('\n')
    );

    assert.match(
        output, /Total: \d+ tests? in \d+ files?/,
        'playwright ran but listed nothing, so the suite is empty or the specs were not found:\n' + output
    );
});

test('the shared target guard can be loaded by both module systems', () => {
    // The specific mismatch, asserted directly rather than only through
    // Playwright — so a failure says which of the two broke.
    //
    // require() is how Playwright reaches it. import() is how the .mjs runners
    // do. A file that only one of them can load is the bug.
    const guard = path.join(ROOT, 'scripts', 'target.cjs');

    const required = execFileSync(
        process.execPath,
        ['-e', `const t = require(${JSON.stringify(guard)}); console.log(Object.keys(t).sort().join(','))`],
        { encoding: 'utf8', timeout: 30_000 }
    ).trim();

    const imported = execFileSync(
        process.execPath,
        ['-e', `import(${JSON.stringify(guard)}).then(t => console.log(Object.keys(t).filter(k => k !== 'default').sort().join(',')))`],
        { encoding: 'utf8', timeout: 30_000 }
    ).trim();

    for (const name of ['assertSafeTarget', 'resolveTarget', 'PREVIEW_URL', 'TEST_PROJECT_REF']) {
        assert.ok(required.includes(name), `require() cannot see ${name} — Playwright's half is broken`);
        assert.ok(imported.includes(name), `import() cannot see ${name} — the runners' half is broken`);
    }
});
