import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ownsListing } from '@/lib/access';

export const dynamic = 'force-dynamic';

// Is the signed-in viewer the host (owner) of this listing? The listing page is
// edge-cached and the same for everyone, so the per-viewer "show the host their
// inline review reply box" decision is made here, after load (components/
// ReviewReply.tsx). Owner-only, matching the page's old `viewer?.id ===
// home.host_id` check. Never cached (per-viewer).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
    const supabase = createRouteHandlerClient({ cookies });
    const { data } = await supabase.auth.getUser();
    if (!data?.user) {
        return NextResponse.json({ isHost: false }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const isHost = await ownsListing(data.user.id, params.id).catch(() => false);
    return NextResponse.json({ isHost }, { headers: { 'Cache-Control': 'private, no-store' } });
}
