import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { revalidateListing, revalidateExperience } from '@/lib/revalidatePublic';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

// Saving the admin "Arrange listings" order (app/admin/arrange).
//
// A route, not a browser write, for the reason every admin write here is: the
// decision is checked against `is_admin` on the SERVER and the write goes through
// the service role. display_order is granted to no browser role for writing
// (listings-writable-columns-guard / provider-writable-columns-guard mark it
// PLATFORM_ONLY), so there is nowhere else it CAN be done — exactly the point.
//
// The body is { kind, order }: `kind` is 'listings' or 'experiences', `order` is
// the ids top-to-bottom. We write display_order = 1..N down that list, scoped to
// the rows that actually belong on the grid (published cottages;
// guest-audience providers), so a stale or wrong id in the list simply updates
// nothing. Then we bust the home page's 5-minute cache by tag, so a saved order
// shows on the home page straight away rather than up to five minutes later.
export async function POST(req: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });

        // getUser() asks the auth server; getSession() would only decode the
        // cookie, so anyone could claim to be an admin by editing it.
        const { data: auth } = await supabase.auth.getUser();
        if (!auth || !auth.user) {
            return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
        }

        const admin = adminClient();

        const { data: me } = await admin
            .from('profiles')
            .select('is_admin')
            .eq('id', auth.user.id)
            .maybeSingle();

        if (!me || me.is_admin !== true) {
            return NextResponse.json({ ok: false, error: 'Not allowed.' }, { status: 403 });
        }

        const body = await req.json().catch(() => ({}));
        const kind = String((body as any).kind || '');
        const order = Array.isArray((body as any).order) ? (body as any).order : null;

        if (kind !== 'listings' && kind !== 'experiences') {
            return NextResponse.json({ ok: false, error: 'Unknown kind.' }, { status: 400 });
        }
        if (!order) {
            return NextResponse.json({ ok: false, error: 'No order given.' }, { status: 400 });
        }

        // Clean the list: strings, de-duplicated, keeping the first position of
        // each id. A list that is empty after cleaning is a bad request.
        const seen = new Set<string>();
        const ids: string[] = [];
        for (const raw of order) {
            const id = typeof raw === 'string' ? raw.trim() : '';
            if (id && !seen.has(id)) { seen.add(id); ids.push(id); }
        }
        if (!ids.length) {
            return NextResponse.json({ ok: false, error: 'No order given.' }, { status: 400 });
        }

        const table = kind === 'listings' ? 'listings' : 'service_providers';
        // Scope every write to rows that actually belong on the grid, so a stale
        // id (a since-unpublished cottage, a since-declined provider) updates
        // nothing rather than being hidden with a low number. The experiences
        // grid is guest-audience providers (lib/experiencesData).
        const scope = (q: any) => kind === 'listings'
            ? q.eq('status', 'published')
            : q.eq('audience', 'guest');

        // 1..N down the list. Sequential is fine at this scale (a soft launch is
        // ~10 properties; the grids are tens of rows, not thousands).
        for (let i = 0; i < ids.length; i++) {
            const { error } = await scope(
                admin.from(table).update({ display_order: i + 1 }).eq('id', ids[i]),
            );
            if (error) throw error;
        }

        // Refresh every public grid that shows this order at once, rather than
        // waiting for the background rebuild: the home page, the area pages and
        // the experiences browse page (lib/revalidatePublic). No id — a reorder
        // changes the grids, not any individual listing/experience page.
        if (kind === 'listings') revalidateListing();
        else revalidateExperience();

        return NextResponse.json({ ok: true, count: ids.length });
    } catch (err: any) {
        await logError('admin-arrange', err).catch(() => {});
        return NextResponse.json({ ok: false, error: 'Could not save the order.' }, { status: 500 });
    }
}
