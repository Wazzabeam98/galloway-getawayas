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

export default function LeaveReviewForm({ bookingId, listingId, revieweeId, reviewType, revieweeName, onDone }: Props) {
    const supabase = createClientComponentClient();
    const router = useRouter();
    const [rating, setRating] = useState(0);
    const [comment, setComment] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async () => {
        setError('');
        if (rating === 0) {
            setError('Please choose a star rating.');
            return;
        }
        if (!comment.trim()) {
            setError('Please add a few words about your stay.');
            return;
        }

        setSubmitting(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            setError('You need to be signed in.');
            setSubmitting(false);
            return;
        }

        const { error: insertErr } = await supabase.from('reviews').insert({
            booking_id: bookingId,
            listing_id: listingId || null,
            reviewer_id: user.id,
            reviewee_id: revieweeId,
            review_type: reviewType,
            rating,
            comment: comment.trim(),
        });

        setSubmitting(false);

        if (insertErr) {
            toast.error(insertErr.message, { theme: 'colored' });
            setError(insertErr.message);
            return;
        }

        toast.success('Review posted.', { theme: 'colored' });
        router.refresh();
        if (onDone) onDone();
    };

    return (
        <div className="border rounded-2xl p-5">
            <h3 className="font-semibold text-slate-900 mb-3">
                {reviewType === 'guest_to_host' ? `Review your stay with ${revieweeName}` : `Review ${revieweeName} as a guest`}
            </h3>
            <div className="mb-3">
                <ReviewStars value={rating} onChange={setRating} />
            </div>
            <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={4}
                placeholder={reviewType === 'guest_to_host' ? 'What was your stay like?' : 'What was this guest like to host?'}
                className="w-full p-3 border rounded-xl text-sm mb-3"
            />
            {error && <p className="text-red-600 text-xs mb-3">{error}</p>}
            <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="px-5 py-2.5 bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold rounded-xl transition disabled:opacity-50"
            >
                {submitting ? 'Posting...' : 'Post review'}
            </button>
        </div>
    );
}
