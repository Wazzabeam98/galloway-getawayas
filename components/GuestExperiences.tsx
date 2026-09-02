'use client';

import { useCallback, useEffect, useState } from 'react';
import { getImageUrl } from '@/lib/utils';
import { unitMultiplies, unitLabel, quantityQuestion, orderTotal, MAX_ORDER_QUANTITY } from '@/lib/serviceOrders';
import { dateKey } from '@/lib/pricing';

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

interface Item {
    id: string;
    name: string;
    description: string | null;
    price: number;
    // How the price is charged — 'flat' (once) or per person/night/hour/etc.
    // For anything but flat the guest picks a quantity and the total multiplies.
    unit: string;
    // The item's own photo — the gallery is per item now, not a separate strip.
    image: string | null;
}

interface Provider {
    id: string;
    business_name: string;
    // The person behind the business, and the words that say who they are.
    provider_name: string | null;
    based_line: string | null;
    headshot: string | null;
    // The word above them — the trade's own, or the owner-assigned word for a
    // "something else" business. Never a raw trade key.
    category: string;
    description: string | null;
    photos: string[] | null;
    // The menu. One item for a chef ("your experience"), many for a baker.
    items: Item[];
}

// What the guest has already asked for on this stay — so a request is something
// they can see and pull out of, not an email they may never have received.
interface Order {
    id: string;
    status: string;
    service_date: string;
    price: number;
    item_name: string | null;
    provider_business_name: string | null;
}

const ORDER_WORD: Record<string, string> = {
    authorised: 'Awaiting their answer',
    confirmed: 'Confirmed',
    declined: 'They couldn’t make it',
    expired: 'No answer in time',
    cancelled: 'Cancelled',
    refunded: 'Refunded',
};

