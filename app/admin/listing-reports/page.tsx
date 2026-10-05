export const dynamic = 'force-dynamic';

import { requireAdmin } from '@/lib/access';
import Link from 'next/link';
import { adminClient } from '@/lib/supabaseAdmin';
import { formatUk } from '@/lib/cancellation';
import { reasonLabel } from '@/lib/listingReports';
import { displayName } from '@/lib/utils';

// Listing reports — what guests and visitors have flagged about a listing.
//
// Sits beside the money queues (Chargebacks, Money disputes) and reads the
// service-role-only listing_reports table. Newest first: a report is a "go and
// look" nudge, not a deadline, so there is no urgency banner and nothing here
// sends anything. The listing links straight to its public page so you can see
// what they saw. The report is never shared with the host.

export default async function AdminListingReports() {
    await requireAdmin();
    const admin = adminClient();

    const { data: reportRows } = await admin
        .from('listing_reports')
        .select('*')
        .order('created_at', { ascending: false });

    const reports = reportRows || [];

    // Each report points at a listing, an experience or a trade. Legacy rows have
    // only listing_id; read it as a listing when target_type is absent.
    const targetOf = (r: any): { type: 'listing' | 'experience' | 'trade'; id: string } => ({
        type: (r.target_type || 'listing') as 'listing' | 'experience' | 'trade',
        id: r.target_id || r.listing_id || '',
    });

    // Hydrate the listings and the providers (experiences + trades are both rows
    // in service_providers) by id, plus the (signed-in) reporters.
    const listingIds = Array.from(new Set(reports.filter((r: any) => targetOf(r).type === 'listing').map((r: any) => targetOf(r).id).filter(Boolean)));
    const { data: listings } = listingIds.length
        ? await admin.from('listings').select('id, title').in('id', listingIds)
        : { data: [] };
    const listingTitle: Record<string, string> = {};
    (listings || []).forEach((l: any) => { listingTitle[l.id] = l.title || 'Untitled listing'; });

    const providerIds = Array.from(new Set(reports.filter((r: any) => targetOf(r).type !== 'listing').map((r: any) => targetOf(r).id).filter(Boolean)));
    const { data: providers } = providerIds.length
        ? await admin.from('service_providers').select('id, business_name, trade').in('id', providerIds)
        : { data: [] };
    const providerById: Record<string, any> = {};
    (providers || []).forEach((p: any) => { providerById[p.id] = p; });

    const reporterIds = Array.from(new Set(reports.map((r: any) => r.reporter_id).filter(Boolean)));
    const { data: reporters } = reporterIds.length
        ? await admin.from('profile_private').select('id, full_name, preferred_name, show_full_name').in('id', reporterIds)
        : { data: [] };
    const reporterById: Record<string, any> = {};
    (reporters || []).forEach((p: any) => { reporterById[p.id] = p; });

    return (
        <div className="max-w-3xl mx-auto px-6 py-10">
            <Link href="/admin" className="text-sm text-slate-500 hover:underline">
                &larr; Owner tools
            </Link>

            <h1 className="text-2xl font-bold text-slate-900 mt-4 mb-1">Listing reports</h1>
            <p className="text-sm text-slate-500 mb-8">
                What guests and visitors have flagged about a listing. Never shared with the host.
            </p>

            {reports.length === 0 ? (
                <div className="border rounded-2xl p-10 text-center">
                    <h2 className="font-semibold text-slate-800">No reports</h2>
                    <p className="text-sm text-slate-500 mt-1">
                        You&apos;ll get an email the moment one comes in.
                    </p>
                </div>
            ) : (
                <div className="space-y-5">
                    {reports.map((r: any) => {
                        const who = r.reporter_id
                            ? displayName(reporterById[r.reporter_id], 'A signed-in guest')
                            : 'A signed-out visitor';
                        const target = targetOf(r);
                        const prov = providerById[target.id];
                        const typeTag = target.type === 'experience' ? 'Experience' : target.type === 'trade' ? 'Trade' : 'Listing';
                        const name = target.type === 'listing'
                            ? (listingTitle[target.id] || 'Listing')
                            : (prov ? prov.business_name : (typeTag));
                        const href = target.type === 'listing'
                            ? '/homes/' + target.id
                            : target.type === 'experience'
                                ? '/experiences/browse/' + target.id
                                : '/services/' + (prov ? prov.trade : '') + '/' + target.id;
                        const linkLabel = target.type === 'listing'
                            ? 'Look at the listing'
                            : target.type === 'experience'
                                ? 'Look at the experience'
                                : 'Look at the trade profile';
                        return (
                            <div key={r.id} className="border border-slate-200 rounded-2xl p-6">
                                <div className="flex items-baseline justify-between gap-4 flex-wrap">
                                    <div className="font-bold text-slate-900">
                                        {reasonLabel(r.reason, targetOf(r).type)}
                                    </div>
                                    <div className="text-sm text-slate-500">
                                        {formatUk(new Date(r.created_at))}
                                    </div>
                                </div>

                                <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
                                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                                        {typeTag}
                                    </span>
                                    <span>{name} &middot; reported by {who}</span>
                                </div>

                                {r.details && (
                                    <p className="text-sm text-slate-700 mt-3 whitespace-pre-wrap">
                                        {r.details}
                                    </p>
                                )}

                                <div className="mt-5">
                                    <Link
                                        href={href}
                                        className="px-4 py-2 border border-slate-300 hover:border-slate-900 text-sm font-semibold rounded-lg"
                                    >
                                        {linkLabel}
                                    </Link>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
