export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import BusinessSwitcher from '@/components/services/BusinessSwitcher';
import { BUSINESS_COOKIE, dashboardProviders, pickDashboardProvider, firstProviderPageFor } from '@/lib/providerAccess';
import { loadExperienceReviews } from '@/lib/experienceReviews';
import ReviewStars from '@/components/ReviewStars';
import ProviderReplyBox from '@/components/marketplace/ProviderReplyBox';
import { capitializeFirst } from '@/lib/utils';
import { ukDate, londonDayKey } from '@/lib/dayKey';

export const metadata = {
    title: 'Reviews',
    robots: { index: false, follow: false },
};

// A guest-experience provider's Reviews — the twin of the holiday-let host's
// /dashboard/reviews, reached from the same place in the same hosting menu.
// What guests wrote about the experience, newest first, each with the one
// public reply (ProviderReplyBox, the same box the listing page shows the
// provider). The same reviews as the public page: published and not taken down
// (lib/experienceReviews). The reply is written by the browser under the reviews
// reply policy (the provider the review is about, or a co-host with messages).
//
// The owner, or a co-host with the messages permission (which is what the
// reply policy asks) — lib/providerAccess, as every dashboard page.
export default async function ProviderReviewsPage() {
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/');

    const admin = adminClient();
    const { rows, access } = await dashboardProviders(admin, user.id, 'can_messages', 'id, business_name, audience, status');
    const guests = (rows as any[]).filter((r) => r.audience === 'guest');
    const provider: any = pickDashboardProvider(guests, access, cookies().get(BUSINESS_COOKIE)?.value);
    if (!provider) redirect((await firstProviderPageFor(user.id)) || '/services/dashboard');
    const switchable = guests.map((r: any) => ({ id: r.id, name: r.business_name || 'Your business' }));

    const reviews = await loadExperienceReviews(admin, provider.id, user.id);
    const who = capitializeFirst(reviews.providerFirstName);

    return (
        <div className="mx-auto max-w-3xl px-6 py-10">
            <h1 className="text-2xl font-bold text-slate-900 md:text-3xl">Reviews</h1>
            <p className="mt-1 text-sm text-slate-500">{provider.business_name}</p>
            <BusinessSwitcher options={switchable} current={provider.id} className="mt-2" />

            {reviews.count === 0 ? (
                <div className="mt-8 rounded-2xl border border-slate-200 p-6 text-center">
                    <p className="font-semibold text-slate-900">No reviews yet</p>
                    <p className="mt-1 text-sm text-slate-600">
                        {provider.status === 'approved'
                            ? 'Guests can review your experience after they’ve been. Their reviews will appear here, and you can reply to each one.'
                            : 'Once your experience is live and guests have been, their reviews will appear here, and you can reply to each one.'}
                    </p>
                </div>
            ) : (
                <>
                    <div className="mt-6 flex items-center gap-2 text-slate-700">
                        {reviews.avg != null ? (
                            <>
                                <ReviewStars value={reviews.avg} size={16} />
                                <span className="font-semibold">{reviews.avg.toFixed(2)}</span>
                                <span className="text-slate-400">·</span>
                            </>
                        ) : null}
                        <span>{reviews.count} review{reviews.count === 1 ? '' : 's'}</span>
                    </div>
                    <div className="mt-6 space-y-4">
                        {reviews.items.map((r) => (
                            <div key={r.id} className="rounded-2xl border border-slate-200 p-5">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-semibold text-slate-900">{capitializeFirst(r.firstName || 'Guest')}</span>
                                    <ReviewStars value={r.rating} size={14} />
                                    {r.itemName ? (
                                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{r.itemName}</span>
                                    ) : null}
                                    {r.when ? <span className="text-xs text-slate-400">{ukDate(londonDayKey(new Date(r.when)))}</span> : null}
                                </div>
                                <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-slate-700">{r.comment}</p>
                                <ProviderReplyBox reviewId={r.id} existingReply={r.reply} providerFirstName={who} canReply={reviews.canReply} />
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
