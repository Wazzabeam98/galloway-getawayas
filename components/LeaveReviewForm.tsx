'use client';

import { useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';
import ReviewStars from './ReviewStars';

interface Props {
    bookingId: string;
    listingId?: string | null;
    revieweeId: string;
    reviewType: 'guest_to_host' | 'host_to_guest';
    revieweeName: string;
    onDone?: () => void;
}

const STAY_CATEGORIES = [
    { key: 'cleanliness', label: 'Cleanliness' },
    { key: 'accuracy', label: 'Accuracy' },
    { key: 'checkin', label: 'Check-in' },
    { key: 'communication', label: 'Communication' },
    { key: 'location', label: 'Location' },
    { key: 'value', label: 'Value' },
] as const;

export default function LeaveReviewForm({ bookingId, listingId, revieweeId, reviewType, revieweeName, onDone }: Props) {
    const supabase = createClientComponentClient();
    const router = useRouter();
    const isStayReview = reviewType === 'guest_to_host';

    // For host reviews, a single overall rating is enough. For stay reviews,
    // guests rate each category and the overall score is the average.
    const [overallRating, setOverallRating] = useState(0);
    const [categoryRatings, setCategoryRatings] = useState<Record<string, number>>({});
    const [comment, setComment] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    const setCategory = (key: string, value: number) => {
        setCategoryRatings((prev) => ({ ...prev, [key]: value }));
    };

    const allCategoriesRated = STAY_CATEGORIES.every((c) => categoryRatings[c.key] > 0);
    const computedOverall = isStayReview
        ? STAY_CATEGORIES.reduce((sum, c) => sum + (categoryRatings[c.key] || 0), 0) / STAY_CATEGORIES.length
        : overallRating;

    const handleSubmit = async () => {
        setError('');

        if (isStayReview && !allCategoriesRated) {
            setError('Please rate every category.');
            return;
        }
        if (!isStayReview && overallRating === 0) {
            setError('Please choose a star rating.');
            return;
        }
        if (!comment.trim()) {
            setError('Please add a few words.');
            return;
        }

        setSubmitting(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            setError('You need to be signed in.');
            setSubmitting(false);
            return;
        }

        const payload: Record<string, any> = {
            booking_id: bookingId,
            listing_id: listingId || null,
            reviewer_id: user.id,
            reviewee_id: revieweeId,
            review_type: reviewType,
            rating: Number(computedOverall.toFixed(2)),
            comment: comment.trim(),
        };

        if (isStayReview) {
            payload.cleanliness_rating = categoryRatings.cleanliness;
            payload.accuracy_rating = categoryRatings.accuracy;
            payload.checkin_rating = categoryRatings.checkin;
            payload.communication_rating = categoryRatings.communication;
            payload.location_rating = categoryRatings.location;
            payload.value_rating = categoryRatings.value;
        }

        const { error: insertErr } = await supabase.from('reviews').insert(payload);

        setSubmitting(false);

        if (insertErr) {
            toast.error(insertErr.message, { theme: 'colored' });
            setError(insertErr.message);
            return;
        }

        toast.success(
            isStayReview
                ? 'Review posted. It stays hidden until your host reviews you too.'
                : 'Review posted. It stays hidden until your guest reviews you too.',
            { theme: 'colored' }
        );
        router.refresh();
        if (onDone) onDone();
    };

    return (
        <div className="border rounded-2xl p-5">
            <h3 className="font-semibold text-slate-900 mb-4">
                {isStayReview ? `Review your stay with ${revieweeName}` : `Review ${revieweeName} as a guest`}
            </h3>

            {isStayReview ? (
                <div className="space-y-3 mb-4">
                    {STAY_CATEGORIES.map((c) => (
                        <div key={c.key} className="flex items-center justify-between">
                            <span className="text-sm text-slate-700">{c.label}</span>
                            <ReviewStars value={categoryRatings[c.key] || 0} onChange={(v) => setCategory(c.key, v)} size={18} />
                        </div>
                    ))}
                </div>
            ) : (
                <div className="mb-4">
                    <ReviewStars value={overallRating} onChange={setOverallRating} />
                </div>
            )}

            <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={4}
                placeholder={isStayReview ? 'What was your stay like?' : 'What was this guest like to host?'}
                className="w-full p-3 border rounded-xl text-sm mb-3"
            />
            {error && <p className="text-red-600 text-xs mb-3">{error}</p>}
            <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition disabled:opacity-50"
            >
                {submitting ? 'Posting...' : 'Post review'}
            </button>
        </div>
    );
}
