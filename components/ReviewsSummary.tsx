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
                    <Star className="w-5 h-5 fill-amber-400 text-amber-400 self-center" />
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
                        Guest favourite
                    </span>
                )}
            </div>

            {guestFavourite && (
                <p className="text-xs text-slate-500 mt-3 leading-relaxed">{badgeExplanation}</p>
            )}

            {categories.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-4 mt-6 pt-5 border-t">
                    {categories.map(({ key, avg }) => {
                        const Icon = CATEGORY_ICONS[key];
                        return (
                            <div key={key}>
                                <div className="flex items-center justify-between gap-2">
                                    <span className="flex items-center gap-1.5 text-sm text-slate-600 truncate">
                                        <Icon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                        {CATEGORY_LABELS[key]}
                                    </span>
                                    <span className="text-sm font-semibold text-slate-900 tabular-nums">
                                        {avg.toFixed(1)}
                                    </span>
                                </div>
                                <div className="h-1 bg-slate-100 rounded-full overflow-hidden mt-1.5">
                                    <div
                                        className="h-full bg-emerald-700 rounded-full"
                                        style={{ width: `${(avg / 5) * 100}%` }}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
