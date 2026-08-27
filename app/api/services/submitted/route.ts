import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { announceSubmission } from '@/lib/serviceSubmittedAlert';

export const dynamic = 'force-dynamic';

// Telling us a business is waiting, for somebody who is signed in.
//
// An existing provider editing or re-sending their listing writes it straight
// from the browser, so there is no server step in that to hang the alert off —
// hence a route the page calls once the row and its areas are saved.
//
// A FIRST application does not come through here. It has no session to
// authenticate: the account is made in the same request. That is
// /api/services/apply, and both call announceSubmission so there is one
// implementation of what the alert says.
//
// Where it goes is an environment variable, not a constant: the address can
// change without a deploy, and a missing one is loud rather than silent.
export async function POST(req: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });

        // getUser() asks the auth server. getSession() would only decode the
        // cookie, so anyone could claim to be anyone by editing it.
        const { data: auth } = await supabase.auth.getUser();
        if (!auth || !auth.user) {
            return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
        }

        const body = await req.json();
        const id = String(body.id || '');
        if (!id) {
            return NextResponse.json({ ok: false, error: 'Nothing to announce.' }, { status: 400 });
        }

        const admin = adminClient();

        const { data: provider } = await admin
            .from('service_providers')
            .select('id, owner_id, business_name, logo, trade, description, audience, photos, contact_email, contact_phone, status, declined_at, approved_digest, changes_pending_at, does_gas, does_oil')
            .eq('id', id)
            .maybeSingle();

        if (!provider) {
            return NextResponse.json({ ok: false, error: 'No such business.' }, { status: 404 });
        }

        // Their own row only. Without this, a signed-in stranger could make us
        // email ourselves about somebody else's application.
        if (provider.owner_id !== auth.user.id) {
            return NextResponse.json({ ok: false, error: 'Not yours.' }, { status: 403 });
        }

        const result = await announceSubmission(provider);
        return NextResponse.json(result);
    } catch (err: any) {
        await logError('service-provider-submitted', err);
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}
