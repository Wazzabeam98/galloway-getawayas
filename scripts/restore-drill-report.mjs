// File the drill's result and email it — run after the verification, either way.
//
// Two outputs, both unconditional (the workflow calls this with `always()`):
//
//   1. INSERT one row into public.restore_drill_runs on PRODUCTION, so the 8am
//      digest can see the drill ran and how it went, and the runbook has dated
//      evidence. The write goes through the same read-only drill role, which is
//      granted INSERT on this one table and nothing else.
//   2. Email the result to the owner, pass or fail, so a person hears about it
//      the day it happens rather than only when the quarterly digest notices.
//
// Recording and emailing are independent: a failure to email must not lose the
// record, and a failure to record must not swallow the email. Each is tried, and
// a problem with either is reported without aborting the other.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const SOURCE = process.env.SOURCE_DB_URL;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ALERT_EMAIL = process.env.ALERT_EMAIL;
const RUN_URL = process.env.RUN_URL || '';

let r;
try {
    r = JSON.parse(fs.readFileSync('restore-drill-result.json', 'utf8'));
} catch {
    // The verify step should always leave a result file; if it somehow did not,
    // manufacture a failure so this still records and alerts rather than going
    // quiet — a missing result is itself a failed drill.
    r = {
        status: 'fail',
        trigger: process.env.DRILL_TRIGGER || 'manual',
        runAt: new Date().toISOString(),
        tablesChecked: null,
        mismatches: [],
        listingsHashMatch: null,
        pgVersions: null,
        detail: 'No result file was produced — the drill did not reach the verification step.',
    };
}

// --- 1. Record on production -------------------------------------------------
if (!SOURCE) {
    console.error('report: SOURCE_DB_URL not set — cannot record the run');
} else {
    // Build the INSERT with dollar-quoted literals rather than psql's :'var'
    // interpolation, which does not fire reliably under -c. A random tag makes
    // the quoting safe against the spaces, slashes and quotes in the values
    // (these are our own machine-generated strings, not user input).
    const tag = 'q' + Math.random().toString(36).slice(2, 10);
    const lit = (s) => (s === null || s === undefined ? 'null' : `$${tag}$${s}$${tag}$`);
    const num = (n) => (n === null || n === undefined || n === '' ? 'null' : String(Number(n)));
    const bool = (b) => (b === null || b === undefined ? 'null' : b ? 'true' : 'false');
    const sql =
        'insert into public.restore_drill_runs ' +
        '(status, trigger, tables_checked, mismatches, listings_hash_match, pg_versions, detail) values (' +
        `${lit(r.status)}, ${lit(r.trigger)}, ${num(r.tablesChecked)}, ` +
        `${lit(JSON.stringify(r.mismatches ?? []))}::jsonb, ${bool(r.listingsHashMatch)}, ` +
        `${lit(r.pgVersions)}, ${lit(r.detail)})`;
    try {
        execFileSync('psql', [SOURCE, '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
        console.log('report: recorded the run in restore_drill_runs');
    } catch (e) {
        console.error('report: could not record the run:', e?.message || String(e));
    }
}

// --- 2. Email the owner ------------------------------------------------------
async function email() {
    if (!RESEND_API_KEY || !ALERT_EMAIL) {
        console.error('report: RESEND_API_KEY or ALERT_EMAIL not set — skipping email');
        return;
    }
    const passed = r.status === 'pass';
    const subject = passed
        ? `Restore drill passed — ${r.tablesChecked} tables verified`
        : 'Restore drill FAILED — action needed';

    const mismatchRows = (r.mismatches || [])
        .map((m) => `<tr><td style="padding:4px 10px 4px 0;">${m.table}</td>` +
            `<td style="padding:4px 10px 4px 0;">source ${m.source}</td>` +
            `<td style="padding:4px 0;">target ${m.target}</td></tr>`)
        .join('');

    const html =
        `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;">` +
        `<h2 style="color:${passed ? '#047857' : '#b91c1c'};margin:0 0 12px;">` +
        `${passed ? 'Restore drill passed' : 'Restore drill FAILED'}</h2>` +
        `<p style="margin:0 0 12px;font-size:15px;color:#334155;">${r.detail || ''}</p>` +
        `<table style="border-collapse:collapse;font-size:14px;color:#334155;margin:0 0 12px;">` +
        `<tr><td style="padding:2px 12px 2px 0;color:#64748b;">When</td><td>${r.runAt}</td></tr>` +
        `<tr><td style="padding:2px 12px 2px 0;color:#64748b;">Trigger</td><td>${r.trigger}</td></tr>` +
        `<tr><td style="padding:2px 12px 2px 0;color:#64748b;">Tables checked</td><td>${r.tablesChecked ?? '—'}</td></tr>` +
        `<tr><td style="padding:2px 12px 2px 0;color:#64748b;">Listings hash</td><td>${r.listingsHashMatch === null ? '—' : r.listingsHashMatch ? 'matched' : 'DID NOT match'}</td></tr>` +
        `<tr><td style="padding:2px 12px 2px 0;color:#64748b;">Postgres</td><td>${r.pgVersions ?? '—'}</td></tr>` +
        `</table>` +
        (mismatchRows ? `<table style="border-collapse:collapse;font-size:13px;color:#b91c1c;margin:0 0 12px;">${mismatchRows}</table>` : '') +
        (RUN_URL ? `<p style="font-size:13px;"><a href="${RUN_URL}" style="color:#047857;">View the workflow run</a></p>` : '') +
        `<p style="font-size:12px;color:#94a3b8;margin-top:16px;">Automated quarterly database restore drill. It restores a full copy of the production application data into a throwaway Postgres and checks every table. See docs/BACKUP-AND-RESTORE.md.</p>` +
        `</div>`;

    const to = ALERT_EMAIL.split(',').map((s) => s.trim()).filter(Boolean);
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            authorization: `Bearer ${RESEND_API_KEY}`,
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            from: 'Galloway Getaways <bookings@gallowaygetaways.co.uk>',
            to,
            subject,
            html,
        }),
    });
    if (!res.ok) {
        console.error('report: email failed:', res.status, await res.text());
    } else {
        console.log('report: emailed', to.join(', '));
    }
}

await email();
