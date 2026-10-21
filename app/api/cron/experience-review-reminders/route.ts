import { greetingName } from '@/lib/utils';
import { adminClient } from '@/lib/supabaseAdmin';
import { londonDayKey, shiftDayKey } from '@/lib/dayKey';
import { NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email';
import { experienceReviewRequestEmail } from '@/lib/experienceReviewEmails';
import { recordCronRun } from '@/lib/cronHeartbeat';
import { guestExperiencesOpen } from '@/lib/serviceOrders';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const JOB = 'experience-review-reminders';

// Asking a guest to review an experience they have been on — the experience
// twin of /api/cron/review-reminders (a stay), the same shape and the same
// switch: one email per booking, never twice (sent_experience_review_reminders),
// never once they have reviewed it, never when review reminders are off in
// their notification settings, with the same unsubscribe link.
//
// Experiences dated 1 to 10 days ago: the day after (there is no journey home
// to wait out, as there is after a stay) up to ten days on. An experience
// review has no closing date (the gate in 20260915141500 has no upper bound),
// so — unlike the stay's email — this one quotes none.
//
// The confirmed, paid booking itself (not an add-places child row), the same
// rule the review gate and the review page apply: order_reviewable_by.
export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get('authorization');
    if (!secret || auth !== 'Bearer ' + secret) {
        return NextResponse.json({ ok: false, error: 'Unauthorised' }, { status: 401 });
    }

    // Experiences closed to guests: nothing was booked to review.
    if (!guestExperiencesOpen()) {
        await recordCronRun(JOB, true, 'experiences closed');
        return NextResponse.json({ ok: true, considered: 0, sent: 0, skipped: 0 });
    }

    const admin = adminClient();
    const today = londonDayKey();
    const from = shiftDayKey(today, -10);
    const to = shiftDayKey(today, -1);

    const { data: orders } = await admin
        .from('service_orders')
        .select('id, provider_id, guest_id, service_date')
        .eq('status', 'confirmed')
        .is('parent_order_id', null)
        .gte('service_date', from)
        .lte('service_date', to);

    let sent = 0;
    let skipped = 0;

    for (const o of orders || []) {
        try {
            if (!o.guest_id) { skipped++; continue; }

            // Already asked about this booking?
            const { data: already } = await admin
                .from('sent_experience_review_reminders')
                .select('order_id')
                .eq('order_id', o.id)
                .maybeSingle();
            if (already) { skipped++; continue; }

            // Already reviewed?
            const { data: review } = await admin
                .from('reviews')
                .select('id')
                .eq('order_id', o.id)
                .eq('reviewer_id', o.guest_id)
                .maybeSingle();
            if (review) { skipped++; continue; }

            // Review reminders switched off — the one switch for stays and experiences.
            const { data: prefs } = await admin
                .from('notification_preferences')
                .select('review_prompts, unsubscribe_token')
                .eq('user_id', o.guest_id)
                .maybeSingle();
            if (prefs && prefs.review_prompts === false) { skipped++; continue; }

            const { data: userRes } = await admin.auth.admin.getUserById(o.guest_id);
            const toEmail = (userRes && userRes.user && userRes.user.email) || '';
            if (!toEmail) { skipped++; continue; }

            const { data: guest } = await admin
                .from('profiles')
                .select('full_name, first_name, last_name, preferred_name')
                .eq('id', o.guest_id)
                .maybeSingle();
            const { data: provider } = await admin
                .from('service_providers')
                .select('business_name')
                .eq('id', o.provider_id)
                .maybeSingle();

            const { subject, html } = experienceReviewRequestEmail({
                orderId: o.id,
                title: (provider && provider.business_name) || '',
                guestFirst: greetingName(guest, 'there'),
                unsubscribeToken: (prefs && prefs.unsubscribe_token) || null,
            });

            const delivered = await sendEmail(toEmail, subject, html);
            if (delivered) {
                await admin.from('sent_experience_review_reminders').insert({ order_id: o.id });
                sent++;
            } else {
                skipped++;
            }
        } catch (err: any) {
            console.error('[experience-review-reminders] order', o.id, err && err.message);
            skipped++;
        }
    }

    await recordCronRun(JOB, true, 'considered=' + (orders || []).length + ' sent=' + sent + ' skipped=' + skipped);
    return NextResponse.json({ ok: true, considered: (orders || []).length, sent, skipped });
}

