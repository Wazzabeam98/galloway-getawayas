import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { sendEmail } from '@/lib/email';
import { firstName } from '@/lib/utils';
import { logError } from '@/lib/logError';
import { stayReviewReceivedEmail } from '@/lib/stayReviewEmails';

export const dynamic = 'force-dynamic';

const RATING_KEYS = ['cleanliness_rating', 'accuracy_rating', 'checkin_rating', 'communication_rating', 'location_rating', 'value_rating'] as const;

// A guest posting their review of a stay — and the host hearing about it. The
// stay twin of /api/services/reviews.
//
// The review used to be inserted straight from the browser, so nothing on the
// server knew a review had arrived and the host only got the push the reviews
// trigger sends. The insert now comes here, but it is still made with the
// GUEST'S OWN client: the row policy and check_review_window (a confirmed stay
// of their own, inside 14 days of check-out) decide exactly what they did
// before — this route adds no permission. Only once the insert succeeds is the
// host emailed, with copies to co-hosts holding the messages permission (the
// people who can read and reply to the listing's reviews).
//
// The email carries no push of its own: the reviews trigger (queue_review_push)
// already tells the host "You have a new review".
export async function POST(req: Request) {
    let userId: string | null = null;
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Sign in to leave a review.' }, { status: 401 });
        userId = user.id;

        const body = await req.json().catch(() => ({}));
        const bookingId = String((body && body.bookingId) || '');
        const comment = String((body && body.comment) || '').trim();
        const ratings: Record<string, number> = {};
        for (const k of RATING_KEYS) {
            const v = Number(body && body[k]);
            if (!Number.isInteger(v) || v < 1 || v > 5) return NextResponse.json({ ok: false, error: 'Rate every part of your stay.' }, { status: 400 });
            ratings[k] = v;
        }
        if (!bookingId) return NextResponse.json({ ok: false, error: 'That booking couldn’t be found.' }, { status: 400 });
        if (comment.length < 10) return NextResponse.json({ ok: false, error: 'Write a sentence or two about it.' }, { status: 400 });
        const rating = Number((RATING_KEYS.reduce((sum, k) => sum + ratings[k], 0) / RATING_KEYS.length).toFixed(2));

        // The booking's listing and host, read as the guest: the same row the
        // review page read, and the same values the browser used to send.
        const { data: booking } = await supabase.from('bookings').select('id, listing_id, host_id').eq('id', bookingId).maybeSingle();
        if (!booking) return NextResponse.json({ ok: false, error: 'That booking couldn’t be found.' }, { status: 400 });

        // As the guest: the policy and the trigger are the gate, exactly as before.
        const { error } = await supabase.from('reviews').insert({
            booking_id: booking.id,
            listing_id: booking.listing_id,
            reviewer_id: user.id,
            reviewee_id: booking.host_id,
            review_type: 'guest_to_host',
            rating,
            comment,
            ...ratings,
        });
        if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

        // Saved. Tell the host and their messages co-hosts — best effort: the
        // review stands either way.
        try {
            const admin = adminClient();
            const [{ data: saved }, { data: listing }, { data: host }, { data: reviewer }, { data: cohosts }] = await Promise.all([
                admin.from('reviews').select('is_published').eq('booking_id', booking.id).eq('reviewer_id', user.id).eq('review_type', 'guest_to_host').maybeSingle(),
                admin.from('listings').select('title').eq('id', booking.listing_id).maybeSingle(),
                admin.auth.admin.getUserById(booking.host_id),
                admin.from('profiles').select('full_name, first_name, last_name, preferred_name, show_full_name').eq('id', user.id).maybeSingle(),
                admin.from('listing_access').select('email, user_id').eq('listing_id', booking.listing_id).eq('status', 'active').eq('can_messages', true),
            ]);
            const { subject, html } = stayReviewReceivedEmail({
                title: (listing && listing.title) || '',
                reviewerFirst: firstName(reviewer as any, 'Your guest'),
                rating,
                comment,
                published: !!(saved && saved.is_published),
            });
            const to = new Set<string>();
            const hostEmail = String((host && host.user && host.user.email) || '').trim().toLowerCase();
            if (hostEmail) to.add(hostEmail);
            for (const c of cohosts || []) {
                const e = String((c && c.email) || '').trim().toLowerCase();
                if (c && c.user_id && e) to.add(e);
            }
            for (const address of Array.from(to)) await sendEmail(address, subject, html, false);
        } catch (mailErr: any) {
            await logError('stay review: the host could not be told', String((mailErr && mailErr.message) || mailErr), { path: '/api/reviews', userId: user.id });
        }

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        await logError('stay review could not be saved', String((err && err.message) || err), { path: '/api/reviews', userId: userId || undefined });
        return NextResponse.json({ ok: false, error: 'We couldn’t post your review. Try again.' }, { status: 500 });
    }
}
