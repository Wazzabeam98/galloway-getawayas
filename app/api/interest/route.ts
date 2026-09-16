import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { withinLimits, callerAddress, GLOBAL_KEY } from '@/lib/rateLimit';
import { recipients, sendEmailToAll, emailLayout, detailRows, escapeHtml } from '@/lib/email';
import { parseInterest, CATEGORY_LABEL, REGION_LABEL } from '@/lib/interest';

export const dynamic = 'force-dynamic';

// Register your interest — one public press from the coming-soon banner, no
// account. It writes a row to interest_registrations (a table no browser role
// can read) through the service role, and emails the owner. The form is
// unauthenticated by nature, so it carries the same defences /api/services/apply
// does — a global + per-IP + per-email rate limit — plus a honeypot and a
// dedupe, so a repeat from one person updates their row instead of piling up.

// A field no human sees. Real browsers leave a hidden, off-screen input empty;
// a bot filling every field will put something here. When it is filled we
// pretend it worked (a 200 with ok:true) and store nothing, so the bot learns
// nothing and moves on.
function looksLikeABot(body: any): boolean {
    return typeof body?.company === 'string' && body.company.trim() !== '';
}

export async function POST(req: Request) {
    let body: any;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ ok: false, error: 'That did not arrive as we expected.' }, { status: 400 });
    }

    // The honeypot is checked before anything is stored or counted — a bot must
    // not even move the rate-limit counter.
    if (looksLikeABot(body)) {
        return NextResponse.json({ ok: true });
    }

    const parsed = parseInterest(body);
    if (!parsed.ok) {
        // `in` rather than relying on the ok:true/false discriminant, which
        // collapses to boolean (and stops narrowing) under the test tsconfig's
        // strict:false.
        const error = 'error' in parsed ? parsed.error : 'That did not look right.';
        return NextResponse.json({ ok: false, error }, { status: 400 });
    }
    const value = 'value' in parsed ? parsed.value : null;
    if (!value) {
        return NextResponse.json({ ok: false, error: 'That did not look right.' }, { status: 400 });
    }
    const { category, name, email, phone, region, notes } = value;

    // Cheapest and most important first: the site-wide cap is the load-bearing
    // one (it bounds the outbound email whatever address the caller claims);
    // per-IP and per-email raise the bar for the ordinary case.
    const verdict = await withinLimits([
        { bucket: 'interest:all', key: GLOBAL_KEY, max: 60, windowMinutes: 60 },
        { bucket: 'interest:ip', key: callerAddress(req.headers), max: 6, windowMinutes: 60 },
        { bucket: 'interest:email', key: email, max: 4, windowMinutes: 60 * 24 },
    ]);

    if (!verdict.ok) {
        await logError(
            verdict.hit && verdict.hit.startsWith('interest:all')
                ? '[interest] the SITE-WIDE interest limit was hit — somebody may be aiming at the '
                    + 'outbound email allowance'
                : '[interest] a registration was rate limited',
            { limit: verdict.hit, email, category },
            { path: 'interest' }
        );
        return NextResponse.json({
            ok: false,
            error: 'We have had a lot of interest just now. Please try again in a little while — '
                + 'nothing you typed has been lost.',
        }, { status: 429 });
    }
    if (verdict.hit === 'unreadable') {
        await logError(
            '[interest] the rate limit could not be read, so this registration was let through unchecked',
            null,
            { path: 'interest' }
        );
    }

    const admin = adminClient();

    // Spam-audit fields, never shown as contact detail.
    const ip = callerAddress(req.headers);
    const userAgent = (req.headers.get('user-agent') || '').slice(0, 400) || null;

    // Dedupe on (email, category): a repeat updates the existing row and does
    // NOT re-email the owner. Only a genuinely new registration is worth a
    // notification. The unique index makes the race safe — if two first-time
    // submissions land together, the second insert loses and falls to update.
    const { data: existing, error: findError } = await admin
        .from('interest_registrations')
        .select('id')
        .eq('email', email)
        .eq('category', category)
        .maybeSingle();

    if (findError) {
        await logError('[interest] could not look up an existing registration', { message: findError.message }, { path: 'interest' });
        return NextResponse.json({ ok: false, error: 'Something went wrong. Please try again.' }, { status: 500 });
    }

    let isNew = false;

    if (existing) {
        const { error: updateError } = await admin
            .from('interest_registrations')
            .update({ name, phone, region, notes, updated_at: new Date().toISOString(), ip, user_agent: userAgent })
            .eq('id', existing.id);
        if (updateError) {
            await logError('[interest] could not update a registration', { message: updateError.message }, { path: 'interest' });
            return NextResponse.json({ ok: false, error: 'Something went wrong. Please try again.' }, { status: 500 });
        }
    } else {
        const { error: insertError } = await admin
            .from('interest_registrations')
            .insert({ category, name, email, phone, region, notes, ip, user_agent: userAgent });
        if (insertError) {
            // 23505 = unique violation: a first-time submission raced another and
            // lost. Treat it as the repeat it effectively is — the row is there,
            // no email — rather than showing the visitor an error.
            if ((insertError as any).code === '23505') {
                await admin
                    .from('interest_registrations')
                    .update({ name, phone, region, notes, updated_at: new Date().toISOString(), ip, user_agent: userAgent })
                    .eq('email', email)
                    .eq('category', category);
            } else {
                await logError('[interest] could not store a registration', { message: insertError.message }, { path: 'interest' });
                return NextResponse.json({ ok: false, error: 'Something went wrong. Please try again.' }, { status: 500 });
            }
        } else {
            isNew = true;
        }
    }

    // Notify the owner — only on a genuinely new registration, so a repeat does
    // not spam the inbox. Sent to the same admin-alert address the services
    // alerts use; if it is unset the send is skipped and said out loud.
    if (isNew) {
        await notifyOwner({ category, name, email, phone, region, notes });
    }

    return NextResponse.json({ ok: true });
}

async function notifyOwner(r: {
    category: string; name: string; email: string;
    phone: string | null; region: string | null; notes: string | null;
}) {
    const to = recipients(process.env.SERVICES_ALERT_EMAIL);
    if (to.length === 0) {
        await logError(
            '[interest] a registration arrived but SERVICES_ALERT_EMAIL is unset, so nobody was told',
            { email: r.email, category: r.category },
            { path: 'interest' }
        );
        return;
    }

    const label = CATEGORY_LABEL[r.category as keyof typeof CATEGORY_LABEL] || r.category;
    const rows = [
        { label: 'Interested in', value: label },
        { label: 'Name', value: r.name },
        { label: 'Email', value: r.email },
        { label: 'Phone', value: r.phone || '—' },
        { label: 'Area', value: r.region ? (REGION_LABEL[r.region] || r.region) : '—' },
    ];
    const notesBlock = r.notes
        ? '<p style="margin:18px 0 0 0;"><strong>They said:</strong><br>'
            + escapeHtml(r.notes).replace(/\n/g, '<br>') + '</p>'
        : '';

    const html = emailLayout(
        '<h1 style="margin:0 0 6px 0;font-size:20px;">New interest — ' + escapeHtml(label) + '</h1>'
        + '<p style="margin:0 0 16px 0;color:#6b7280;">Someone registered their interest while sign-up is behind the coming-soon tiles.</p>'
        + detailRows(rows)
        + notesBlock,
        'You are getting this because you are the Galloway Getaways interest-list contact.'
    );

    await sendEmailToAll(to, 'New interest — ' + label + ': ' + r.name, html);
}
