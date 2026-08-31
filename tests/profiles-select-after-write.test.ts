// A write to `profiles` must not ask for the whole row back.
//
// THE TRAP, WHICH IS ARMED RIGHT NOW FOR WHOEVER WRITES THE OBVIOUS THING.
//
// `.update({...}).select()` — with no argument — compiles to
// `Prefer: return=representation` with no column list, which PostgREST answers
// by doing `SELECT *`. That needs SELECT on every column of the table, and
// since 20260828234003 revoked table-level SELECT on `profiles`,
// `authenticated` holds it on twelve of about twenty-two.
//
// So the write succeeds and the response is **403, 42501**. The row IS
// updated. The caller sees a permission error and, reasonably, concludes the
// write failed — and may well retry it, or roll something back, or show the
// user an error about a save that actually happened.
//
// This is the same root cause as the account-page breakage the overnight audit
// found: `.upsert()` compiles to `INSERT ... ON CONFLICT DO UPDATE`, which
// needs SELECT on every column it writes. That one was fixed by removing the
// upsert. This is the other end of the same wire and nothing was stopping it.
//
// THE RULE IS NOT "NEVER SELECT". Naming the columns works, as long as they
// are ones `authenticated` can read — measured:
//
//   .update(...)                                  204
//   .update(...).select()                         403   SELECT *
//   .update(...).select('preferred_name')         200
//   .update(...).select('id, full_name')          200
//
// So: name them, or do not ask.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (['node_modules', '.git', '.next', '.test-build'].includes(entry.name)) continue;
        if (entry.isDirectory()) sourceFiles(rel, out);
        else if (/\.tsx?$/.test(entry.name)) out.push(rel);
    }
    return out;
}

/**
 * Every `from('profiles')` whose chain writes and then asks for the row back
 * with a BARE select, and whether that read goes through the service role.
 *
 * Per read, not per file — the same reasoning as
 * tests/no-star-select-on-listings: several files use both clients, and asking
 * whether the file mentions `adminClient` anywhere excuses the wrong ones.
 */
function bareSelectAfterProfileWrite(): { file: string; service: boolean }[] {
    const found: { file: string; service: boolean }[] = [];

    for (const file of ['app', 'components', 'lib'].flatMap((d) => sourceFiles(d))) {
        const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
        const reads = /(\w+)\s*\.\s*from\(\s*'profiles'\s*\)/g;
        let match: RegExpExecArray | null;

        while ((match = reads.exec(source)) !== null) {
            const tail = source.slice(match.index, match.index + 400);

            // A write, then a select with nothing in the brackets.
            if (!/\.\s*(update|insert|upsert)\s*\(/.test(tail)) continue;
            if (!/\.\s*select\(\s*\)/.test(tail)) continue;

            const receiver = match[1];
            const assignment = new RegExp('const\\s+' + receiver + '\\s*=[\\s\\S]{0,200}').exec(source);
            const madeBy = assignment ? assignment[0] : '';
            found.push({ file, service: /adminClient|SERVICE_ROLE/.test(madeBy) });
        }
    }

    return found;
}

test('no browser write to profiles asks for the whole row back', () => {
    const offenders = bareSelectAfterProfileWrite()
        .filter((hit) => !hit.service)
        .map((hit) => hit.file);

    assert.deepEqual(
        offenders, [],
        'These write to profiles and then call a bare .select():\n  '
        + offenders.join('\n  ')
        + '\n\nThat is `SELECT *`, which needs every column, and authenticated has'
        + '\ntwelve of twenty-two. The write SUCCEEDS and the response is 403 — so the'
        + '\ncaller thinks it failed and may retry or show an error about a save that'
        + '\nactually happened.'
        + '\n\nName the columns: .select(\'id, full_name\') works. Or do not ask.'
    );
});

test('the scan finds a bare select when there is one', () => {
    // A rule that cannot fire is not a rule. This is the shape it must catch,
    // checked against the matcher rather than against the repo — otherwise the
    // test above passes forever the day the regex stops working.
    const sample = `
        const supabase = createClientComponentClient();
        await supabase.from('profiles').update({ full_name: name }).eq('id', id).select();
    `;
    assert.match(sample, /\.\s*select\(\s*\)/);
    assert.match(sample, /from\(\s*'profiles'\s*\)/);
    assert.match(sample, /\.\s*(update|insert|upsert)\s*\(/);
});

test('a named select is not flagged', () => {
    const sample = `await supabase.from('profiles').update({ x: 1 }).eq('id', id).select('id, full_name');`;
    assert.ok(!/\.\s*select\(\s*\)/.test(sample), 'naming the columns is the way through');
});

test('the account page still writes without asking for the row back', () => {
    // The five call sites the overnight audit converted from upsert to update.
    // If one of them grows a .select(), it starts 403ing on a write that
    // worked, and the symptom will look like the upsert bug all over again.
    const body = fs.readFileSync(path.join(ROOT, 'app/account/page.tsx'), 'utf8');
    const writes = body.match(/from\('profiles'\)[\s\S]{0,220}?;/g) || [];

    assert.ok(writes.length >= 4, 'the account page profile writes have moved — check this deliberately');
    for (const w of writes) {
        assert.ok(!/\.\s*select\(\s*\)/.test(w), 'a bare .select() crept into: ' + w.slice(0, 120));
    }
});
