'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Star } from 'lucide-react';

// The review prompt, living on the guest's trips dashboard rather than buried on
// an order page. One lifted card per experience they can review — the same
// raised style as the booking card (soft shadow, hairline border) — with the
// experience's photo and title and a Leave a review button that opens the clean
// full-screen step. Renders nothing when there is nothing to review, so it never
// leaves an empty heading behind. The gate is the database's; this only shows
// what the /api/services/to-review endpoint says is reviewable.

interface Item {
    orderId: string;
    title: string;
    providerName: string | null;
    serviceDate: string;
    photo: string | null;
}

function whenLabel(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    return isNaN(d.getTime())
        ? ''
        : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function ReviewPrompts() {
    const [items, setItems] = useState<Item[]>([]);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        fetch('/api/services/to-review')
            .then((r) => r.json())
            .then((d) => { setItems((d && d.items) || []); setLoaded(true); })
            .catch(() => setLoaded(true));
    }, []);

    if (!loaded || items.length === 0) return null;

    return (
        <section className="mb-10">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">How was it?</h2>
            <div className="space-y-4">
                {items.map((it) => {
                    const when = whenLabel(it.serviceDate);
                    const sub = [it.providerName, when].filter(Boolean).join(' · ');
                    return (
                        <div
                            key={it.orderId}
                            // The lifted booking-card style, reused verbatim.
                            className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_6px_16px_rgba(0,0,0,0.12)] sm:flex-row sm:items-center sm:justify-between"
                        >
                            <div className="flex min-w-0 items-center gap-4">
                                <div className="h-16 w-20 flex-none overflow-hidden rounded-xl bg-slate-100">
                                    {it.photo ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={it.photo} alt="" className="h-full w-full object-cover" />
                                    ) : null}
                                </div>
                                <div className="min-w-0">
                                    <div className="truncate font-semibold text-slate-900">{it.title}</div>
                                    {sub ? <div className="mt-0.5 truncate text-sm text-slate-500">{sub}</div> : null}
                                </div>
                            </div>
                            <Link
                                href={`/experiences/review/${it.orderId}`}
                                className="inline-flex flex-none items-center justify-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800"
                            >
                                <Star className="h-4 w-4" /> Leave a review
                            </Link>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
