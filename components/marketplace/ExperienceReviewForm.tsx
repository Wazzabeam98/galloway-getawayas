'use client';

import { useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';
import { Star, PartyPopper, X } from 'lucide-react';

// The review step: one clean full-screen page, in the shape of Airbnb's sign-up
// flow — white, uncluttered, one thing on it. The stars, a comment box, a Post
// button, and a way out. No order details, no policy copy, no headings beyond
// the question itself. Eligibility is decided on the server before this renders
// (a guest has no read on service_orders); the insert here is authorised by the
// "Guests can review after a completed experience" policy + the trigger.

function BigStars({ value, onChange }: { value: number; onChange: (v: number) => void }) {
    const [hover, setHover] = useState(0);
    const shown = hover || value;
    return (
        <div className="flex justify-center gap-2 md:gap-3">
            {[1, 2, 3, 4, 5].map((n) => (
                <button
                    key={n}
                    type="button"
                    aria-label={`${n} star${n > 1 ? 's' : ''}`}
                    onClick={() => onChange(n)}
                    onMouseEnter={() => setHover(n)}
                    onMouseLeave={() => setHover(0)}
                    className="p-1 transition-transform hover:scale-110 active:scale-95"
                >
                    <Star
                        className={`h-11 w-11 transition-colors md:h-14 md:w-14 ${
                            n <= shown ? 'fill-amber-400 text-amber-400' : 'fill-slate-200 text-slate-200'
                        }`}
                    />
                </button>
            ))}
        </div>
    );
}

const HINTS = ['Poor', 'Not great', 'Fine', 'Really good', 'Exceptional'];

export default function ExperienceReviewForm({
    orderId, reviewerId, who,
}: {
    orderId: string;
    reviewerId: string;
    who: string;
}) {
    const supabase = createClientComponentClient();
    const router = useRouter();

    const [rating, setRating] = useState(0);
    const [comment, setComment] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [done, setDone] = useState(false);

    const canPost = rating > 0 && comment.trim().length >= 10;

    const submit = async () => {
        if (!canPost) return;
        setSubmitting(true);
        const { error } = await supabase.from('reviews').insert({
            order_id: orderId,
            reviewer_id: reviewerId,
            review_type: 'guest_to_provider',
            rating,
            comment: comment.trim(),
        });
        setSubmitting(false);
        if (error) { toast.error(error.message, { theme: 'colored' }); return; }
        setDone(true);
    };

    if (done) {
        return (
            <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white px-6 text-center">
                <PartyPopper className="mb-5 h-12 w-12 text-emerald-700" />
                <h1 className="mb-2 text-2xl font-bold text-slate-900">Thanks for your review</h1>
                <p className="text-slate-600">It’s live on {who}’s page now, under your first name.</p>
                <button
                    type="button"
                    onClick={() => router.push('/trips')}
                    className="mt-7 rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800"
                >
                    Back to your trips
                </button>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
            {/* A way out, and nothing else up here. */}
            <div className="flex h-16 flex-none items-center px-4 sm:px-6">
                <button
                    type="button"
                    onClick={() => router.push('/trips')}
                    aria-label="Close"
                    className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                >
                    <X className="h-5 w-5" />
                </button>
            </div>

            {/* The one thing on the screen. */}
            <div className="flex flex-1 flex-col items-center overflow-y-auto px-6 pb-10">
                <div className="w-full max-w-lg pt-6 md:pt-16">
                    <h1 className="text-center text-3xl font-bold leading-snug text-slate-900 md:text-4xl">
                        How was it?
                    </h1>

                    <div className="mt-10">
                        <BigStars value={rating} onChange={setRating} />
                        <p className="mt-4 h-6 text-center text-sm text-slate-500">
                            {rating > 0 ? HINTS[rating - 1] : 'Tap a star'}
                        </p>
                    </div>

                    <textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        rows={6}
                        placeholder="What stood out? What should the next guest know?"
                        className="mt-8 w-full rounded-2xl border border-slate-300 p-4 text-base leading-relaxed focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-700/30"
                    />

                    <button
                        type="button"
                        onClick={submit}
                        disabled={!canPost || submitting}
                        className="mt-6 w-full rounded-xl bg-emerald-700 px-6 py-3.5 text-base font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-40"
                    >
                        {submitting ? 'Posting…' : 'Post review'}
                    </button>
                </div>
            </div>
        </div>
    );
}
