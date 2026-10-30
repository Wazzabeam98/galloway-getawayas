// A guest-experience provider can always see where their listing stands in
// review, and always gets back to it.
//
// THE FAILURE THIS GUARDS (the GG-PROVIDER-JOURNEY walk, 21 Oct 2026)
//
// After Submit, the only sign of review was a panel at the very BOTTOM of the
// editor (below every section on a phone) while the top still said "None of
// these stop it going live"; a declined provider landed in the editor and was
// shown "Ready to go live?" with no reason at all; and "Your listing", the
// dashboard's calendar and the join page all sent a not-yet-approved experience
// back to the wizard's step one, so the listing they had submitted seemed gone.
//
// Read as source, like tests/provider-resume.test.ts: the pages are async
// server components and the editor is thousands of lines of client state, so
// rendering them here would test a harness. What matters is the shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the editor shows the review status at the TOP, before any section', () => {
    const editor = read('components/services/ProviderListingEditor.tsx');

    const banner = editor.indexOf('<ReviewStatusBanner');
    const sections = editor.indexOf('<PhoneSectionTabs');
    assert.ok(banner > 0, 'the status banner is rendered');
    assert.ok(banner < sections, 'above the sections, where Airbnb puts it — not after them');

    // Every non-live state has its words: in review, sent back, not yet sent.
    assert.match(editor, />In review</);
    assert.match(editor, />Action required</);
    assert.match(editor, /Submit for review/);
    assert.match(editor, /Send for review again/, 'a declined listing is sent back from the banner');

    // The old bottom-of-page panel is gone, so there is one status, at the top.
    assert.doesNotMatch(editor, /Ready to go live\?/);
});

test('a declined listing shows OUR NOTE in its banner', () => {
    const page = read('app/services/dashboard/listing/page.tsx');
    const editor = read('components/services/ProviderListingEditor.tsx');

    assert.match(page, /status, review_note,/, 'the listing page reads the note');
    assert.match(page, /review_note: provider\.status === 'declined'/, 'and hands it to the editor only when sent back');
    assert.match(editor, /reviewNote=\{p\.review_note/, 'the banner is given the note');
});

test('the "missing a few things" banner never says "going live" of a listing that is not live', () => {
    const editor = read('components/services/ProviderListingEditor.tsx');
    assert.match(editor, /None of these hold up your review/);
    // The live wording is only reached through the `live` branch.
    assert.match(editor, /\{live\s*\?\s*<>None of these stop it going live/);
});

test('"Your listing" and the join page take a submitted experience to its listing; its calendar opens', () => {
    const edit = read('app/services/dashboard/edit/page.tsx');
    assert.match(edit, /provider\.status !== 'approved' && mine\.isOwner && !isGuestProvider\) redirect\(`\/services\/join/,
        'only a trade is sent back to the wizard from "Your listing"');

    // Changed 21 Oct 2026 (Liam): the calendar used to bounce a not-yet-approved
    // experience to its listing, which made the editor's "Open calendar" a loop
    // back to the listing. A provider blocks days before going live, as a host
    // does, so only a TRADE is sent back from the calendar now.
    const calendar = read('app/services/dashboard/calendar/page.tsx');
    assert.match(calendar, /provider\.status !== 'approved' && mine\.isOwner && provider\.audience !== 'guest'\) \{\s*redirect\(`\/services\/join/,
        'only a trade is redirected; an experience opens its calendar at any stage');

    // The lookup lives in lib/joinResume.ts, shared by /services/join and
    // /business/experience (Oct 2026).
    const join = read('lib/joinResume.ts');
    assert.match(join, /trade === 'guest' && data\.status !== 'draft'\) \{\s*redirect\('\/services\/dashboard\/listing'\)/,
        'a sent experience (in review, sent back or live) is not re-created in the wizard');
});
