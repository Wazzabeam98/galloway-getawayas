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

    // Hydrate the listings and the (signed-in) reporters by id, the same
    // bulk-fetch the chargebacks queue uses.
    const listingIds = Array.from(new Set(reports.map((r: any) => r.listing_id).filter(Boolean)));
    const { data: listings } = listingIds.length
        ? await admin.from('listings').select('id, title').in('id', listingIds)
        : { data: [] };
    const listingTitle: Record<string, string> = {};
    (listings || []).forEach((l: any) => { listingTitle[l.id] = l.title || 'Untitled listing'; });

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
                        return (
                            <div key={r.id} className="border border-slate-200 rounded-2xl p-6">
                                <div className="flex items-baseline justify-between gap-4 flex-wrap">
                                    <div className="font-bold text-slate-900">
                                        {reasonLabel(r.reason)}
                                    </div>
                                    <div className="text-sm text-slate-500">
                                        {formatUk(new Date(r.created_at))}
                                    </div>
                                </div>

                                <div className="text-sm text-slate-500 mt-1">
                                    {listingTitle[r.listing_id] || 'Listing'} &middot; reported by {who}
                                </div>

                                {r.details && (
                                    <p className="text-sm text-slate-700 mt-3 whitespace-pre-wrap">
                                        {r.details}
                                    </p>
                                )}

                                <div className="mt-5">
                                    <Link
                                        href={'/homes/' + r.listing_id}
                                        className="px-4 py-2 border border-slate-300 hover:border-slate-900 text-sm font-semibold rounded-lg"
                                    >
                                        Look at the listing
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
