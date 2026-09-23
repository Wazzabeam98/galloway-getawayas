'use client';

import { useState } from 'react';
import { priceParts, cancellationBadge } from '@/components/marketplace/present';
import BookingDialog, { type BookArgs } from '@/components/marketplace/BookingDialog';
import DatePreview from '@/components/marketplace/DatePreview';

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
        slotCapacity: number; minPeople: number; slotLength?: number; items: PanelItem[]; sessions: PanelSession[];
        declaredSessions?: PanelDeclared[];
        cancellationHours?: number | null; noRefund?: boolean | null;
        minAge?: number | null;
    };
    // Accepted for compatibility with the host page; booking no longer needs them.
    signedIn?: boolean;
    signInNext?: string;
}) {
    const [open, setOpen] = useState(false);
    const [initialDate, setInitialDate] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const declaredSessions = provider.declaredSessions || [];
    // The cheapest option, per-person where that's the unit — "From £15 / guest".
    const cheapest = provider.items.length ? provider.items.reduce((a, b) => (a.price <= b.price ? a : b)) : null;
    const parts = cheapest ? priceParts(cheapest.price, cheapest.unit) : null;
    const showFrom = provider.items.length > 1;
    const cancel = cancellationBadge(provider.cancellationHours, provider.noRefund);
    const hasAnything = provider.sessions.length > 0 || declaredSessions.length > 0;

    async function book(args: BookArgs) {
        setBusy(true); setError(null);
        try {
            const res = await fetch('/api/services/slots/book', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    providerId: provider.id, itemId: args.itemId, sessionDate: args.date, sessionTime: args.time,
                    quantity: args.quantity, attendees: args.attendees,
                    adults: args.adults, children: args.children,
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

    // Tapping a day in the panel opens the dialog on that day's times.
    const openOn = (d: string | null) => { setInitialDate(d); setOpen(true); };

    return (
        <div className="rounded-2xl bg-white p-5 border border-slate-200 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
            <div className="flex items-start justify-between gap-3">
                <div>
                    {parts && (
                        <div className="text-slate-900">
                            <span className="text-xl font-semibold">{(showFrom ? 'From ' : '') + parts.money}</span>
                            {parts.per && <span className="ml-1 text-sm font-normal text-slate-500">{parts.per}</span>}
                        </div>
                    )}
                    <p className={`mt-0.5 text-sm font-medium ${provider.noRefund ? 'text-slate-500' : 'text-emerald-700'}`}>{cancel}</p>
                </div>
                <button type="button" onClick={() => setOpen(true)} disabled={!hasAnything}
                    className="flex-none rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50">
                    {hasAnything ? 'Show dates' : 'No times'}
                </button>
            </div>

            {/* The next few available dates, right in the panel. */}
            <DatePreview
                items={provider.items}
                sessions={provider.sessions}
                declaredSessions={declaredSessions}
                providerCapacity={provider.slotCapacity}
                providerMinPeople={provider.minPeople}
                slotLength={provider.slotLength}
                busy={busy}
                onPickDay={(d) => openOn(d)}
                onShowAll={() => openOn(null)}
            />

            {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}

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
                    minAge={provider.minAge}
                    initialDate={initialDate}
                    busy={busy}
                    error={error}
                    onBook={book}
                    onClose={() => { if (!busy) { setOpen(false); setInitialDate(null); setError(null); } }}
                />
            )}
        </div>
    );
}
