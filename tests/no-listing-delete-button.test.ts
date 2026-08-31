// Nothing may offer to delete a listing, or say that it has.
//
// There was a button on the dashboard that ran
// `supabase.from('listings').delete()` as the browser user. `listings` has no
// DELETE policy, so RLS matched nothing and PostgREST answered 204 — the row
// stayed, the dialog closed, and it had said:
//
//     "This action cannot be undone. This will permanently delete your added
//      home and remove your data from our servers."
//
// It could not be made to work by granting the delete. bookings.listing_id is
// ON DELETE CASCADE, and from bookings the messages, reviews, booking guests
// and conversation prefs cascade as well, while payments and payouts are SET
// NULL — money left in the ledger that can no longer be tied to a stay. One
// dispute anywhere on the listing blocks the whole delete with a foreign key
// error. And the published privacy policy says booking and payment records are
// kept for six years, as UK tax law requires.
//
// WHY A TEST AND NOT JUST A DELETION. This repo is also edited by pasting whole
// files into GitHub's web editor, and a whole-file paste carries whatever that
// copy had in it — CLAUDE.md says so in as many words. A component removed
// today can reappear tomorrow without anyone deciding it should. This is the
// cheap half of stopping that.

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

const code = (rel: string) =>
    fs.readFileSync(path.join(ROOT, rel), 'utf8')
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

test('nothing in a browser deletes a listing', () => {
    const offenders: string[] = [];

    for (const file of ['app', 'components'].flatMap((d) => sourceFiles(d))) {
        const body = code(file);
        const reads = /(\w+)\s*\.\s*from\(\s*["']listings["']\s*\)/g;
        let match: RegExpExecArray | null;

        while ((match = reads.exec(body)) !== null) {
            const tail = body.slice(match.index, match.index + 200);
            if (!/\.\s*delete\s*\(/.test(tail)) continue;

            const receiver = match[1];
            const assignment = new RegExp('const\\s+' + receiver + '\\s*=[\\s\\S]{0,200}').exec(body);
            const madeBy = assignment ? assignment[0] : '';
            if (/adminClient|SERVICE_ROLE/.test(madeBy)) continue;

            offenders.push(file);
        }
    }

    assert.deepEqual(
        offenders, [],
        'These delete a listing from the browser:\n  ' + offenders.join('\n  ')
        + '\n\nlistings has no DELETE policy, so this answers 204 and does nothing —'
        + '\nand granting it would cascade the bookings, the messages and the reviews,'
        + '\nand orphan the payments. Hide it instead. See OUTSTANDING.md.'
    );
});

test('nothing claims a listing has been permanently deleted', () => {
    // The half that made it worse than a dead button: it said so.
    const offenders: string[] = [];

    for (const file of ['app', 'components'].flatMap((d) => sourceFiles(d))) {
        // Account deletion is real and works — delete_own_account() is a
        // SECURITY DEFINER routine that tidies up properly. It is about a
        // person, not a property.
        if (file === 'app/account/page.tsx') continue;

        // Comments stripped. app/dashboard/page.tsx quotes the old dialog
        // wording in a comment explaining why the button is gone, and a check
        // that cannot tell the explanation from the thing explained fails on
        // the file that fixed the problem. That has happened three times in
        // one day now, which is why every source-reading test here uses code().
        const body = code(file);
        if (/permanently delete[\s\S]{0,60}(home|listing|propert)/i.test(body)) offenders.push(file);
        if (/remove your data from our servers/i.test(body)) offenders.push(file);
    }

    assert.deepEqual(
        Array.from(new Set(offenders)), [],
        'These promise a listing will be permanently deleted:\n  ' + offenders.join('\n  ')
        + '\n\nIt will not be. Say what actually happens, or do not offer it.'
    );
});

test('the dashboard still offers Hide, which is the thing that works', () => {
    // Removing the delete must not have taken the working control with it.
    const dash = code('app/dashboard/page.tsx');
    assert.match(dash, /HideListingBtn/);
    assert.ok(!/DeleteHomebtn/.test(dash));
    assert.ok(
        !fs.existsSync(path.join(ROOT, 'components/DeleteHomebtn.tsx')),
        'the component is back'
    );
});
