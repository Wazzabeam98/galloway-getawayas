'use client';

import { useState } from 'react';
import { unitMultiplies } from '@/lib/serviceOrders';
import { itemPriceLabel } from '@/components/marketplace/present';
import BookingDialog, { type BookArgs } from '@/components/marketplace/BookingDialog';

interface PanelItem { id: string; name: string; price: number; unit: string; image: string | null; fulfilment?: string | null; capacity: number | null; minPeople: number | null; }
interface PanelSession { date: string; time: string; row: { capacity: number; seats_taken: number; private: boolean } | null; }
interface PanelDeclared { id: string; date: string; time: string; duration: number; capacity: number; seats_taken: number; private: boolean; title: string | null; }

// The standalone (bookingless) booking box for a SLOT experience — the public
// listing's right column. Airbnb-shaped: a price and one "Show dates" button,
// nothing before a choice is made. The button opens the availability dialog;
// picking a slot goes straight to Stripe Checkout, which collects the email and
// card. No contact form here — a brand-new guest's account is minted from the
// Stripe payer email after payment (passwordless), so the inbox is the only way in.
export default function StandaloneBookingPanel({ provider }: {
    provider: {
        id: string; who: string; shape: string; fulfilment?: string | null; isFood?: boolean;
        slotCapacity: number; minPeople: number; items: PanelItem[]; sessions: PanelSession[];
        declaredSessions?: PanelDeclared[];
    };
    // Accepted for compatibility with the host page; booking no longer needs them.
    signedIn?: boolean;
    signInNext?: string;
}) {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const declaredSessions = provider.declaredSessions || [];
    // "From £X per person" — the cheapest option, per-person where that's the unit.
    const cheapest = provider.items.length ? provider.items.reduce((a, b) => (a.price <= b.price ? a : b)) : null;
    const priceLabel = cheapest ? 'From ' + itemPriceLabel(cheapest.price, cheapest.unit) : '';
    const hasAnything = provider.sessions.length > 0 || declaredSessions.length > 0;

    async function book(args: BookArgs) {
        setBusy(true); setError(null);
        try {
            const res = await fetch('/api/services/slots/book', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    providerId: provider.id, itemId: args.itemId, sessionDate: args.date, sessionTime: args.time,
                    quantity: args.quantity, attendees: args.attendees,
                    serviceAddress: args.serviceAddress, allergy: args.allergy,
                }),
            });
            const j = await res.json();
            if (!res.ok || !j.ok || !j.url) { setError(j.error || 'Could not start that. Try again.'); setBusy(false); return; }
            window.location.href = j.url;   // → Stripe Checkout
        } catch {
            setError('Could not start that. Try again.'); setBusy(false);
        }
    }

    return (
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
            <div className="text-2xl font-semibold text-slate-900">{priceLabel}</div>
            <span className="mt-2 inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                Instant book — confirmed straight away
            </span>

            <button type="button" onClick={() => setOpen(true)} disabled={!hasAnything}
                className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-black disabled:opacity-50">
                {hasAnything ? 'Show dates' : 'No times available'}
            </button>
            <p className="mt-2 text-xs text-slate-400">You’ll enter your details at checkout. Galloway Getaways takes the payment on {provider.who}’s behalf and is not the provider.</p>

            {open && (
                <BookingDialog
                    who={provider.who}
                    items={provider.items}
                    sessions={provider.sessions}
                    declaredSessions={declaredSessions}
                    providerCapacity={provider.slotCapacity}
                    providerMinPeople={provider.minPeople}
                    providerFulfilment={provider.fulfilment}
                    isFood={provider.isFood}
                    busy={busy}
                    error={error}
                    onBook={book}
                    onClose={() => { if (!busy) { setOpen(false); setError(null); } }}
                />
            )}
        </div>
    );
}
