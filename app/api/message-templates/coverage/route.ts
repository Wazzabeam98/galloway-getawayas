import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { accessibleListings } from '@/lib/access';
import { coverage, hasScopeClash } from '@/lib/messageTemplates';
import type { ScopedTemplate } from '@/lib/messageTemplates';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

// Which of a host's messages cover which of their properties.
//
// With one template per type this question did not exist — everything covered
// everything. Now that a template can be scoped, the obvious mistake is to
// narrow the catch-all to two cottages and forget the third, and the third
// then silently gets no check-in message at all. A host with three properties
// and four kinds of message is looking at twelve answers; the one that matters
// is the empty one, and they should see it rather than work it out.

// Not exported: a Next route file may only export route handlers and a few
// known config fields, and exporting anything else fails the build.
const TEMPLATE_TYPES = [
    { key: 'booking_confirmation', label: 'Booking confirmation' },
    { key: 'checkin_details', label: 'Check-in details' },
    { key: 'checkin_day', label: 'Checking in with guest' },
    { key: 'checkout_details', label: 'Check-out details' },
];

export async function GET() {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { session } } = await supabase.auth.getSession();

        if (!session || !session.user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const uid = session.user.id;
        const admin = adminClient();

        // Their own properties only. A co-host does not own the templates, so
        // a coverage grid across somebody else's listings would be answering a
        // question they cannot act on.
        const access = await accessibleListings(uid);
        const ownedIds = access.filter((a) => a.isOwner).map((a) => a.listingId);

        if (ownedIds.length === 0) {
            return NextResponse.json({ ok: true, listings: [], types: TEMPLATE_TYPES, cells: [] });
        }

        const { data: listings } = await admin
            .from('listings')
            .select('id, title, status')
            .in('id', ownedIds)
            .order('created_at', { ascending: true });

        const { data: templates } = await admin
            .from('message_templates')
            .select('id, user_id, template_type, body, enabled, anchor, days_offset, send_hour, minutes_after, hours_after, hours_before, created_at')
            .eq('user_id', uid);

        const rows = templates || [];

        const { data: scopes } = rows.length
            ? await admin
                .from('message_template_listings')
                .select('template_id, listing_id')
                .in('template_id', rows.map((t: any) => t.id))
            : { data: [] };

        const scopeOf: Record<string, string[]> = {};
        (scopes || []).forEach((r: any) => {
            if (!scopeOf[r.template_id]) scopeOf[r.template_id] = [];
            scopeOf[r.template_id].push(r.listing_id);
        });

        const scoped: ScopedTemplate[] = rows.map((t: any) => ({
            ...t,
            listingIds: scopeOf[t.id] || [],
        }));

        const visible = (listings || []).filter((l: any) => l.status !== 'draft');
        const types = TEMPLATE_TYPES.map((t) => t.key);

        const cells = coverage(scoped, visible.map((l: any) => l.id), types).map((c) => ({
            ...c,
            // The database refuses this, so it should never appear. Reported
            // rather than assumed away, because a row predating the constraint
            // would otherwise be silently resolved and never questioned.
            clash: hasScopeClash(scoped, c.templateType, c.listingId),
        }));

        return NextResponse.json({
            ok: true,
            listings: visible.map((l: any) => ({ id: l.id, title: l.title || 'Untitled listing' })),
            types: TEMPLATE_TYPES,
            cells: cells,
        });
    } catch (err: any) {
        await logError('[message-templates/coverage] ' + ((err && err.message) || 'failed'), err, {
            path: 'message-templates/coverage',
        });
        return NextResponse.json({ ok: false, error: 'Could not work out your coverage' }, { status: 500 });
    }
}
