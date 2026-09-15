import { requireAdmin } from '@/lib/access';
import { adminClient } from '@/lib/supabaseAdmin';
import { adminName } from '@/lib/utils';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import ReviewModerationRow from '@/components/admin/ReviewModerationRow';

export const dynamic = 'force-dynamic';

// Owner moderation for reviews of both kinds. Names are shown in full here —
// this is an admin screen and adminName ignores show_full_name on purpose.
// Taking one down is not gated behind the experiences flag: an abusive cottage
// review needs handling whether or not experiences are live.
export default async function AdminReviews({ searchParams }: { searchParams?: { show?: string } }) {
    await requireAdmin();
    const admin = adminClient();

    const showHidden = searchParams?.show === 'hidden';

    let query = admin
        .from('reviews')
        .select('id, review_type, rating, comment, created_at, reviewer_id, listing_id, provider_id, hidden_at, hidden_reason')
        .in('review_type', ['guest_to_host', 'guest_to_provider'])
        .order('created_at', { ascending: false })
        .limit(100);
    if (showHidden) query = query.not('hidden_at', 'is', null);

    const { data: reviews } = await query;
    const rows = reviews || [];

    // Resolve the names and subjects in batches, not per row.
    const reviewerIds = Array.from(new Set(rows.map((r) => r.reviewer_id)));
    const listingIds = Array.from(new Set(rows.map((r) => r.listing_id).filter(Boolean)));
    const providerIds = Array.from(new Set(rows.map((r) => r.provider_id).filter(Boolean)));

    const [{ data: profs }, { data: listings }, { data: providers }] = await Promise.all([
        reviewerIds.length ? admin.from('profiles').select('id, full_name, preferred_name, show_full_name').in('id', reviewerIds) : Promise.resolve({ data: [] }),
        listingIds.length ? admin.from('listings').select('id, title').in('id', listingIds) : Promise.resolve({ data: [] }),
        providerIds.length ? admin.from('service_providers').select('id, business_name').in('id', providerIds) : Promise.resolve({ data: [] }),
    ]);

    const nameById = new Map((profs || []).map((p) => [p.id, adminName(p, 'Guest')]));
    const listingById = new Map((listings || []).map((l) => [l.id, l.title as string]));
    const providerById = new Map((providers || []).map((p) => [p.id, p.business_name as string]));

    return (
        <div className="mx-auto max-w-3xl px-6 py-10">
            <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
                <ArrowLeft className="h-4 w-4" /> Owner tools
            </Link>
            <h1 className="mt-4 text-2xl font-bold text-slate-900">Reviews</h1>
            <p className="mb-6 mt-1 text-sm text-slate-500">
                The 100 most recent reviews of stays and experiences.{' '}
                <Link href={showHidden ? '/admin/reviews' : '/admin/reviews?show=hidden'} className="underline hover:text-slate-800">
                    {showHidden ? 'Show all' : 'Show only taken down'}
                </Link>
            </p>

            {rows.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
                    {showHidden ? 'Nothing has been taken down.' : 'No reviews yet.'}
                </p>
            ) : (
                <div className="space-y-3">
                    {rows.map((r) => (
                        <ReviewModerationRow
                            key={r.id}
                            review={{
                                id: r.id,
                                kind: r.review_type === 'guest_to_provider' ? 'Experience' : 'Stay',
                                subject: r.review_type === 'guest_to_provider'
                                    ? (r.provider_id && providerById.get(r.provider_id)) || 'Experience'
                                    : (r.listing_id && listingById.get(r.listing_id)) || 'Stay',
                                reviewer: nameById.get(r.reviewer_id) || 'Guest',
                                rating: Math.round(Number(r.rating)),
                                comment: r.comment,
                                when: r.created_at,
                                hiddenAt: r.hidden_at,
                                hiddenReason: r.hidden_reason,
                            }}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
