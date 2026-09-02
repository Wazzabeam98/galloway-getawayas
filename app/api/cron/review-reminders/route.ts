import { townOf, townKey } from '@/lib/places';
import { adminClient } from '@/lib/supabaseAdmin';
import { londonDayKey, shiftDayKey } from '@/lib/dayKey';
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
    const today = londonDayKey();
    const from = shiftDayKey(today, -10);
    const to = shiftDayKey(today, -2);

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
                .select('title, location')
                .eq('id', b.listing_id)
                .maybeSingle();
            const listingTitle = escapeHtml((listing && listing.title) || 'your stay');

            // Their passport, as it stands after this stay. Worth mentioning
            // in the email they're already getting rather than sending a
            // second one nobody asked for.
            let stampHtml = '';

            try {
                const { data: pastStays } = await admin
                    .from('bookings')
                    .select('listing_id, check_out')
                    .eq('guest_id', b.guest_id)
                    .eq('status', 'confirmed')
                    .lte('check_out', b.check_out);

                const otherIds = Array.from(
                    new Set((pastStays || []).map((p: any) => p.listing_id))
                );

                const { data: theirListings } = otherIds.length
                    ? await admin.from('listings').select('id, location').in('id', otherIds)
                    : { data: [] };

                const locById: Record<string, string> = {};
                (theirListings || []).forEach((l: any) => {
                    locById[l.id] = l.location;
                });

                const townsBefore: Record<string, boolean> = {};
                const townsNow: Record<string, boolean> = {};

                (pastStays || []).forEach((p: any) => {
                    const key = townKey(locById[p.listing_id]);
                    if (!key) return;
                    townsNow[key] = true;
                    if (p.check_out < b.check_out) townsBefore[key] = true;
                });

                const thisTown = townOf(listing && listing.location);
                const isNewPlace = !townsBefore[townKey(listing && listing.location)];
                const total = Object.keys(townsNow).length;

                stampHtml =
                    '<div style="margin:24px 0;padding:16px 20px;border:2px dashed #a7f3d0;border-radius:12px;background:#ecfdf5;">'
                    + '<p style="margin:0 0 4px 0;font-size:15px;font-weight:700;color:#065f46;">'
                    + (isNewPlace ? 'New stamp: ' + escapeHtml(thisTown) : escapeHtml(thisTown) + ', again')
                    + '</p>'
                    + '<p style="margin:0;font-size:14px;color:#047857;">'
                    + (total === 1
                        ? 'That\u2019s your first stamp. There are a good few more places down here.'
                        : 'That\u2019s ' + total + ' places you\u2019ve stayed with us now.')
                    + '</p>'
                    + '</div>';
            } catch (err) {
                // A passport is a nice touch, not a reason to hold up the
                // review reminder.
            }

            const deadline = new Date(b.check_out);
            deadline.setDate(deadline.getDate() + 14);

            const html = emailLayout(
                '<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#111827;">How was ' + listingTitle + '?</h1>' +
                '<p style="margin:0 0 8px 0;">Hi ' + guestFirst + ' &mdash; hope you had a good stay in Dumfries &amp; Galloway.</p>' +
                '<p style="margin:0;">It takes about a minute: six quick star ratings and a sentence or two. Your review helps the next guest choose, and helps good hosts stand out.</p>' +
                button(SITE_URL + '/review/' + b.id, 'Leave your review') +
                stampHtml +
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
