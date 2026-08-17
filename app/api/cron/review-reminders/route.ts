import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import {
    sendEmail,
    emailLayout,
    escapeHtml,
    formatDate,
    button,
    SITE_URL,
} from '@/lib/email';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function adminClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );
}

export async function GET(request: Request) {
    // Vercel Cron sends the secret as a bearer token. Without this, anyone
    // who finds the URL could fire off a round of emails.
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get('authorization');

    if (!secret || auth !== 'Bearer ' + secret) {
        return NextResponse.json({ ok: false, error: 'Unauthorised' }, { status: 401 });
    }

    const admin = adminClient();

    // Stays that finished 2 to 10 days ago. Two days gives people time to
    // get home; ten leaves a few days of the 14 day window to act on it.
    const today = new Date();
    const from = new Date(today.getTime() - 10 * 86400000).toISOString().split('T')[0];
    const to = new Date(today.getTime() - 2 * 86400000).toISOString().split('T')[0];

    const { data: bookings } = await admin
        .from('bookings')
        .select('id, listing_id, guest_id, host_id, check_in, check_out')
        .eq('status', 'confirmed')
        .gte('check_out', from)
        .lte('check_out', to);

    let sent = 0;
    let skipped = 0;

    for (const b of bookings || []) {
        try {
            // Already nudged for this stay?
            const { data: already } = await admin
                .from('sent_review_reminders')
                .select('booking_id')
                .eq('booking_id', b.id)
                .maybeSingle();
            if (already) { skipped++; continue; }

            // Already reviewed?
            const { data: review } = await admin
                .from('reviews')
                .select('id')
                .eq('booking_id', b.id)
                .eq('reviewer_id', b.guest_id)
                .maybeSingle();
            if (review) { skipped++; continue; }

            // Opted out of review reminders?
            const { data: prefs } = await admin
                .from('notification_preferences')
                .select('review_prompts, unsubscribe_token')
                .eq('user_id', b.guest_id)
                .maybeSingle();
            if (prefs && prefs.review_prompts === false) { skipped++; continue; }

            const { data: userRes } = await admin.auth.admin.getUserById(b.guest_id);
            const to_email = (userRes && userRes.user && userRes.user.email) || '';
            if (!to_email) { skipped++; continue; }

            const { data: guest } = await admin
                .from('profiles')
                .select('full_name, preferred_name')
                .eq('id', b.guest_id)
                .maybeSingle();
            const guestFirst = escapeHtml(
                (((guest && (guest.preferred_name || guest.full_name)) || 'there').trim().split(' ')[0]) || 'there'
            );

            const { data: listing } = await admin
                .from('listings')
                .select('title')
                .eq('id', b.listing_id)
                .maybeSingle();
            const listingTitle = escapeHtml((listing && listing.title) || 'your stay');

            const deadline = new Date(b.check_out);
            deadline.setDate(deadline.getDate() + 14);

            const html = emailLayout(
                '<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#111827;">How was ' + listingTitle + '?</h1>' +
                '<p style="margin:0 0 8px 0;">Hi ' + guestFirst + ' &mdash; hope you had a good stay in Dumfries &amp; Galloway.</p>' +
                '<p style="margin:0;">It takes about a minute: six quick star ratings and a sentence or two. Your review helps the next guest choose, and helps good hosts stand out.</p>' +
                button(SITE_URL + '/review/' + b.id, 'Leave your review') +
                '<p style="margin:0;font-size:14px;color:#6b7280;">Reviews close on ' +
                escapeHtml(formatDate(deadline.toISOString())) +
                '. Yours stays hidden until your host has reviewed you too, so neither of you sees the other\u2019s first.</p>',
                "You're receiving this because review reminders are switched on in your notification settings.",
                prefs && prefs.unsubscribe_token
                    ? SITE_URL + '/unsubscribe?token=' + prefs.unsubscribe_token + '&type=review_prompts'
                    : undefined
            );

            const delivered = await sendEmail(
                to_email,
                'How was your stay at ' + ((listing && listing.title) || 'Galloway Getaways') + '?',
                html
            );

            if (delivered) {
                await admin.from('sent_review_reminders').insert({ booking_id: b.id });
                sent++;
            } else {
                skipped++;
            }
        } catch (err: any) {
            console.error('[review-reminders] booking', b.id, err && err.message);
            skipped++;
        }
    }

    return NextResponse.json({ ok: true, considered: (bookings || []).length, sent, skipped });
}
