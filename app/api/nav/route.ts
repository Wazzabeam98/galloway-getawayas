import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { londonDayKey } from '@/lib/dayKey';
import { greetingName, getImageUrl } from '@/lib/utils';
import { resolveWorkMode } from '@/lib/workMode';
import { readWorkSide } from '@/lib/workSide';

export const dynamic = 'force-dynamic';

// The navbar's per-viewer data, read after the page has loaded.
//
// The navbar used to be an async SERVER component that read the session, the
// profile, the work side and a stay count on every request — which made every
// page (the layout wraps them all) render per-request and uncacheable. The
// public pages are now edge-cached, so the navbar renders a neutral shell on the
// server and the signed-in bits (Welcome, the avatar menu, the mode switch) are
// fetched here on the client and swapped in. No page's cached HTML carries one
// person's details. (components/base/NavUser.tsx is the caller.)
//
// This returns exactly what the old server navbar computed, so NavMenu /
// ModeSwitch / RememberAccount render identically to before.
export async function GET() {
    const supabase = createRouteHandlerClient({ cookies });
    const { data } = await supabase.auth.getUser();
    const user = data?.user;

    if (!user) {
        return NextResponse.json(
            { signedIn: false },
            // Per-viewer; never store it in a shared cache.
            { headers: { 'Cache-Control': 'private, no-store' } },
        );
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, first_name, last_name, preferred_name, avatar_url, is_admin')
        .eq('id', user.id)
        .single();

    // Your own name — always your real one. The privacy setting governs what
    // OTHER people see about you, not what you see about yourself.
    const firstName = greetingName(profile, '') || user.email?.split('@')[0] || null;

    const side = await readWorkSide(supabase, user.id);

    // Finished stays gate the passport link (a confirmed booking whose check-out
    // has passed), the same rule the passport page uses.
    const { count: stays } = await supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('guest_id', user.id)
        .eq('status', 'confirmed')
        .lt('check_out', londonDayKey());

    const mode = resolveWorkMode(cookies().get('gg_mode')?.value, side);

    return NextResponse.json(
        {
            signedIn: true,
            email: user.email ?? null,
            phone: user.phone ?? null,
            firstName,
            initial: firstName ? firstName.charAt(0).toUpperCase() : '',
            avatarKey: profile?.avatar_url || null,
            avatarUrl: profile?.avatar_url ? getImageUrl(profile.avatar_url) : null,
            isAdmin: profile?.is_admin === true,
            isHost: side.isHost,
            isProvider: side.isProvider,
            providerAudience: side.providerAudience,
            ownsAny: side.ownsAny,
            isFullAccessSomewhere: side.isFullAccessSomewhere,
            hostPerms: side.hostPerms,
            providerPerms: side.providerPerms,
            providerFullAccess: side.providerFullAccess,
            hasCompletedStay: (stays || 0) > 0,
            mode,
        },
        { headers: { 'Cache-Control': 'private, no-store' } },
    );
}
