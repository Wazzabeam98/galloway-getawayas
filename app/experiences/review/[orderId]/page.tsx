'use client';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Logo from '@/components/base/Logo';
import LoginModel from '@/components/auth/LoginModel';
import { toast } from 'react-toastify';
import { Star, PartyPopper } from 'lucide-react';

// Leave a review for a completed experience. The twin of app/review/[bookingId]
// for cottage stays, but an experience is not a place you check into, so there
// are no cleanliness / check-in / location categories — one overall rating and a
// comment, the honest shape of "how was it". The real gate is the database
// (RLS + trigger); this screen is the belt, and refuses early with a clear line.

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

export default function ExperienceReviewPage() {
    const params = useParams();
    const orderId = params?.orderId as string;
    const supabase = createClientComponentClient();

    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<any>(null);
    const [blocked, setBlocked] = useState('');
    const [order, setOrder] = useState<any>(null);
    const [who, setWho] = useState('the provider');

    const [rating, setRating] = useState(0);
    const [comment, setComment] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [done, setDone] = useState(false);

    useEffect(() => {
        const load = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setSession(session);
            if (!session?.user || !orderId) { setLoading(false); return; }

            const { data: o } = await supabase
                .from('service_orders')
                .select('id, guest_id, provider_id, status, service_date, item_name, provider_business_name')
                .eq('id', orderId)
                .maybeSingle();

            if (!o) { setBlocked('We couldn’t find that booking.'); setLoading(false); return; }
            if (o.guest_id !== session.user.id) { setBlocked('This isn’t your booking to review.'); setLoading(false); return; }
            if (o.status !== 'confirmed') { setBlocked('You can review an experience once it’s booked and paid.'); setLoading(false); return; }

            const today = new Date(); today.setHours(0, 0, 0, 0);
            const when = new Date(String(o.service_date) + 'T00:00:00');
            if (when >= today) { setBlocked('You can leave a review once the experience has taken place.'); setLoading(false); return; }

            const { data: existing } = await supabase
                .from('reviews')
                .select('id')
                .eq('order_id', orderId)
                .eq('reviewer_id', session.user.id)
                .maybeSingle();
            if (existing) { setBlocked('You’ve already reviewed this experience. Thanks!'); setLoading(false); return; }

            setOrder(o);
            setWho(o.provider_business_name || 'the provider');
            setLoading(false);
        };
        load();
    }, [supabase, orderId]);

    const canPost = rating > 0 && comment.trim().length >= 10;

    const submit = async () => {
        if (!session?.user || !order || !canPost) return;
        setSubmitting(true);
        const { error } = await supabase.from('reviews').insert({
            order_id: order.id,
            reviewer_id: session.user.id,
            review_type: 'guest_to_provider',
            rating,
            comment: comment.trim(),
        });
        setSubmitting(false);
        if (error) { toast.error(error.message, { theme: 'colored' }); return; }
        setDone(true);
    };

    if (loading) {
        return (
            <div className="flex min-h-[70vh] flex-col items-center justify-center space-y-4">
                <Logo />
                <p className="animate-pulse text-slate-500">Loading...</p>
            </div>
        );
    }

    if (!session) {
        return (
            <div className="mx-auto max-w-md px-6 py-24 text-center">
                <h1 className="mb-2 text-2xl font-bold text-slate-900">Sign in to leave your review</h1>
                <p className="mb-6 text-slate-500">You’ll need to be signed in to the account that booked it.</p>
                <LoginModel />
            </div>
        );
    }

    if (blocked) {
        return (
            <div className="mx-auto max-w-md px-6 py-24 text-center">
                <h1 className="mb-2 text-2xl font-bold text-slate-900">{blocked}</h1>
                <Link href="/trips" className="mt-6 inline-block rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800">
                    Back to your trips
                </Link>
            </div>
        );
    }

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
                <div className="font-semibold text-slate-900">{order?.item_name || 'Experience'}</div>
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
