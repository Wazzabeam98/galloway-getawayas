'use client';

import { useEffect, useState } from 'react';
import { getImageUrl } from '@/lib/utils';

// What a guest sees on a stay they have already paid for: the local guest
// experiences near their cottage they can book for their dates.
//
// Deliberately quiet when there is nothing to show — no live provider covering
// the cottage means the section does not render at all, rather than an empty
// "no experiences" box on every trip.
//
// A guest experience is sold on the work itself, so the gallery is the listing,
// not a nice-to-have — and a guest is choosing someone to come into the cottage
// they are staying in, so the card carries a bit of who they are, not only what
// they charge. The provider's own words carry what the experience is
// ("three-course dinner for up to six, £180"); the price is theirs, unmarked-up.
// Who the guest is contracting with is said plainly, before they pay — the
// request sends them to Stripe to authorise their card, held not charged until
// the provider confirms.

interface Provider {
    id: string;
    business_name: string;
    // The person behind the business, and the words that say who they are.
    provider_name: string | null;
    based_line: string | null;
    about: string | null;
    what_to_expect: string | null;
    headshot: string | null;
    // The word above them — the trade's own, or the owner-assigned word for a
    // "something else" business. Never a raw trade key.
    category: string;
    description: string | null;
    photos: string[] | null;
    price: number;
}

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
    const [open, setOpen] = useState(true);
    const [dateFor, setDateFor] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let live = true;
        fetch('/api/services/experiences?booking=' + encodeURIComponent(bookingId))
            .then((r) => r.json())
            .then((d) => { if (live) { setOpen(d && d.open !== false); setProviders((d && d.providers) || []); setLoaded(true); } })
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

    if (!loaded) return null;

    // Closed until launch. The homepage promises this, so the trip page should
    // not be silent about it — a visible "coming soon", not a hidden nothing.
    // There is no button: the section says it is coming and cannot be used, and
    // the server refuses a request even if one were forged.
    if (!open) {
        return (
            <section className="mt-8 rounded-lg border border-dashed border-gray-300 p-5">
                <h3 className="text-lg font-semibold text-gray-900">Coming soon to your stay</h3>
                <p className="mt-1 text-sm text-gray-500">
                    Guest experiences you’ll be able to book for your dates — a private chef, a
                    welcome hamper, a cake, and more. We’re lining up local businesses now.
                </p>
            </section>
        );
    }

    // Open, but nothing covers this stay yet — render nothing rather than an
    // empty box.
    if (providers.length === 0) return null;

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
                {providers.map((p) => {
                    const photos = (p.photos || []).filter(Boolean);
                    // The name the guest is told they are dealing with: the person
                    // where they gave one, the business otherwise.
                    const who = (p.provider_name && p.provider_name.trim()) || p.business_name;
                    return (
                    <div key={p.id} className="overflow-hidden rounded-lg border border-gray-200">
                        {/* The gallery is the listing. Their own photos of the
                            work, first thing, because a guest picks an experience
                            from what it looks like — unlike a plumber, whom nobody
                            chooses from a photo. */}
                        {photos.length > 0 ? (
                            // One, two or three across — matched to how many there
                            // are, so two photos fill the width rather than leaving
                            // a third empty column.
                            <div className={`grid gap-0.5 ${photos.length === 1 ? 'grid-cols-1' : photos.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                                {photos.slice(0, 3).map((path) => (
                                    <img
                                        key={path}
                                        src={getImageUrl(path)}
                                        alt={`${who} — ${p.category}`}
                                        loading="lazy"
                                        className="h-32 w-full object-cover"
                                    />
                                ))}
                            </div>
                        ) : null}

                        <div className="p-4">
                            <div className="text-xs uppercase tracking-wide text-emerald-700">
                                {p.category}
                            </div>

                            {/* Who they are, not only what they charge. */}
                            <div className="mt-1 flex items-center gap-3">
                                {p.headshot ? (
                                    <img
                                        src={getImageUrl(p.headshot)}
                                        alt={who}
                                        className="h-10 w-10 shrink-0 rounded-full object-cover"
                                    />
                                ) : null}
                                <div className="min-w-0">
                                    <div className="font-semibold text-gray-900 break-words">{p.business_name}</div>
                                    {p.provider_name && p.provider_name.trim() && p.provider_name !== p.business_name ? (
                                        <div className="text-sm text-gray-600 break-words">{p.provider_name}</div>
                                    ) : null}
                                    {p.based_line ? (
                                        <div className="text-xs text-gray-500 break-words">{p.based_line}</div>
                                    ) : null}
                                </div>
                            </div>

                            {p.description ? (
                                <p className="mt-2 whitespace-pre-line text-sm text-gray-600">{p.description}</p>
                            ) : null}
                            {p.about ? (
                                <p className="mt-2 whitespace-pre-line text-sm text-gray-500">{p.about}</p>
                            ) : null}

                            <div className="mt-2 font-semibold text-gray-900">£{p.price.toFixed(2)}</div>

                            {p.what_to_expect ? (
                                <details className="mt-2 text-sm text-gray-600">
                                    <summary className="cursor-pointer text-emerald-700">What to expect</summary>
                                    <p className="mt-1 whitespace-pre-line">{p.what_to_expect}</p>
                                </details>
                            ) : null}

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
                    </div>
                    );
                })}
            </div>

            {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        </section>
    );
}
