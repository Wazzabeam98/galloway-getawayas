'use client';

import { useEffect, useState } from 'react';

// What a guest sees on a stay they have already paid for: the local providers
// near their cottage they can book for their dates.
//
// Deliberately quiet when there is nothing to show — no live provider covering
// the cottage means the section does not render at all, rather than an empty
// "no experiences" box on every trip.
//
// The provider's own words carry what the experience is ("three-course dinner
// for up to six, £180"); the price is theirs, unmarked-up. Who the guest is
// contracting with is said plainly, before they pay — the request sends them to
// Stripe to authorise their card, held not charged until the provider confirms.

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

// yyyy-mm-dd one day before check-out — the last night the guest is here.
function lastNight(checkOut: string): string {
    const d = new Date(checkOut + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
}

export default function GuestExperiences(props: {
    bookingId: string;
    checkIn: string;
    checkOut: string;
    town?: string | null;
}) {
    const { bookingId, checkIn, checkOut, town } = props;

    const [providers, setProviders] = useState<Provider[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [dateFor, setDateFor] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let live = true;
        fetch('/api/services/experiences?booking=' + encodeURIComponent(bookingId))
            .then((r) => r.json())
            .then((d) => { if (live) { setProviders((d && d.providers) || []); setLoaded(true); } })
            .catch(() => { if (live) setLoaded(true); });
        return () => { live = false; };
    }, [bookingId]);

    async function request(provider: Provider) {
        const serviceDate = dateFor[provider.id];
        if (!serviceDate) { setError('Pick a date first.'); return; }
        setBusy(provider.id);
        setError(null);
        try {
            const res = await fetch('/api/services/order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ providerId: provider.id, bookingId, serviceDate }),
            });
            const d = await res.json();
            if (d && d.ok && d.url) { window.location.href = d.url; return; }
            setError((d && d.error) || 'Could not start that.');
        } catch {
            setError('Could not start that.');
        }
        setBusy(null);
    }

    // Nothing to show, or not loaded yet — render nothing rather than an empty box.
    if (!loaded || providers.length === 0) return null;

    const max = lastNight(checkOut);

    return (
        <section className="mt-8">
            <h3 className="text-lg font-semibold text-gray-900">
                Make more of your stay{town ? ' near ' + town : ''}
            </h3>
            <p className="mt-1 text-sm text-gray-500">
                Local businesses you can book for your dates. Paid securely; the
                provider is who you’re booking, and your card is only held until
                they confirm.
            </p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {providers.map((p) => (
                    <div key={p.id} className="rounded-lg border border-gray-200 p-4">
                        <div className="text-xs uppercase tracking-wide text-emerald-700">
                            {TRADE_WORD[p.trade] || 'Experience'}
                        </div>
                        <div className="mt-0.5 font-semibold text-gray-900">{p.business_name}</div>
                        {p.description ? (
                            <p className="mt-1 whitespace-pre-line text-sm text-gray-600">{p.description}</p>
                        ) : null}
                        <div className="mt-2 font-semibold text-gray-900">£{p.price.toFixed(2)}</div>

                        <label className="mt-3 block text-xs text-gray-500">
                            Date during your stay
                            <input
                                type="date"
                                min={checkIn}
                                max={max}
                                value={dateFor[p.id] || ''}
                                onChange={(e) => setDateFor((s) => ({ ...s, [p.id]: e.target.value }))}
                                className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                            />
                        </label>

                        <button
                            type="button"
                            disabled={busy === p.id}
                            onClick={() => request(p)}
                            className="mt-3 w-full rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                        >
                            {busy === p.id ? 'Starting…' : 'Request & hold my card'}
                        </button>

                        <p className="mt-2 text-[11px] leading-snug text-gray-400">
                            You’re booking {p.business_name}. Galloway Getaways takes the
                            payment on their behalf and is not the provider.
                        </p>
                    </div>
                ))}
            </div>

            {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        </section>
    );
}
