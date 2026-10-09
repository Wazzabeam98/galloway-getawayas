'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { priceParts, cancellationBadge } from '@/components/marketplace/present';
import BookingDialog, { type BookArgs } from '@/components/marketplace/BookingDialog';
import DatePreview from '@/components/marketplace/DatePreview';
import { fetchAgreementStatus, recordAgreement } from '@/components/legal/AgreementTick';
import { AGREEMENTS } from '@/lib/agreements';

interface PanelItem { id: string; name: string; price: number; duration_minutes?: number | null; unit: string; image: string | null; fulfilment?: string | null; capacity: number | null; minPeople: number | null; }
interface PanelSession { date: string; time: string; row: { capacity: number; seats_taken: number; private: boolean } | null; }
interface PanelDeclared { id: string; date: string; time: string; duration: number; capacity: number; seats_taken: number; private: boolean; title: string | null; }

// The standalone (bookingless) booking box for a SLOT experience — the public
// listing's right column. Airbnb-shaped: a price and one "Show dates" button,
// nothing before a choice is made. The button opens the availability dialog;
// picking a slot goes straight to Stripe Checkout, which collects the email and
// card. No contact form here — a brand-new guest's account is minted from the
// Stripe payer email after payment (passwordless), so the inbox is the only way in.
export default function StandaloneBookingPanel({ provider, signedIn }: {
    provider: {
        id: string; who: string; shape: string; fulfilment?: string | null; isFood?: boolean;
        slotCapacity: number; minPeople: number; slotLength?: number; items: PanelItem[]; sessions: PanelSession[];
        declaredSessions?: PanelDeclared[];
        cancellationHours?: number | null; noRefund?: boolean | null;
        minAge?: number | null;
    };
    // signedIn tells us whether this is an anonymous checkout; signInNext is kept
    // for compatibility with the host page.
    signedIn?: boolean;
    signInNext?: string;
}) {
    const [open, setOpen] = useState(false);
    // The phone bottom bar is portalled to <body>, which the server can't do —
    // so it draws after mount, or the server and first client render disagree
    // (a hydration error on every experience page).
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);
    const [initialDate, setInitialDate] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // THE GUEST TERMS TICK, shown above the Book button whenever this guest owes
    // them. Two cases:
    //   * signed in and owes → accept here and record before the order, against
    //     their account (recordAgreement).
    //   * anonymous (no account yet — it is minted from the Stripe payer email
    //     after payment) → still tick here, but there is nothing to record
    //     against, so the accepted version rides on the order and is written
    //     against the account the moment it is minted (the webhook). An anonymous
    //     booker always owes them, so the tick is always shown for them.
    const anonymous = !signedIn;
    const [needsGuestTerms, setNeedsGuestTerms] = useState(anonymous);
    useEffect(() => {
        if (anonymous) { setNeedsGuestTerms(true); return; }
        let cancelled = false;
        fetchAgreementStatus().then((st) => {
            // Fail CLOSED: keep the tick unless we have POSITIVELY confirmed the
            // guest has agreed. A null (lookup error / unreachable table) must
            // not drop the tick and let them book without a recorded agreement.
            if (!cancelled) setNeedsGuestTerms(!(st && st.documents && st.documents.guest && st.documents.guest.agreed));
        });
        return () => { cancelled = true; };
    }, [anonymous]);

    const declaredSessions = provider.declaredSessions || [];
    // The cheapest option, with the unit the provider chose — "From £15 / guest",
    // "£475 / event"; a timed treatment reads plainly.
    const pricedItems = provider.items.filter((i) => i.price > 0);
    const cheapest = pricedItems.length ? pricedItems.reduce((a, b) => (a.price <= b.price ? a : b)) : null;
    const parts = cheapest ? priceParts(cheapest.price, cheapest.unit, (cheapest.duration_minutes ?? 0) > 0) : null;
    const showFrom = pricedItems.length > 1;
    const cancel = cancellationBadge(provider.cancellationHours, provider.noRefund);
    const hasAnything = provider.sessions.length > 0 || declaredSessions.length > 0;

    async function book(args: BookArgs) {
        setBusy(true); setError(null);
        // The Guest Terms, when owed. A signed-in guest records them now, against
        // their account; an anonymous one carries the ticked version on the order
        // (guestTermsVersion below), recorded against the account when it is minted.
        let guestTermsVersion: string | undefined;
        if (needsGuestTerms) {
            if (anonymous) {
                guestTermsVersion = AGREEMENTS.guest.version;
            } else {
                const failed = await recordAgreement('guest', 'experience_checkout');
                if (failed) { setError(failed); setBusy(false); return; }
                setNeedsGuestTerms(false);
            }
        }
        try {
            const res = await fetch('/api/services/slots/book', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    providerId: provider.id, itemId: args.itemId, sessionDate: args.date, sessionTime: args.time,
                    quantity: args.quantity, attendees: args.attendees,
                    adults: args.adults, children: args.children,
                    serviceAddress: args.serviceAddress, allergy: args.allergy,
                    guestTermsVersion,
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
        <>
            {/* Desktop: the inline lifted card. On a phone it's replaced by the
                bottom bar below (the cottage's pattern), so it's hidden there. */}
            <div className="hidden lg:block rounded-2xl bg-white p-5 border border-slate-200 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
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
            </div>

            {/* Phone: the fixed bottom bar — price and one "Check availability"
                button that opens the same dialog, the cottage's bottom-bar
                mechanism. Hidden while the dialog is open (the dialog covers it).
                Portalled to the body so it sits above the page. */}
            {mounted && !open && createPortal(
                <div className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-2px_12px_rgba(0,0,0,0.06)]">
                    <div className="mb-2.5">
                        {parts ? (
                            <p className="text-base font-bold text-slate-900 leading-tight">
                                {(showFrom ? 'From ' : '') + parts.money}
                                {parts.per && <span className="text-sm font-normal text-slate-500"> {parts.per}</span>}
                            </p>
                        ) : null}
                        <p className={`text-xs font-medium ${provider.noRefund ? 'text-slate-500' : 'text-emerald-700'}`}>{cancel}</p>
                    </div>
                    <button type="button" onClick={() => setOpen(true)} disabled={!hasAnything}
                        className="w-full rounded-lg bg-emerald-700 py-3.5 text-base font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50">
                        {hasAnything ? 'Check availability' : 'No times'}
                    </button>
                </div>, document.body,
            )}

            {open && (
                <BookingDialog
                    slotLength={provider.slotLength}
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
                    needsGuestTerms={needsGuestTerms}
                    busy={busy}
                    error={error}
                    onBook={book}
                    onClose={() => { if (!busy) { setOpen(false); setInitialDate(null); setError(null); } }}
                />
            )}
        </>
    );
}
