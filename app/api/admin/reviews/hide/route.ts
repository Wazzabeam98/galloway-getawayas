import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { isAdmin, cleanReason } from '@/lib/adminAudit';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

// Take a review down, or put it back.
//
// This is the missing moderation control for BOTH kinds of review — a cottage
// stay review and a guest-experience review. It is deliberately NOT behind the
// GUEST_EXPERIENCES_OPEN flag: an abusive cottage review needs taking down
// whether or not experiences are live.
//
// hidden_at is the single lever every public read policy respects (see
// 20260915141500_reviews_for_guest_experiences.sql), so setting it here removes
// the review for guests and for the provider/host alike — not merely filtered in
// one query. The write goes through the service role, which is why is_published
// and hidden_at are never granted to a browser: the only hand that can hide or
// unhide a review is an admin's, through this route.
//
// A takedown is reversible: unhiding clears the three fields.

export async function POST(req: Request) {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) {
        return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
    }
    if (!(await isAdmin(auth.user.id))) {
        return NextResponse.json({ ok: false, error: 'Not allowed.' }, { status: 403 });
    }

    let body: any;
    try { body = await req.json(); } catch { body = {}; }
    const reviewId = typeof body.reviewId === 'string' ? body.reviewId : '';
    const hide = body.hidden !== false; // default to hiding
    if (!reviewId) {
        return NextResponse.json({ ok: false, error: 'Which review?' }, { status: 400 });
    }

    const reason = cleanReason(body.reason);
    if (hide && !reason) {
        return NextResponse.json({ ok: false, error: 'A reason is required to take a review down.' }, { status: 400 });
    }

    const admin = adminClient();
    const patch = hide
        ? { hidden_at: new Date().toISOString(), hidden_reason: reason, hidden_by: auth.user.id }
        : { hidden_at: null, hidden_reason: null, hidden_by: null };

    const { error } = await admin.from('reviews').update(patch).eq('id', reviewId);
    if (error) {
        await logError('admin/reviews/hide: could not update the review', error, {
            path: '/api/admin/reviews/hide', userId: auth.user.id,
        });
        return NextResponse.json({ ok: false, error: 'Could not update that review.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, hidden: hide });
}
