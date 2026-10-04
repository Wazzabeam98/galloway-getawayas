import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { setOwnerPaused } from '@/lib/providerTakedown';

export const dynamic = 'force-dynamic';

// A provider taking their own listing down, or putting it back up — the
// "Take it down" / "Put it back up" control in both editors (experiences and
// trades). No reason asked for and no review on the way back: it's theirs.
//
// For a trade on the £20 plan this also pauses their subscription billing while
// the listing is down, and resumes it when it goes back up (lib/providerBilling).
//
// Service role, because owner_paused is not in the browser's write allow-list;
// the ownership check below is the gate. Nothing here touches an order, an
// enquiry or a job — those carry on.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const body = await request.json().catch(() => ({}));
        const providerId = String((body && body.providerId) || '');
        const paused = !!(body && body.paused === true);

        const admin = adminClient();
        const { data: p } = await admin
            .from('service_providers')
            .select('id, owner_id, status')
            .eq('id', providerId)
            .maybeSingle();
        if (!p || p.owner_id !== user.id) {
            return NextResponse.json({ ok: false, error: 'Not your listing' }, { status: 403 });
        }
        // Only a live listing has anything to take down; a draft or an
        // application isn't on the site yet.
        if (p.status !== 'approved') {
            return NextResponse.json({ ok: false, error: 'Your listing isn’t live yet.' }, { status: 400 });
        }

        const result = await setOwnerPaused(admin, providerId, paused);
        if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
        return NextResponse.json({ ok: true, paused, billing: result.billing || null });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: (err && err.message) || 'Could not save' }, { status: 500 });
    }
}
