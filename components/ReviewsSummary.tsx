import { Sparkles, CheckCircle, Key, MessageSquare, Map, Tag, Star } from 'lucide-react';

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

export default function ReviewsSummary({ reviews }: { reviews: Review[] }) {
    if (!reviews || reviews.length === 0) return null;

    const avgOverall = reviews.reduce((sum, r) => sum + Number(r.rating), 0) / reviews.length;

    const categoryKeys = ['cleanliness', 'accuracy', 'checkin', 'communication', 'location', 'value'] as const;
    const categoryAverages = categoryKeys.map((key) => {
        const field = `${key}_rating` as keyof Review;
        const values = reviews.map((r) => r[field]).filter((v): v is number => typeof v === 'number');
        const avg = values.length ? values.reduce((sum, v) => sum + Number(v), 0) / values.length : null;
        return { key, avg };
    }).filter((c) => c.avg !== null);

    const isGuestFavourite = avgOverall >= 4.8 && reviews.length >= 5;

    return (
        <div className="border rounded-2xl p-5 md:p-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-baseline gap-2.5">
                    <Star className="w-5 h-5 fill-amber-400 text-amber-400 self-center" />
                    <span className="text-3xl font-bold text-slate-900 leading-none">{avgOverall.toFixed(2)}</span>
                    <span className="text-slate-500 text-sm">
                        {reviews.length} review{reviews.length > 1 ? 's' : ''}
                    </span>
                </div>

                {isGuestFavourite && (
                    <span className="text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full">
                        Guest favourite
                    </span>
                )}
            </div>

            {categoryAverages.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-4 mt-6 pt-5 border-t">
                    {categoryAverages.map(({ key, avg }) => {
                        const Icon = CATEGORY_ICONS[key];
                        return (
                            <div key={key}>
                                <div className="flex items-center justify-between gap-2">
                                    <span className="flex items-center gap-1.5 text-sm text-slate-600 truncate">
                                        <Icon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                        {CATEGORY_LABELS[key]}
                                    </span>
                                    <span className="text-sm font-semibold text-slate-900 tabular-nums">
                                        {avg!.toFixed(1)}
                                    </span>
                                </div>
                                <div className="h-1 bg-slate-100 rounded-full overflow-hidden mt-1.5">
                                    <div
                                        className="h-full bg-emerald-700 rounded-full"
                                        style={{ width: `${(avg! / 5) * 100}%` }}
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
