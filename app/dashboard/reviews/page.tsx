'use client';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import Logo from '@/components/base/Logo';
import LoginModel from '@/components/auth/LoginModel';
import LeaveReviewForm from '@/components/LeaveReviewForm';
import HostReplyBox from '@/components/HostReplyBox';
import ReviewStars from '@/components/ReviewStars';
import { capitializeFirst, displayName } from '@/lib/utils';

export default function HostReviewsPage() {
    const supabase = createClientComponentClient();
    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<any>(null);

    const [reviewsAboutMe, setReviewsAboutMe] = useState<any[]>([]);
    const [reviewerNames, setReviewerNames] = useState<Record<string, string>>({});

    const [reviewableBookings, setReviewableBookings] = useState<any[]>([]);
    const [guestNames, setGuestNames] = useState<Record<string, string>>({});
    const [reviewedGuestBookingIds, setReviewedGuestBookingIds] = useState<Set<string>>(new Set());
    const [openReviewFor, setOpenReviewFor] = useState<string | null>(null);

    useEffect(() => {
        const load = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setSession(session);
            if (!session?.user) {
                setLoading(false);
                return;
            }

            const { data: aboutMe } = await supabase
                .from('reviews')
                .select('*')
                .eq('reviewee_id', session.user.id)
                .eq('review_type', 'guest_to_host')
                .order('created_at', { ascending: false });
            setReviewsAboutMe(aboutMe || []);

            const reviewerIds = Array.from(new Set((aboutMe || []).map((r) => r.reviewer_id)));
            if (reviewerIds.length) {
                const { data: reviewers } = await supabase.from('profiles').select('id, full_name, preferred_name, show_full_name').in('id', reviewerIds);
                const names: Record<string, string> = {};
                (reviewers || []).forEach((p) => { names[p.id] = displayName(p, 'Guest'); });
                setReviewerNames(names);
            }

            const { data: bookings } = await supabase
                .from('bookings')
                .select('id, guest_id, check_in, check_out, status')
                .eq('host_id', session.user.id)
                .eq('status', 'confirmed')
                .lt('check_out', new Date().toISOString());
            setReviewableBookings(bookings || []);

            const guestIds = Array.from(new Set((bookings || []).map((b) => b.guest_id)));
            if (guestIds.length) {
                const { data: guests } = await supabase.from('profiles').select('id, full_name, preferred_name, show_full_name').in('id', guestIds);
                const names: Record<string, string> = {};
                (guests || []).forEach((p) => { names[p.id] = displayName(p, 'Guest'); });
                setGuestNames(names);
            }

            const { data: myGuestReviews } = await supabase
                .from('reviews')
                .select('booking_id')
                .eq('reviewer_id', session.user.id)
                .eq('review_type', 'host_to_guest');
            setReviewedGuestBookingIds(new Set((myGuestReviews || []).map((r) => r.booking_id)));

            setLoading(false);
        };
        load();
    }, [supabase]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-4">
                <Logo />
                <p className="text-slate-500 animate-pulse">Loading your reviews...</p>
            </div>
        );
    }

    if (!session) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-6 text-center px-4">
                <Logo />
                <h1 className="text-2xl font-bold text-slate-900">Sign in to manage reviews</h1>
                <LoginModel />
            </div>
        );
    }

    const avgRating = reviewsAboutMe.length
        ? reviewsAboutMe.reduce((sum, r) => sum + r.rating, 0) / reviewsAboutMe.length
        : 0;

    const unreviewedGuestBookings = reviewableBookings.filter((b) => !reviewedGuestBookingIds.has(b.id));

    return (
        <div className="max-w-3xl mx-auto px-6 py-10">
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-8">Reviews</h1>

            {unreviewedGuestBookings.length > 0 && (
                <div className="mb-10">
                    <h2 className="text-lg font-semibold text-slate-800 mb-4">Review your guests</h2>
                    <div className="space-y-4">
                        {unreviewedGuestBookings.map((b) => (
                            <div key={b.id} className="border rounded-2xl p-5">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="font-semibold text-slate-900">{capitializeFirst(guestNames[b.guest_id] || 'Guest')}</div>
                                        <div className="text-sm text-slate-500">{b.check_in} → {b.check_out}</div>
                                    </div>
                                    {openReviewFor !== b.id && (
                                        <button
                                            type="button"
                                            onClick={() => setOpenReviewFor(b.id)}
                                            className="text-sm font-semibold text-emerald-700 hover:text-emerald-800"
                                        >
                                            Leave a review
                                        </button>
                                    )}
                                </div>
                                {openReviewFor === b.id && (
                                    <div className="mt-4">
                                        <LeaveReviewForm
                                            bookingId={b.id}
                                            revieweeId={b.guest_id}
                                            reviewType="host_to_guest"
                                            revieweeName={guestNames[b.guest_id] || 'this guest'}
                                            onDone={() => setOpenReviewFor(null)}
                                        />
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div>
                <div className="flex items-center gap-3 mb-4">
                    <h2 className="text-lg font-semibold text-slate-800">What guests say about you</h2>
                    {reviewsAboutMe.length > 0 && (
                        <span className="flex items-center gap-1 text-sm text-slate-600">
                            <ReviewStars value={Math.round(avgRating)} size={16} />
                            {avgRating.toFixed(1)} ({reviewsAboutMe.length})
                        </span>
                    )}
                </div>

                {reviewsAboutMe.length === 0 ? (
                    <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
                        <p className="text-slate-500">No reviews yet.</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {reviewsAboutMe.map((r) => (
                            <div key={r.id} className="border rounded-2xl p-5">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="font-semibold text-slate-900">{capitializeFirst(reviewerNames[r.reviewer_id] || 'Guest')}</span>
                                    <ReviewStars value={r.rating} size={16} />
                                </div>
                                <p className="text-sm text-slate-700">{r.comment}</p>
                                <HostReplyBox reviewId={r.id} existingReply={r.host_reply} />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
