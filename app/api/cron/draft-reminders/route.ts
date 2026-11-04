import { NextResponse } from 'next/server';
import { greetingName } from '@/lib/utils';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { planDraftReminders, draftReminderCopy, ReminderDraft } from '@/lib/draftReminders';
import { recordCronRun } from '@/lib/cronHeartbeat';

export const dynamic = 'force-dynamic';

const JOB = 'draft-reminders';

// Don't reach back for a draft older than this — a months-old abandoned draft
// getting a "finish it" email reads as spam, not a nudge.
const MAX_DRAFT_AGE_DAYS = 60;

// Daily: nudge a host who left the add-a-listing wizard in draft to come back —
// once at ~48h, again at ~7d, never after it leaves draft. The choosing is
// lib/draftReminders; this reads, claims and sends.
//
// CLAIM BEFORE SEND. The host_draft_reminders row goes in first; its primary key
// (listing_id, kind) makes a second insert fail, so two overlapping runs can't
// both email. A send that fails after its claim is logged, not retried: one
// missed nudge beats a host getting the same email on a loop.
export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get('authorization') !== 'Bearer ' + secret) {
        return NextResponse.json({ ok: false, error: 'Unauthorised' }, { status: 401 });
    }

    const admin = adminClient();
    let sent = 0;
    let failed = 0;

    try {
        const floor = new Date(Date.now() - MAX_DRAFT_AGE_DAYS * 86400000).toISOString();
        const { data: drafts, error: draftError } = await admin
            .from('listings')
            .select('id, host_id, title, created_at')
            .eq('status', 'draft')
            .gte('created_at', floor);
        if (draftError) throw draftError;
        if (!drafts || drafts.length === 0) {
            await recordCronRun(JOB, true, 'no drafts');
            return NextResponse.json({ ok: true, sent, failed });
        }

        // The hosts behind those drafts — real, non-anonymised, with an email.
        const hostIds = Array.from(new Set(drafts.map((d: any) => d.host_id).filter(Boolean)));
        const { data: hosts, error: hostError } = await admin
            .from('profiles')
            .select('id, email, full_name, first_name, last_name, preferred_name, anonymised_at')
            .in('id', hostIds);
        if (hostError) throw hostError;
        const hostOf: Record<string, any> = {};
        (hosts || []).forEach((h: any) => { if (h.email && !h.anonymised_at) hostOf[h.id] = h; });

        // Notification preferences — a host who switched off news and offers is
        // not emailed a nudge. (A "finish your listing" prompt is a growth
        // nudge, so it honours the marketing opt-out and carries its unsubscribe.)
        const { data: prefRows } = await admin
            .from('notification_preferences')
            .select('user_id, marketing, unsubscribe_token')
            .in('user_id', hostIds);
        const prefOf: Record<string, any> = {};
        (prefRows || []).forEach((p: any) => { prefOf[p.user_id] = p; });

        const { data: claimedRows, error: claimReadError } = await admin
            .from('host_draft_reminders')
            .select('listing_id, kind')
            .in('listing_id', drafts.map((d: any) => d.id));
        if (claimReadError) throw claimReadError;
        const claimed = new Set<string>((claimedRows || []).map((r: any) => r.listing_id + ':' + r.kind));

        const plan = planDraftReminders(drafts as ReminderDraft[], claimed, Date.now());
        if (plan.length === 0) {
            await recordCronRun(JOB, true, 'nothing due');
            return NextResponse.json({ ok: true, sent, failed });
        }

        const draftOf: Record<string, any> = {};
        (drafts as any[]).forEach((d) => { draftOf[d.id] = d; });

        for (const p of plan) {
            const draft = draftOf[p.listingId];
            const host = draft && hostOf[draft.host_id];
            if (!host) continue;

            const pref = prefOf[host.id];
            if (pref && pref.marketing === false) continue; // opted out of nudges

            const rows = [{ listing_id: p.listingId, kind: p.kind }];
            if (p.alsoClaim) rows.push({ listing_id: p.listingId, kind: p.alsoClaim });
            const { error: claimError } = await admin.from('host_draft_reminders').insert(rows);
            if (claimError) continue; // another run got there first

            const copy = draftReminderCopy(p.kind, draft.title);
            const name = escapeHtml(greetingName(host, 'there'));
            const unsubscribe = pref && pref.unsubscribe_token
                ? SITE_URL + '/unsubscribe?token=' + pref.unsubscribe_token + '&type=marketing'
                : undefined;
            const ok = await sendEmail(
                host.email,
                copy.subject,
                emailLayout(
                    `<p style="margin:0 0 16px;font-size:16px;">Hello ${name},</p>`
                    + copy.paragraphs.map((t) => `<p style="margin:0 0 16px;font-size:16px;">${escapeHtml(t)}</p>`).join('')
                    + button(SITE_URL + '/addhome?draft=' + encodeURIComponent(p.listingId), 'Finish your listing'),
                    'You’re receiving this because you started listing a property on Galloway Getaways.',
                    unsubscribe,
                )
            );
            if (ok) sent += 1;
            else {
                failed += 1;
                await logError('draft-reminders: reminder email did not send',
                    { listing: p.listingId, kind: p.kind },
                    { path: '/api/cron/draft-reminders' });
            }
        }

        await recordCronRun(JOB, true, 'sent=' + sent + ' failed=' + failed);
        return NextResponse.json({ ok: true, sent, failed });
    } catch (err: any) {
        await logError('draft-reminders: run failed', err, { path: '/api/cron/draft-reminders' });
        await recordCronRun(JOB, false, 'run failed: ' + ((err && err.message) || ''));
        return NextResponse.json({ ok: false, error: 'Run failed', sent, failed }, { status: 500 });
    }
}
