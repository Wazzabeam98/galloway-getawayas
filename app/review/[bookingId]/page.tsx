'use client';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Logo from '@/components/base/Logo';
import LoginModel from '@/components/auth/LoginModel';
import { toast } from 'react-toastify';
import { getImageUrl, displayName } from '@/lib/utils';
import {
    Star,
    Sparkles,
    CheckCircle,
    Key,
    MessageSquare,
    Map,
    Tag,
    ChevronLeft,
    ChevronRight,
    PartyPopper,
} from 'lucide-react';

const CATEGORIES = [
    {
        key: 'cleanliness',
        label: 'Cleanliness',
        icon: Sparkles,
        question: 'How clean was the place when you arrived?',
        hints: ['Not clean at all', 'Below standard', 'Reasonably clean', 'Very clean', 'Spotless'],
    },
    {
        key: 'accuracy',
        label: 'Accuracy',
        icon: CheckCircle,
        question: 'How accurately did the listing describe the place?',
        hints: ['Very misleading', 'Somewhat off', 'Mostly accurate', 'Very accurate', 'Exactly as described'],
    },
    {
        key: 'checkin',
        label: 'Check-in',
        icon: Key,
        question: 'How smoothly did check-in go?',
        hints: ['Very difficult', 'A bit awkward', 'Fine', 'Easy', 'Completely seamless'],
    },
    {
        key: 'communication',
        label: 'Communication',
        icon: MessageSquare,
        question: 'How was your host to communicate with?',
        hints: ['Unresponsive', 'Slow to reply', 'Responsive enough', 'Very responsive', 'Outstanding'],
    },
    {
        key: 'location',
        label: 'Location',
        icon: Map,
        question: 'How did you find the location?',
        hints: ['Poor', 'Not great', 'Fine', 'Very good', 'Perfect for the trip'],
    },
    {
        key: 'value',
        label: 'Value',
        icon: Tag,
        question: 'Did the stay feel like good value?',
        hints: ['Very overpriced', 'A bit pricey', 'Fair', 'Good value', 'Excellent value'],
    },
] as const;

type Ratings = Record<string, number>;

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
                        className={`w-10 h-10 md:w-12 md:h-12 transition-colors ${
                            n <= shown ? 'fill-amber-400 text-amber-400' : 'fill-slate-200 text-slate-200'
                        }`}
                    />
                </button>
            ))}
        </div>
    );
}

