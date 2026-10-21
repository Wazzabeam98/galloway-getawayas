import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { sendEmail } from '@/lib/email';
import { firstName } from '@/lib/utils';
import { logError } from '@/lib/logError';
import { experienceReviewReceivedEmail } from '@/lib/experienceReviewEmails';
import { reviewSubmissionProblem } from '@/lib/experienceReviewRules';

export const dynamic = 'force-dynamic';

// A guest posting their review of an experience — and the provider hearing
// about it.
//
// The review used to be inserted straight from the browser, so nothing on the
// server knew a review had arrived and the provider was never emailed. The
// insert now comes here, but it is still made with the GUEST'S OWN client: the
// row policy ("Guests can review after a completed experience",
// order_reviewable_by) and the window trigger decide exactly what they did
// before — this route adds no permission. Only once the insert succeeds is the
// provider emailed, at their contact address (co-hosts with the messages
// permission get copies through the email layer's team rule), with the review
// and a link to their Reviews page to reply.
//
// The email carries no push of its own: the reviews trigger (queue_review_push)
// already tells the owner "You have a new review", now opening their Reviews.
export async function POST(req: Request) {
    let userId: string | null = null;
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Sign in to leave a review.' }, { status: 401 });
        userId = user.id;

        const body = await req.json().catch(() => ({}));
        const orderId = String((body && body.orderId) || '');
        const rating = Number(body && body.rating);
        const comment = String((body && body.comment) || '').trim();
        const problem = reviewSubmissionProblem(orderId, rating, comment);
        if (problem) return NextResponse.json({ ok: false, error: problem }, { status: 400 });

        // As the guest: the policy and the trigger are the gate, exactly as before.
        const { error } = await supabase.from('reviews').insert({
            order_id: orderId,
            reviewer_id: user.id,
            review_type: 'guest_to_provider',
            rating,
            comment,
        });
        if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

        // Saved. Tell the provider — best effort: the review stands either way.
        try {
            const admin = adminClient();
            const { data: order } = await admin.from('service_orders').select('provider_id').eq('id', orderId).maybeSingle();
            const { data: provider } = order && order.provider_id
                ? await admin.from('service_providers').select('business_name, contact_email').eq('id', order.provider_id).maybeSingle()
                : { data: null as any };
            const { data: reviewer } = await admin.from('profiles')
                .select('full_name, first_name, last_name, preferred_name, show_full_name').eq('id', user.id).maybeSingle();
            if (provider && provider.contact_email) {
                const { subject, html } = experienceReviewReceivedEmail({
                    title: provider.business_name || '',
                    reviewerFirst: firstName(reviewer as any, 'A guest'),
                    rating,
                    comment,
                });
                await sendEmail(String(provider.contact_email), subject, html, false);
            }
        } catch (mailErr: any) {
            await logError('experience review: the provider could not be told', String((mailErr && mailErr.message) || mailErr), { path: '/api/services/reviews', userId: user.id });
        }

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        await logError('experience review could not be saved', String((err && err.message) || err), { path: '/api/services/reviews', userId: userId || undefined });
        return NextResponse.json({ ok: false, error: 'We couldn’t post your review. Try again.' }, { status: 500 });
    }
}
