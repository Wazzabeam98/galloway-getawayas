import Link from 'next/link';
import { adminClient } from '@/lib/supabaseAdmin';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { accessibleListings } from '@/lib/access';
import { resolveTemplate } from '@/lib/messageTemplates';
import type { ScopedTemplate } from '@/lib/messageTemplates';
import { formatUk } from '@/lib/cancellation';
import { AlertTriangle } from 'lucide-react';

// A guest arriving with no check-in message.
//
// The coverage grid in settings answers "is anything missing"; this answers
// "is it about to matter". They are different questions and only one of them
// is worth interrupting somebody with — a gap on a cottage with no bookings
// can wait, a gap on a cottage with someone arriving on Friday cannot, because
// that guest will turn up with no door code and no directions.
//
// Deliberately only about check-in details. The other three are courtesies; a
// missing check-in message leaves somebody standing outside a house.

const HORIZON_DAYS = 14;

export default async function TemplateGapWarning() {
    const supabase = createServerComponentClient({ cookies });
    const { data: auth } = await supabase.auth.getSession();

    if (!auth || !auth.session || !auth.session.user) return null;

    const uid = auth.session.user.id;

    try {
        const access = await accessibleListings(uid);
        const ownedIds = access.filter((a) => a.isOwner).map((a) => a.listingId);
        if (ownedIds.length === 0) return null;

        const admin = adminClient();

        const today = new Date().toISOString().split('T')[0];
        const horizon = new Date(Date.now() + HORIZON_DAYS * 86400000).toISOString().split('T')[0];

        const { data: arriving } = await admin
            .from('bookings')
            .select('id, listing_id, check_in')
            .in('listing_id', ownedIds)
            .eq('status', 'confirmed')
            .gte('check_in', today)
            .lte('check_in', horizon)
            .order('check_in', { ascending: true });

        if (!arriving || arriving.length === 0) return null;

        const { data: templates } = await admin
            .from('message_templates')
            .select('id, user_id, template_type, body, enabled, anchor, days_offset, send_hour, minutes_after, hours_after, hours_before, created_at')
            .eq('user_id', uid)
            .eq('template_type', 'checkin_details');

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

        // One entry per property, not per booking — five stays at the same
        // uncovered cottage is one thing to fix, not five.
        const uncovered: Record<string, string> = {};
        arriving.forEach((b: any) => {
            if (resolveTemplate(scoped, 'checkin_details', b.listing_id)) return;
            if (!uncovered[b.listing_id]) uncovered[b.listing_id] = b.check_in;
        });

        const listingIds = Object.keys(uncovered);
        if (listingIds.length === 0) return null;

        const { data: listings } = await admin
            .from('listings')
            .select('id, title')
            .in('id', listingIds);

        const titleOf: Record<string, string> = {};
        (listings || []).forEach((l: any) => { titleOf[l.id] = l.title || 'a property'; });

        return (
            <div className="max-w-7xl mx-auto px-6 pt-6">
                <div className="border border-amber-300 bg-amber-50 rounded-2xl p-5">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-amber-700 mt-0.5 shrink-0" />
                        <div>
                            <div className="font-semibold text-amber-900">
                                {listingIds.length === 1
                                    ? 'A guest is arriving with no check-in message set up'
                                    : listingIds.length + ' properties have guests arriving with no check-in message'}
                            </div>
                            <ul className="text-sm text-amber-800 mt-1 space-y-0.5">
                                {listingIds.map((id) => (
                                    <li key={id}>
                                        {titleOf[id]} &mdash; first arrival{' '}
                                        {formatUk(new Date(uncovered[id]))}
                                    </li>
                                ))}
                            </ul>
                            <p className="text-sm text-amber-800 mt-2">
                                They will not be sent the door code, directions or anything else
                                unless you message them yourself.
                            </p>
                            <Link
                                href="/account?section=messaging"
                                className="inline-block mt-3 px-4 py-2 bg-amber-700 hover:bg-amber-800 text-white text-sm font-semibold rounded-lg"
                            >
                                Set up a check-in message
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        );
    } catch (err) {
        // A missing warning is better than a dashboard that will not load.
        return null;
    }
}
