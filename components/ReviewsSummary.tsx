import { Sparkles, CheckCircle, Key, MessageSquare, Map, Tag, Star } from 'lucide-react';
import {
    CATEGORY_KEYS,
    CategoryKey,
    GUEST_FAVOURITE_MIN_REVIEWS,
    GUEST_FAVOURITE_THRESHOLD,
    isGraceHoldingBadge,
    isGuestFavourite,
    meanTo2dp,
} from '@/lib/reviews';

interface Review {
    rating: number;
    cleanliness_rating?: number | null;
    accuracy_rating?: number | null;
    checkin_rating?: number | null;
    communication_rating?: number | null;
    location_rating?: number | null;
    value_rating?: number | null;
}

const CATEGORY_ICONS: Record<string, any> = {
    cleanliness: Sparkles,
    accuracy: CheckCircle,
    checkin: Key,
    communication: MessageSquare,
    location: Map,
    value: Tag,
};

const CATEGORY_LABELS: Record<string, string> = {
    cleanliness: 'Cleanliness',
    accuracy: 'Accuracy',
    checkin: 'Check-in',
    communication: 'Communication',
    location: 'Location',
    value: 'Value',
};

interface Props {
    reviews: Review[];
    // The stored aggregates, maintained by the refresh_listing_ratings trigger.
    // Displaying these rather than recomputing keeps this card and the page
    // header showing the same number — see meanTo2dp in lib/reviews for why
    // recomputing in JS drifts by a hundredth.
    ratingAvg: number;
    ratingCount: number;
    // Stored per-category averages. Any that are missing (a listing predating
    // the trigger) fall back to being computed from the reviews themselves.
    categoryAverages?: Partial<Record<CategoryKey, number | null>>;
}

export default function ReviewsSummary({ reviews, ratingAvg, ratingCount, categoryAverages }: Props) {
    if (!reviews || reviews.length === 0) return null;

    const categories = CATEGORY_KEYS.map((key) => {
        const stored = categoryAverages?.[key];
        if (stored !== null && stored !== undefined) {
            return { key, avg: Number(stored) };
        }
        const field = `${key}_rating` as keyof Review;
        const values = reviews
            .map((r) => r[field])
            .filter((v): v is number => v !== null && v !== undefined);
        return { key, avg: meanTo2dp(values) };
    }).filter((c): c is { key: CategoryKey; avg: number } => c.avg !== null);

    const ratings = reviews.map((r) => Number(r.rating));
    const guestFavourite = isGuestFavourite(ratings);

    // The 5-to-1 star breakdown on the left, Airbnb's shape: how many reviews
    // gave each whole-star score, as a proportion of all of them.
    const total = reviews.length;
    const distribution = [5, 4, 3, 2, 1].map((star) => ({
        star,
        pct: total ? (ratings.filter((r) => Math.round(r) === star).length / total) * 100 : 0,
    }));

    // The badge can sit above an average well below the threshold, because a
    // young listing's worst review is set aside when judging it. Said plainly,
    // that reads as generous; left unsaid, it reads as broken.
    const badgeExplanation = isGraceHoldingBadge(ratings)
        ? "Highly rated by guests. While a place is still new, its single lowest review isn't counted towards this badge, so one unusual stay doesn't undo a strong record."
        : `Among the most highly rated places to stay: ${GUEST_FAVOURITE_THRESHOLD} or above across at least ${GUEST_FAVOURITE_MIN_REVIEWS} reviews.`;

    return (
        <div className="border rounded-2xl p-5 md:p-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-baseline gap-2.5">
                    <Star className="w-5 h-5 fill-stone-900 text-stone-900 self-center" />
                    <span className="text-3xl font-bold text-slate-900 leading-none">{ratingAvg.toFixed(2)}</span>
                    <span className="text-slate-500 text-sm">
                        {ratingCount} review{ratingCount > 1 ? 's' : ''}
                    </span>
                </div>

                {guestFavourite && (
                    <span
                        title={badgeExplanation}
                        className="text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full"
                    >
                        Top rated
                    </span>
                )}
            </div>

            {guestFavourite && (
                <p className="text-xs text-slate-500 mt-3 leading-relaxed">{badgeExplanation}</p>
            )}

            {/* Airbnb's layout: the overall rating with its 5-to-1 bars, then the
                six category scores in a row with thin dividers, scrolling
                sideways on a phone rather than wrapping. */}
            <div className="mt-6 pt-5 border-t overflow-x-auto">
                <div className="flex min-w-max divide-x divide-slate-200">
                    <div className="pr-6 min-w-[220px]">
                        <div className="text-sm font-semibold text-slate-900">Overall rating</div>
                        <div className="mt-2.5 space-y-1.5">
                            {distribution.map(({ star, pct }) => (
                                <div key={star} className="flex items-center gap-2">
                                    <span className="w-2 text-xs text-slate-600 tabular-nums">{star}</span>
                                    <div className="h-1 flex-1 bg-slate-200 rounded-full overflow-hidden">
                                        <div className="h-full bg-slate-900 rounded-full" style={{ width: `${pct}%` }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {categories.map(({ key, avg }) => {
                        const Icon = CATEGORY_ICONS[key];
                        return (
                            <div key={key} className="flex min-w-[116px] flex-col justify-between gap-3 px-6">
                                <div className="text-sm font-medium text-slate-900">{CATEGORY_LABELS[key]}</div>
                                <div className="text-lg font-semibold text-slate-900 tabular-nums">{avg.toFixed(1)}</div>
                                <Icon className="h-6 w-6 text-slate-700" strokeWidth={1.5} />
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
