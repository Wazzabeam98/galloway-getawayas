import { Sparkles, CheckCircle, Key, MessageSquare, Map, Tag } from 'lucide-react';

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

    const avgOverall = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;

    const distribution = [5, 4, 3, 2, 1].map((star) => {
        const count = reviews.filter((r) => Math.round(r.rating) === star).length;
        return { star, count, pct: (count / reviews.length) * 100 };
    });

    const categoryKeys = ['cleanliness', 'accuracy', 'checkin', 'communication', 'location', 'value'] as const;
    const categoryAverages = categoryKeys.map((key) => {
        const field = `${key}_rating` as keyof Review;
        const values = reviews.map((r) => r[field]).filter((v): v is number => typeof v === 'number');
        const avg = values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
        return { key, avg };
    }).filter((c) => c.avg !== null);

    const isGuestFavourite = avgOverall >= 4.8 && reviews.length >= 5;

    return (
        <div className="border rounded-2xl p-6 md:p-10">
            <div className="text-center mb-8">
                <div className="flex items-center justify-center gap-4">
                    <span className="text-2xl">🌿</span>
                    <span className="text-6xl font-bold text-slate-900">{avgOverall.toFixed(2)}</span>
                    <span className="text-2xl scale-x-[-1]">🌿</span>
                </div>
                {isGuestFavourite && (
                    <>
                        <h3 className="text-xl font-bold text-slate-900 mt-3">Guest favourite</h3>
                        <p className="text-slate-500 max-w-sm mx-auto mt-1 text-sm">
                            This home is a guest favourite based on ratings, reviews and reliability
                        </p>
                    </>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-8">
                <div>
                    <h4 className="font-semibold text-slate-800 mb-3 text-sm">Overall rating</h4>
                    <div className="space-y-1.5">
                        {distribution.map((d) => (
                            <div key={d.star} className="flex items-center gap-2 text-xs text-slate-500">
                                <span className="w-2">{d.star}</span>
                                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-slate-900 rounded-full" style={{ width: `${d.pct}%` }} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {categoryAverages.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-6 pt-6 border-t">
                    {categoryAverages.map(({ key, avg }) => {
                        const Icon = CATEGORY_ICONS[key];
                        return (
                            <div key={key}>
                                <div className="text-sm font-medium text-slate-800">{CATEGORY_LABELS[key]}</div>
                                <div className="text-lg font-bold text-slate-900 mb-1">{avg!.toFixed(1)}</div>
                                <Icon className="w-5 h-5 text-slate-700" />
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
