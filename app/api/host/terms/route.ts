import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { HOST_TERMS_VERSION, hasAgreedToCurrentTerms } from '@/lib/hostTerms';

export const dynamic = 'force-dynamic';

// Whether the signed-in host has agreed to the current host terms, so the
// listing wizard knows whether to show the "I agree to the terms and
// conditions" box. The record itself (profiles.host_terms_version / _agreed_at)
// is server-only, so it's read here with the service role — for the verified
// caller only (getUser, not getSession).
export async function GET() {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

    const { data } = await adminClient()
        .from('profiles')
        .select('host_terms_version, host_terms_agreed_at')
        .eq('id', user.id)
        .maybeSingle();

    return NextResponse.json({
        ok: true,
        version: HOST_TERMS_VERSION,
        agreed: hasAgreedToCurrentTerms(data ? data.host_terms_version : null),
        agreedAt: (data && data.host_terms_agreed_at) || null,
    });
}