export default function ReviewPage() {
    const params = useParams();
    const bookingId = params?.bookingId as string;
    const supabase = createClientComponentClient();
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<any>(null);
    const [blocked, setBlocked] = useState<string>('');
    const [booking, setBooking] = useState<any>(null);
    const [listing, setListing] = useState<any>(null);
    const [hostName, setHostName] = useState('your host');
    const [daysLeft, setDaysLeft] = useState<number | null>(null);

    const [step, setStep] = useState(0);
    const [ratings, setRatings] = useState<Ratings>({});
    const [comment, setComment] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [done, setDone] = useState(false);

    useEffect(() => {
        const load = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setSession(session);

            if (!session?.user || !bookingId) {
                setLoading(false);
                return;
            }

            const { data: b } = await supabase
                .from('bookings')
                .select('id, listing_id, guest_id, host_id, check_in, check_out, status')
                .eq('id', bookingId)
                .maybeSingle();

            if (!b) {
                setBlocked('We couldn\u2019t find that booking.');
                setLoading(false);
                return;
            }
            if (b.guest_id !== session.user.id) {
                setBlocked('This isn\u2019t your booking to review.');
                setLoading(false);
                return;
            }

            const checkOut = new Date(b.check_out);
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            if (b.status !== 'confirmed') {
                setBlocked('Only confirmed stays can be reviewed.');
                setLoading(false);
                return;
            }
            if (checkOut > today) {
                setBlocked('You can leave a review once your stay has finished.');
                setLoading(false);
                return;
            }

            const deadline = new Date(checkOut);
            deadline.setDate(deadline.getDate() + 14);
            const remaining = Math.ceil((deadline.getTime() - today.getTime()) / 86400000);

            if (remaining < 0) {
                setBlocked('The 14 day window for reviewing this stay has now closed.');
                setLoading(false);
                return;
            }
            setDaysLeft(remaining);

            const { data: existing } = await supabase
                .from('reviews')
                .select('id')
                .eq('booking_id', bookingId)
                .eq('reviewer_id', session.user.id)
                .maybeSingle();

            if (existing) {
                setBlocked('You\u2019ve already reviewed this stay. Thanks!');
                setLoading(false);
                return;
            }

            setBooking(b);

            const { data: l } = await supabase
                .from('listings')
                .select('id, title, images')
                .eq('id', b.listing_id)
                .maybeSingle();
            setListing(l);

            const { data: host } = await supabase
                .from('profiles')
                .select('full_name, preferred_name, show_full_name')
                .eq('id', b.host_id)
                .maybeSingle();
            const name = displayName(host, 'your host');
            setHostName(name.split(' ')[0] || 'your host');

            setLoading(false);
        };
        load();
    }, [supabase, bookingId]);

    const totalSteps = CATEGORIES.length + 1;
    const isCommentStep = step === CATEGORIES.length;
    const current = !isCommentStep ? CATEGORIES[step] : null;
    const currentValue = current ? ratings[current.key] || 0 : 0;

    const average =
        CATEGORIES.reduce((sum, c) => sum + (ratings[c.key] || 0), 0) / CATEGORIES.length;

    const canGoNext = isCommentStep ? comment.trim().length >= 10 : currentValue > 0;

    const setRating = (key: string, value: number) => {
        setRatings((prev) => ({ ...prev, [key]: value }));
        // Move on by itself so the whole thing is six taps, not twelve.
        window.setTimeout(() => {
            setStep((s) => (s < CATEGORIES.length ? s + 1 : s));
        }, 260);
    };

    const submit = async () => {
        if (!session?.user || !booking) return;

        setSubmitting(true);

        const { error } = await supabase.from('reviews').insert({
            booking_id: booking.id,
            listing_id: booking.listing_id,
            reviewer_id: session.user.id,
            reviewee_id: booking.host_id,
            review_type: 'guest_to_host',
            rating: Number(average.toFixed(2)),
            comment: comment.trim(),
            cleanliness_rating: ratings.cleanliness,
            accuracy_rating: ratings.accuracy,
            checkin_rating: ratings.checkin,
            communication_rating: ratings.communication,
            location_rating: ratings.location,
            value_rating: ratings.value,
        });

        setSubmitting(false);

        if (error) {
            toast.error(error.message, { theme: 'colored' });
            return;
        }

        setDone(true);
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-4">
                <Logo />
                <p className="text-slate-500 animate-pulse">Loading...</p>
            </div>
        );
    }

    if (!session) {
        return (
            <div className="max-w-md mx-auto px-6 py-24 text-center">
                <h1 className="text-2xl font-bold text-slate-900 mb-2">Sign in to leave your review</h1>
                <p className="text-slate-500 mb-6">You&apos;ll need to be signed in to the account that made the booking.</p>
                <LoginModel />
            </div>
        );
    }

    if (blocked) {
        return (
            <div className="max-w-md mx-auto px-6 py-24 text-center">
                <h1 className="text-2xl font-bold text-slate-900 mb-2">{blocked}</h1>
                <Link
                    href="/trips"
                    className="inline-block mt-6 px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition"
                >
                    Back to your trips
                </Link>
            </div>
        );
    }

    if (done) {
        return (
            <div className="max-w-md mx-auto px-6 py-24 text-center">
                <PartyPopper className="w-12 h-12 text-emerald-700 mx-auto mb-5" />
                <h1 className="text-2xl font-bold text-slate-900 mb-2">Thanks for your review</h1>
                <p className="text-slate-600">
                    It stays hidden until {hostName} has reviewed you too, or until 14 days after your stay &mdash;
                    whichever comes first. That way neither of you can see the other&apos;s review before writing your own.
                </p>
                <Link
                    href="/trips"
                    className="inline-block mt-7 px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition"
                >
                    Back to your trips
                </Link>
            </div>
        );
    }

    const progress = ((step + (canGoNext ? 1 : 0)) / totalSteps) * 100;

    return (
        <div className="max-w-xl mx-auto px-6 py-8 md:py-12">
            <div className="flex items-center gap-4 mb-8">
                <div className="w-14 h-14 rounded-xl overflow-hidden bg-slate-200 shrink-0">
                    {listing?.images?.[0] && (
                        <img src={getImageUrl(listing.images[0])} alt={listing.title} className="w-full h-full object-cover" />
                    )}
                </div>
                <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">{listing?.title || 'Your stay'}</div>
                    <div className="text-sm text-slate-500">
                        Hosted by {hostName}
                        {daysLeft !== null && daysLeft <= 3 && (
                            <span className="text-amber-700 font-medium">
                                {' '}&middot; {daysLeft === 0 ? 'last day to review' : `${daysLeft} days left`}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-10">
                <div
                    className="h-full bg-emerald-700 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                />
            </div>

            {current ? (
                <div className="text-center">
                    <current.icon className="w-7 h-7 text-emerald-700 mx-auto mb-4" />
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
                        {current.label}
                    </div>
                    <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-9 leading-snug">
                        {current.question}
                    </h1>

                    <BigStars value={currentValue} onChange={(v) => setRating(current.key, v)} />

                    <p className="h-6 mt-5 text-sm text-slate-500">
                        {currentValue > 0 ? current.hints[currentValue - 1] : 'Tap a star to rate'}
                    </p>
                </div>
            ) : (
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-2 text-center">
                        Tell other guests about it
                    </h1>
                    <p className="text-slate-500 text-sm mb-7 text-center">
                        What stood out? Anything the next guest should know?
                    </p>

                    <div className="border rounded-2xl p-4 mb-6 bg-slate-50">
                        <div className="text-sm text-slate-500 mb-3">Your ratings</div>
                        <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                            {CATEGORIES.map((c) => (
                                <button
                                    key={c.key}
                                    type="button"
                                    onClick={() => setStep(CATEGORIES.indexOf(c as any))}
                                    className="flex items-center justify-between text-sm hover:bg-white rounded-lg px-2 py-1 -mx-2 transition"
                                >
                                    <span className="text-slate-600">{c.label}</span>
                                    <span className="flex items-center gap-1 font-semibold text-slate-900">
                                        {ratings[c.key] || 0}
                                        <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                                    </span>
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center justify-between border-t mt-3 pt-3 text-sm">
                            <span className="font-semibold text-slate-700">Overall</span>
                            <span className="font-bold text-slate-900">{average.toFixed(2)}</span>
                        </div>
                    </div>

                    <textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        rows={7}
                        placeholder="We loved the wood burner and the walk down to the shore..."
                        className="w-full p-4 border rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                    <div className="flex justify-between text-xs text-slate-400 mt-2 mb-6">
                        <span>{comment.trim().length < 10 ? 'A sentence or two is plenty' : 'Looks good'}</span>
                        <span>{comment.trim().length}</span>
                    </div>

                    <p className="text-xs text-slate-400 mb-6">
                        Your review is published under your first name. Please keep it about the stay &mdash; reviews
                        with personal details, abuse or anything unrelated may be removed.
                    </p>
                </div>
            )}

            <div className="flex items-center justify-between mt-10">
                <button
                    type="button"
                    onClick={() => setStep((s) => Math.max(0, s - 1))}
                    disabled={step === 0}
                    className="flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-0"
                >
                    <ChevronLeft className="w-4 h-4" /> Back
                </button>

                {isCommentStep ? (
                    <button
                        type="button"
                        onClick={submit}
                        disabled={!canGoNext || submitting}
                        className="px-6 py-3 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition disabled:opacity-40"
                    >
                        {submitting ? 'Posting...' : 'Post review'}
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={() => setStep((s) => s + 1)}
                        disabled={!canGoNext}
                        className="flex items-center gap-1 px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition disabled:opacity-40"
                    >
                        Next <ChevronRight className="w-4 h-4" />
                    </button>
                )}
            </div>

            <div className="text-center mt-8">
                <Link href="/trips" className="text-xs text-slate-400 hover:text-slate-600 underline">
                    Finish this later
                </Link>
            </div>
        </div>
    );
}
