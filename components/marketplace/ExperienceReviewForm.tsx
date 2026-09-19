'use client';

import { useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import Link from 'next/link';
import { toast } from 'react-toastify';
import { Star, PartyPopper } from 'lucide-react';

// The rating + comment form for a completed experience. Eligibility (your own
// order, confirmed, the day has passed, not already reviewed) is decided on the
// server by app/experiences/review/[orderId]/page.tsx — a guest has no read on
// service_orders, so that read cannot happen in the browser. The insert itself
// CAN: the "Guests can review after a completed experience" policy plus the
// check_experience_review_window trigger are what authorise it, and this belt
// only keeps an obviously-empty review from being sent.

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
                        className={`h-10 w-10 transition-colors md:h-12 md:w-12 ${
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
    orderId, reviewerId, who, itemName,
}: {
    orderId: string;
    reviewerId: string;
    who: string;
    itemName: string | null;
}) {
    const supabase = createClientComponentClient();

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
            <div className="mx-auto max-w-md px-6 py-24 text-center">
                <PartyPopper className="mx-auto mb-5 h-12 w-12 text-emerald-700" />
                <h1 className="mb-2 text-2xl font-bold text-slate-900">Thanks for your review</h1>
                <p className="text-slate-600">It’s live on {who}’s page now, under your first name.</p>
                <Link href="/trips" className="mt-7 inline-block rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800">
                    Back to your trips
                </Link>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-xl px-6 py-8 md:py-12">
            <div className="mb-8">
                <div className="text-sm text-slate-500">Your experience with {who}</div>
                <div className="font-semibold text-slate-900">{itemName || 'Experience'}</div>
            </div>

            <div className="text-center">
                <h1 className="mb-9 text-2xl font-bold leading-snug text-slate-900 md:text-3xl">
                    How was it?
                </h1>
                <BigStars value={rating} onChange={setRating} />
                <p className="mt-5 h-6 text-sm text-slate-500">
                    {rating > 0 ? HINTS[rating - 1] : 'Tap a star to rate'}
                </p>
            </div>

            <div className="mt-8">
                <label className="mb-2 block text-sm font-semibold text-slate-700">Tell other guests about it</label>
                <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={7}
                    placeholder="What stood out? What should the next guest know?"
                    className="w-full rounded-2xl border p-4 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
                <div className="mt-2 flex justify-between text-xs text-slate-400">
                    <span>{comment.trim().length < 10 ? 'A sentence or two is plenty' : 'Looks good'}</span>
                    <span>{comment.trim().length}</span>
                </div>
                <p className="mt-6 text-xs text-slate-400">
                    Your review is published under your first name. Please keep it about the experience — reviews
                    with personal details, abuse or anything unrelated may be removed.
                </p>
            </div>

            <div className="mt-8 flex items-center justify-between">
                <Link href="/trips" className="text-sm font-semibold text-slate-500 hover:text-slate-800">
                    Finish this later
                </Link>
                <button
                    type="button"
                    onClick={submit}
                    disabled={!canPost || submitting}
                    className="rounded-xl bg-emerald-700 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-40"
                >
                    {submitting ? 'Posting...' : 'Post review'}
                </button>
            </div>
        </div>
    );
}
