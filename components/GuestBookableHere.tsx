'use client';

import { useEffect, useState } from 'react';

// What a host sees about their own cottage: the experiences a guest staying
// here can book. Read-only — the host is not buying anything, they are finding
// out what to mention in a welcome note.
//
// It reads from the same endpoint and the same gate (isLiveToGuests +
// coversPoint) the guest's trip page uses, keyed to this listing instead of a
// booking, so the host and the guest can never be shown a different answer.

interface Provider {
    id: string;
    business_name: string;
    trade: string;
    description: string | null;
    price: number;
}

const TRADE_WORD: Record<string, string> = {
    chef: 'Private chef',
    cake: 'Cakes & baking',
    basket: 'Hampers & shopping',
    paw: 'Pet care',
};

export default function GuestBookableHere(props: { listingId: string }) {
    const { listingId } = props;

    const [providers, setProviders] = useState<Provider[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [open, setOpen] = useState(true);

    useEffect(() => {
        let live = true;
        fetch('/api/services/experiences?listing=' + encodeURIComponent(listingId))
            .then((r) => r.json())
            .then((d) => { if (live) { setOpen(d && d.open !== false); setProviders((d && d.providers) || []); setLoaded(true); } })
            .catch(() => { if (live) setLoaded(true); });
        return () => { live = false; };
    }, [listingId]);

    if (!loaded) return null;

    return (
        <section className="rounded-2xl border border-slate-200 p-5">
            <h2 className="font-semibold text-slate-900">Experiences your guests can book here</h2>
            <p className="mt-1 text-sm text-slate-500">
                Local businesses that cover this cottage. Guests book and pay them from their trip
                page — worth a line in your welcome note.
            </p>

            {!open ? (
                <p className="mt-4 text-sm text-slate-500">
                    Coming soon. Once guest experiences open, the local businesses that cover this
                    cottage will appear here — worth a line in your welcome note when they do.
                </p>
            ) : providers.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">
                    Nothing covers this cottage yet. As local chefs, bakers and others sign up and go
                    live, they’ll appear here.
                </p>
            ) : (
                <ul className="mt-4 space-y-3">
                    {providers.map((p) => (
                        <li key={p.id} className="flex items-start justify-between gap-4">
                            <div>
                                <div className="text-xs uppercase tracking-wide text-emerald-700">
                                    {TRADE_WORD[p.trade] || 'Experience'}
                                </div>
                                <div className="font-medium text-slate-900">{p.business_name}</div>
                                {p.description ? (
                                    <p className="text-sm text-slate-600 whitespace-pre-line">{p.description}</p>
                                ) : null}
                            </div>
                            <div className="font-semibold text-slate-900 whitespace-nowrap">£{p.price.toFixed(2)}</div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
