import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { canWithdraw } from '@/lib/serviceEnquiries';

export const dynamic = 'force-dynamic';

// A host taking an enquiry back before anybody has answered it.
//
// A route rather than a browser write because `status` is not grantable to a
// signed-in user — the same reason accepting is not. What a host may write
// directly is `outcome`, and nothing else.
//
// The tradesman is not emailed about it. He was sent one message and the
// answer to it stopped mattering; a second message saying "ignore the first"
// is more of his evening than the withdrawal is worth.
export async function POST(req: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });

        const { data: auth } = await supabase.auth.getUser();
        if (!auth || !auth.user) {
            return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
        }

        const body = await req.json();
        const id = String(body.id || '');
        if (!id) {
            return NextResponse.json({ ok: false, error: 'Nothing to withdraw.' }, { status: 400 });
        }

        const admin = adminClient();

        const { data: enquiry } = await admin
            .from('service_enquiries')
            .select('id, host_id, status')
            .eq('id', id)
            .maybeSingle();

        if (!enquiry) {
            return NextResponse.json({ ok: false, error: 'No such enquiry.' }, { status: 404 });
        }
        if (enquiry.host_id !== auth.user.id) {
            return NextResponse.json({ ok: false, error: 'Not yours.' }, { status: 403 });
        }
        if (!canWithdraw(String(enquiry.status || ''))) {
            return NextResponse.json(
                { ok: false, error: 'That has already been answered.' },
                { status: 409 }
            );
        }

        const now = new Date().toISOString();

        // The token is cleared in the same statement. A withdrawn enquiry with
        // a live link in somebody's inbox is an accept waiting to happen.
        const { error } = await admin
            .from('service_enquiries')
            .update({
                status: 'withdrawn',
                withdrawn_at: now,
                updated_at: now,
                reply_token_hash: null,
            })
            .eq('id', id)
            .in('status', ['sent', 'viewed']);

        if (error) {
            return NextResponse.json({ ok: false, error: 'Could not withdraw that.' }, { status: 500 });
        }

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        await logError('service-enquiry-withdraw', err);
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}