// yyyy-mm-dd one day before check-out — the last night the guest is here.
function lastNight(checkOut: string): string {
    const d = new Date(checkOut + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    // Local components, not toISOString — the same UTC round-trip that shifted
    // booking check-in a day earlier in BST applies here too. dateKey is the
    // one the server already keys nights with (lib/pricing).
    return dateKey(d);
}

export default function GuestExperiences(props: {
    bookingId: string;
    checkIn: string;
    checkOut: string;
    town?: string | null;
}) {
    const { bookingId, checkIn, checkOut, town } = props;

    const [providers, setProviders] = useState<Provider[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [open, setOpen] = useState(true);
    const [dateFor, setDateFor] = useState<Record<string, string>>({});
    // Which item the guest has picked, per provider. A single-item provider
    // needs no pick — the card defaults to it.
    const [itemFor, setItemFor] = useState<Record<string, string>>({});
    // How many, per provider, for an item priced per person/night/etc. Flat
    // items ignore it. Defaults to 1 until they change it.
    const [qtyFor, setQtyFor] = useState<Record<string, number>>({});
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);

    const load = useCallback(() => {
        return fetch('/api/services/experiences?booking=' + encodeURIComponent(bookingId))
            .then((r) => r.json())
            .then((d) => {
                setOpen(d && d.open !== false);
                setProviders((d && d.providers) || []);
                setOrders((d && d.orders) || []);
                setLoaded(true);
            })
            .catch(() => setLoaded(true));
    }, [bookingId]);

    useEffect(() => { load(); }, [load]);

    async function cancel(order: Order) {
        setBusy(order.id);
        setError(null);
        setNote(null);
        try {
            const res = await fetch('/api/services/orders/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId: order.id }),
            });
            const d = await res.json();
            if (d && d.ok) {
                setNote(d.status === 'refunded' ? 'Cancelled and refunded in full.' : 'Request cancelled.');
                await load();
            } else {
                setError((d && d.error) || 'Could not cancel that.');
            }
        } catch {
            setError('Could not cancel that.');
        }
        setBusy(null);
    }

    // The item in play for a provider: the guest's pick, or the only one there
    // is when there is a single item.
    function pickedItem(provider: Provider): Item | null {
        const id = itemFor[provider.id] || (provider.items.length === 1 ? provider.items[0].id : '');
        return provider.items.find((i) => i.id === id) || null;
    }

    // The chosen count for that item. Always 1 for a flat price; otherwise what
    // they set, defaulting to 1. Kept in [1, MAX] so the total shown and the
    // total charged agree with the server's own cap.
    function quantityFor(provider: Provider): number {
        const item = pickedItem(provider);
        if (!item || !unitMultiplies(item.unit)) return 1;
        const n = qtyFor[provider.id] || 1;
        return Math.min(Math.max(1, Math.floor(n)), MAX_ORDER_QUANTITY);
    }

    async function request(provider: Provider) {
        // Which item: the guest's pick, or the only one there is.
        const item = pickedItem(provider);
        if (!item) { setError('Pick one first.'); return; }
        const serviceDate = dateFor[provider.id];
        if (!serviceDate) { setError('Pick a date first.'); return; }
        // The count, for a per-unit price. The server validates it against the
        // item's unit and caps it; this is just what the guest chose.
        const quantity = quantityFor(provider);
        setBusy(provider.id);
        setError(null);
        try {
            const res = await fetch('/api/services/order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ itemId: item.id, bookingId, serviceDate, quantity }),
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

    // Open, but nothing covers this stay and nothing has been requested —
    // render nothing rather than an empty box. If they have a request in
    // flight, show it even when no provider currently covers them.
    if (providers.length === 0 && orders.length === 0) return null;

    const max = lastNight(checkOut);

    // A request is "in flight" while it is held or confirmed — those are the two
    // the guest can still act on.
    const canCancel = (s: string) => s === 'authorised' || s === 'confirmed';

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

            {orders.length > 0 ? (
                <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div className="text-sm font-semibold text-gray-900">Your requests</div>
                    <ul className="mt-2 divide-y divide-gray-200">
                        {orders.map((o) => (
                            <li key={o.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                                <div className="min-w-0">
                                    <div className="text-sm font-medium text-gray-900 break-words">
                                        {o.item_name ? o.item_name + ' · ' : ''}{o.provider_business_name || 'Experience'}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        {o.service_date} · £{o.price.toFixed(2)} · {ORDER_WORD[o.status] || o.status}
                                    </div>
                                </div>
                                {canCancel(o.status) ? (
                                    <button
                                        type="button"
                                        disabled={busy === o.id}
                                        onClick={() => cancel(o)}
                                        className="shrink-0 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-400 disabled:opacity-60"
                                    >
                                        {busy === o.id ? 'Cancelling…' : o.status === 'confirmed' ? 'Cancel' : 'Cancel request'}
                                    </button>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                    <p className="mt-1 text-[11px] leading-snug text-gray-400">
                        Cancel a held request any time. A confirmed booking is refunded in full up to 48 hours before the date.
                    </p>
                    {note ? <p className="mt-2 text-xs text-emerald-700">{note}</p> : null}
                </div>
            ) : null}

            {providers.length === 0 ? null : (

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {providers.map((p) => {
                    // The name the guest is told they are dealing with: the person
                    // where they gave one, the business otherwise.
                    const who = (p.provider_name && p.provider_name.trim()) || p.business_name;
                    // The card leads with a real item photo — the gallery is per
                    // item now, so the hero is the first item that has one (which
                    // is the single item for a chef, a representative cake for a
                    // baker). No photo yet means no strip, not an empty box.
                    const hero = (p.items.find((i) => i.image) || {}).image || null;
                    return (
                    <div key={p.id} className="overflow-hidden rounded-lg border border-gray-200">
                        {hero ? (
                            <img
                                src={hero}
                                alt={`${who} — ${p.category}`}
                                loading="lazy"
                                className="h-40 w-full object-cover"
                            />
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

                            {/* THE MENU.
                                One item (a chef) reads like a single price — the
                                card is the provider, and the price sits under
                                their words. Many items (a baker) lead with a
                                "from" price, so the card is still "Effie
                                Sinclair, cakes from £18" at a glance, and the
                                items are a tidy pick-one list below rather than a
                                wall of prices. The guest chooses the cake before
                                the date. */}
                            {p.items.length === 1 ? (
                                <div className="mt-2 font-semibold text-gray-900">
                                    £{p.items[0].price.toFixed(2)}
                                    {unitLabel(p.items[0].unit) ? (
                                        <span className="ml-1 font-normal text-gray-500">{unitLabel(p.items[0].unit)}</span>
                                    ) : null}
                                </div>
                            ) : (
                                // Collapsed by default so one baker's eight-item
                                // menu doesn't stand four times taller than the
                                // chef card beside it. The summary keeps the two
                                // things that sell the range — the "from" price and
                                // that there IS a range — and a tap opens the list
                                // to pick from. Radios stay mounted inside, so a
                                // selection survives closing and reopening.
                                <details className="group mt-2">
                                    <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm text-gray-700">
                                        <span>
                                            from <span className="font-semibold text-gray-900">£{Math.min(...p.items.map((i) => i.price)).toFixed(2)}</span>
                                            <span className="text-gray-400"> · </span>
                                            <span className="text-gray-600 underline decoration-gray-300 underline-offset-2 group-open:no-underline">{p.items.length} to choose from</span>
                                        </span>
                                        <svg className="h-4 w-4 flex-none text-gray-400 transition-transform group-open:rotate-180" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
                                        </svg>
                                    </summary>
                                    <div className="mt-2 space-y-1.5">
                                        {p.items.map((it) => {
                                            const picked = (itemFor[p.id] || '') === it.id;
                                            return (
                                                <label
                                                    key={it.id}
                                                    className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 ${picked ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200'}`}
                                                >
                                                    <input
                                                        type="radio"
                                                        name={'item-' + p.id}
                                                        checked={picked}
                                                        onChange={() => setItemFor((s) => ({ ...s, [p.id]: it.id }))}
                                                        className="mt-1"
                                                    />
                                                    {/* The item's own photo, so the guest sees which
                                                        cake the £45 one is — the whole point of a
                                                        per-item picture. */}
                                                    {it.image ? (
                                                        <img src={it.image} alt="" loading="lazy"
                                                            className="h-12 w-12 flex-none rounded-md object-cover" />
                                                    ) : null}
                                                    <span className="min-w-0 flex-1">
                                                        <span className="flex justify-between gap-2">
                                                            <span className="break-words text-sm font-medium text-gray-900">{it.name}</span>
                                                            <span className="whitespace-nowrap text-sm font-semibold text-gray-900">
                                                                £{it.price.toFixed(2)}
                                                                {unitLabel(it.unit) ? (
                                                                    <span className="ml-1 font-normal text-gray-500">{unitLabel(it.unit)}</span>
                                                                ) : null}
                                                            </span>
                                                        </span>
                                                        {it.description ? (
                                                            <span className="block break-words text-xs text-gray-500">{it.description}</span>
                                                        ) : null}
                                                    </span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                </details>
                            )}

                            {/* HOW MANY, AND THE NUMBER BACK BEFORE THEY PAY.
                                A per-person or per-item price multiplies, and it
                                is the provider who turns up to the count — ten for
                                dinner is a different evening from four — so the
                                guest sets it and sees the sum spelled out before
                                the hold. A flat price shows none of this. */}
                            {(() => {
                                const item = pickedItem(p);
                                if (!item || !unitMultiplies(item.unit)) return null;
                                const qty = quantityFor(p);
                                return (
                                    <div className="mt-3">
                                        <label className="block text-xs text-gray-500">
                                            {quantityQuestion(item.unit)}
                                            <input
                                                type="number"
                                                min={1}
                                                max={MAX_ORDER_QUANTITY}
                                                inputMode="numeric"
                                                value={qtyFor[p.id] || 1}
                                                onChange={(e) => setQtyFor((s) => ({
                                                    ...s,
                                                    [p.id]: Math.min(Math.max(1, Math.floor(Number(e.target.value) || 1)), MAX_ORDER_QUANTITY),
                                                }))}
                                                className="mt-1 block w-24 rounded-md border border-gray-300 px-2 py-1 text-sm"
                                            />
                                        </label>
                                        <div className="mt-2 text-sm text-gray-700">
                                            £{item.price.toFixed(2)} {unitLabel(item.unit)} × {qty}
                                            <span className="mx-1">=</span>
                                            <span className="font-semibold text-gray-900">£{orderTotal(item.price, qty).toFixed(2)}</span>
                                            <span className="ml-1 text-xs text-gray-400">held, not charged</span>
                                        </div>
                                    </div>
                                );
                            })()}

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

                            {/* The reassurance, said plainly and BEFORE the button
                                rather than buried under it: this is a request, not
                                a payment. The card is authorised now, not charged —
                                so the reader knows the commitment is the provider's
                                to make first. The 48 hours is the real confirm
                                window (CONFIRM_WINDOW_HOURS). */}
                            <p className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-600">
                                <span className="font-semibold text-gray-900">Your card isn’t charged yet.</span>{' '}
                                {who} has 48 hours to confirm. You’re only charged if they say yes — if
                                they decline or don’t reply, nothing is taken.
                            </p>

                            <button
                                type="button"
                                disabled={busy === p.id}
                                onClick={() => request(p)}
                                className="mt-2 w-full rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                            >
                                {busy === p.id ? 'Sending…' : 'Send request'}
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
            )}

            {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        </section>
    );
}
