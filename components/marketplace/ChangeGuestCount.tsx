'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Users, Minus, Plus, Loader2, ChevronRight, X } from 'lucide-react';
import { childrenAllowed } from '@/lib/guestAges';
import { partyPrice } from '@/lib/extraGuests';

// "Change guest count" — a reservation ACTION row that opens a MODAL over the
// page. ONE sheet for every shape; it adapts to the booking's engine:
//
//   - SLOT (per-person): the original flow — the stepper only rises, and an added
//     place is a separate charge (a child order) through Checkout. Past the
//     session cutoff the added place is non-refundable, stated plainly.
//   - REQUEST, per-person (made_to_order / comes_to_you with a multiplying unit):
//     the count moves money BOTH ways under the cancellation policy. Inside the
//     free-cancellation window a lower count refunds the difference at once and a
//     higher one tops up through Checkout; past the window it can only rise.
//   - REQUEST, per-group (a flat price): the count is the party size — it changes
//     no money, only respects capacity, and saves in place.
//
// The sheet says which rule applies before the guest confirms. Payer-only: the
// page renders it for the booker alone and the route is the real wall.

interface Quote {
    // shared
    unitPrice: number;
    adults: number | null;
    children: number | null;
    itemName: string | null;
    minAge: number | null;
    // slot
    seatsLeft?: number;
    headcount?: number;
    maxAddable?: number;
    deadlineISO?: string;
    insideWindow?: boolean;
    // request
    perGroup?: boolean;
    mode?: 'people' | 'quantity' | 'group';
    current?: number;
    min?: number;
    max?: number;
    free?: boolean;
    closed?: boolean;          // past the window — no changes
    providerName?: string | null;
    // flat item with extra-guests pricing: the party moves the fee.
    extraGuests?: boolean;
    includedGuests?: number;
    extraAdultFee?: number;
    extraChildFee?: number;
    currentPrice?: number;
}

function money(n: number): string {
    return '£' + (Math.round(Math.abs(n) * 100) / 100).toFixed(2);
}
function people(n: number, kind: 'adult' | 'child'): string {
    if (kind === 'adult') return n + (n === 1 ? ' adult' : ' adults');
    return n + (n === 1 ? ' child' : ' children');
}
function cutoffLabel(iso: string): string {
    try {
        return new Intl.DateTimeFormat('en-GB', {
            weekday: 'short', day: 'numeric', month: 'short',
            hour: 'numeric', minute: '2-digit', timeZone: 'Europe/London',
        }).format(new Date(iso));
    } catch { return 'the cancellation deadline'; }
}

function Stepper({ label, value, set, min, max, disabled }: { label: string; value: number; set: (n: number) => void; min: number; max: number; disabled?: boolean }) {
    return (
        <div className="flex items-center justify-between py-1">
            <span className="text-sm text-slate-700">{label}</span>
            <div className="flex items-center gap-3">
                <button type="button" aria-label={'Fewer ' + label} disabled={disabled || value <= min}
                    onClick={() => set(Math.max(min, value - 1))}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-slate-600 disabled:opacity-40">
                    <Minus className="h-4 w-4" />
                </button>
                <span className="w-5 text-center text-sm font-semibold text-slate-900">{value}</span>
                <button type="button" aria-label={'More ' + label} disabled={disabled || value >= max}
                    onClick={() => set(Math.min(max, value + 1))}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-slate-600 disabled:opacity-40">
                    <Plus className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}

export default function ChangeGuestCount({ orderId, shape, className }: { orderId: string; shape?: string | null; className?: string }) {
    const isRequest = shape === 'made_to_order' || shape === 'comes_to_you';
    const base = isRequest ? '/api/services/order/change-count' : '/api/services/slots/top-up';

    const [open, setOpen] = useState(false);
    const [quote, setQuote] = useState<Quote | null>(null);
    const [loadErr, setLoadErr] = useState<string | null>(null);
    const [adults, setAdults] = useState(1);
    const [children, setChildren] = useState(0);
    const [group, setGroup] = useState(1);              // per-group party size
    const [childrenShown, setChildrenShown] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function loadQuote() {
        setLoadErr(null);
        try {
            const r = await fetch(base + '?orderId=' + encodeURIComponent(orderId));
            const d = await r.json();
            if (!r.ok || !d.ok) { setLoadErr(d && d.error ? d.error : 'Could not load this.'); return; }
            const q = d as Quote;
            setQuote(q);
            if (q.extraGuests) {
                // A flat extra-guests item: an adults/children split that moves the fee.
                setAdults(Math.max(1, q.adults != null ? q.adults : 1));
                setChildren(q.children != null ? q.children : 0);
            } else if (q.perGroup || q.mode === 'quantity') {
                setGroup(Math.max(1, q.current || 1));
            } else {
                const seedAdults = q.adults != null ? q.adults : Math.max(1, (isRequest ? q.current : q.headcount) || 1);
                setAdults(seedAdults);
                setChildren(q.children != null ? q.children : 0);
            }
            setChildrenShown((q.children || 0) > 0);
            setError(null);
        } catch { setLoadErr('Could not load this.'); }
    }

    function openModal() { setOpen(true); setChildrenShown(false); loadQuote(); }
    function closeModal() { setOpen(false); }

    const extra = !!(quote && quote.extraGuests);
    const perGroup = !!(quote && quote.perGroup) && !extra;
    // How the count is shown: a people split (adults/children), a single quantity
    // stepper (made_to_order), or a single group-size stepper (a flat price, no
    // money). A flat item WITH extra-guests pricing splits people and moves the
    // fee. Slots always split people.
    const mode: 'people' | 'quantity' | 'group' = extra ? 'people' : (perGroup ? 'group' : (isRequest ? (quote?.mode || 'people') : 'people'));
    const single = mode === 'group' || mode === 'quantity';
    const unitPrice = quote ? quote.unitPrice : 0;
    const kidsOk = childrenAllowed(quote ? quote.minAge : null);

    // --- SLOT bounds (rise only, seats-limited) ---------------------------------
    const oldAdults = quote ? (quote.adults != null ? quote.adults : Math.max(1, (isRequest ? quote.current : quote.headcount) || 1)) : 1;
    const oldChildren = quote ? (quote.children != null ? quote.children : 0) : 0;
    const oldCount = single ? (quote!.current || 1) : (oldAdults + oldChildren);

    // Bounds differ by engine. Slot: rises only, limited by seats left. Request:
    // moves within [min, max] the route returned (min already collapses to the
    // current count once past the window, so a reduction is simply not offered).
    const seatsLeft = quote && !isRequest ? (quote.seatsLeft || 0) : 0;
    const reqMin = quote && isRequest ? (quote.min || 1) : oldCount;
    const reqMax = quote && isRequest ? (quote.max || oldCount) : (oldCount + Math.max(0, seatsLeft));

    const adultsMin = isRequest ? Math.max(1, reqMin - children) : oldAdults;
    const adultsMax = isRequest ? (reqMax - children) : oldAdults + Math.max(0, seatsLeft - (children - oldChildren));
    const childrenMin = isRequest ? 0 : oldChildren;
    const childrenMax = isRequest ? (reqMax - adults) : oldChildren + Math.max(0, seatsLeft - (adults - oldAdults));

    const newCount = single ? group : (adults + children);
    const delta = newCount - oldCount;                 // +rise, −fall
    // Extra-guests money follows the party price, not a flat per-head unit.
    const egItem = extra && quote ? {
        unit: 'flat', price: quote.unitPrice,
        included_guests: quote.includedGuests ?? null,
        extra_adult_fee: quote.extraAdultFee ?? null,
        extra_child_fee: quote.extraChildFee ?? null,
        max_party: quote.max ?? null,
    } : null;
    const money0 = extra && egItem
        ? partyPrice(egItem as any, adults, kidsOk ? children : 0, quote!.minAge) - partyPrice(egItem as any, oldAdults, oldChildren, quote!.minAge)
        : (mode === 'group' ? 0 : unitPrice * delta);
    const free = quote ? (isRequest ? !!quote.free : !quote.insideWindow) : true;

    const slotFull = !isRequest && quote ? (quote.seatsLeft || 0) < 1 : false;

    async function proceed() {
        if (!quote) return;
        setBusy(true); setError(null);
        try {
            let body: any;
            if (isRequest) {
                body = extra
                    ? { orderId, count: newCount, adults, children }
                    : single
                        ? { orderId, count: group }
                        : { orderId, count: newCount, children: Math.max(0, children - oldChildren) };
            } else {
                body = { orderId, quantity: delta, children: Math.max(0, children - oldChildren) };
            }
            const r = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const d = await r.json();
            if (d && d.ok && d.url) { window.location.href = d.url; return; }   // a rise → pay
            if (d && d.ok) { window.location.reload(); return; }                 // a fall / group / saved
            setError((d && d.error) || 'Could not do that.');
        } catch { setError('Could not do that.'); }
        setBusy(false);
    }

    const Diff = ({ oldN, newN, kind }: { oldN: number; newN: number; kind: 'adult' | 'child' }) => {
        const changed = newN !== oldN;
        const showOld = changed && oldN > 0;
        const showNew = newN > 0;
        return (
            <span className="text-sm text-slate-700">
                {showOld && <span className="text-slate-400 line-through">{people(oldN, kind)}</span>}
                {showOld && showNew ? ' ' : null}
                {showNew && <span className={changed ? 'font-semibold text-slate-900' : ''}>{people(newN, kind)}</span>}
            </span>
        );
    };

    // The confirm button's label + whether it's enabled, by what the change does.
    const confirmLabel = mode === 'group'
        ? 'Save group size'
        // A rise on a request shape is a REQUEST the provider accepts — the card is
        // only held. A slot rise is instant. A fall always refunds instantly.
        : delta > 0 ? (isRequest ? 'Request & hold ' + money(money0) : 'Continue to payment · ' + money(money0))
        : delta < 0 ? 'Reduce & refund ' + money(money0)
        : 'Change guest count';
    const canConfirm = !!quote && !busy && !slotFull && delta !== 0;

    const trigger = (
        <button type="button" onClick={openModal}
            className={className || 'text-sm font-medium text-slate-500 underline underline-offset-2 hover:text-slate-800'}>
            {className ? (
                <>
                    <span className="flex items-center gap-3"><Users className="h-4 w-4 flex-none text-slate-400" /> Change guest count</span>
                    <ChevronRight className="h-4 w-4 flex-none text-slate-300" />
                </>
            ) : 'Change guest count'}
        </button>
    );

    return (
        <>
            {trigger}

            {open && typeof document !== 'undefined' && createPortal(
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-0 sm:items-center sm:px-4" onClick={closeModal}>
                    <div className="flex max-h-[92vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 pt-5">
                            <h2 className="text-lg font-bold text-slate-900">Change guest count</h2>
                            <button type="button" onClick={closeModal} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-3">
                            {loadErr ? (
                                <p className="text-sm text-rose-600">{loadErr}</p>
                            ) : !quote ? (
                                <p className="text-sm text-slate-400">Loading…</p>
                            ) : (quote.closed || !free) ? (
                                <div className="space-y-3">
                                    <p className="text-sm text-slate-600">Changes are closed now — the free-cancellation window has passed. Message {quote.providerName || 'the provider'} if you need to change anything.</p>
                                    <a href={'/messages?o=' + orderId} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800">
                                        Message {quote.providerName || 'the provider'}
                                    </a>
                                </div>
                            ) : slotFull ? (
                                <p className="text-sm text-slate-600">This session is full — there are no more places to add.</p>
                            ) : (
                                <div className="space-y-3">
                                    {single ? (
                                        <Stepper label={mode === 'group' ? 'Group size' : 'Quantity'} value={group} set={setGroup} min={reqMin} max={reqMax} />
                                    ) : (
                                        <>
                                            <Stepper label="Adults" value={adults} set={setAdults} min={adultsMin} max={adultsMax} />
                                            {kidsOk && (childrenShown || oldChildren > 0) && (
                                                <Stepper label="Children (4–12)" value={children} set={setChildren} min={childrenMin} max={childrenMax} />
                                            )}
                                            {kidsOk && !childrenShown && oldChildren === 0 && (
                                                <button type="button" onClick={() => setChildrenShown(true)}
                                                    className="text-sm font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900">
                                                    Add children
                                                </button>
                                            )}
                                        </>
                                    )}

                                    <div className="rounded-lg bg-slate-50 p-3">
                                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{quote.itemName || 'Your booking'}</div>
                                        {single ? (
                                            <div className="mt-1 text-sm text-slate-700">
                                                {group === oldCount ? group + (mode === 'quantity' ? '' : (group === 1 ? ' person' : ' people')) : (
                                                    <><span className="text-slate-400 line-through">{oldCount}</span> <span className="font-semibold text-slate-900">{group}</span>{mode === 'quantity' ? '' : (group === 1 ? ' person' : ' people')}</>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                                                <Diff oldN={oldAdults} newN={adults} kind="adult" />
                                                {(children > 0 || oldChildren > 0) && <Diff oldN={oldChildren} newN={children} kind="child" />}
                                            </div>
                                        )}
                                        {mode !== 'group' && (
                                            <div className="mt-2 space-y-1 border-t border-slate-200 pt-2 text-sm">
                                                <div className="flex items-center justify-between text-slate-600">
                                                    <span>{delta > 0 ? 'To pay' : delta < 0 ? 'Refund' : 'Price change'}{delta !== 0 ? ' · ' + Math.abs(delta) + (Math.abs(delta) === 1 ? ' place' : ' places') : ''}</span>
                                                    <span>{delta < 0 ? '−' : ''}{money(money0)}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Which rule applies — said before the guest confirms. */}
                                    {mode === 'group' ? (
                                        <p className="text-[13px] text-slate-500">Group size only — this doesn’t change the price.</p>
                                    ) : isRequest ? (
                                        free ? (
                                            <p className="text-[13px] text-slate-500">You can change this freely right now — a lower count is refunded, a higher one is charged.</p>
                                        ) : (
                                            <p className="text-[13px] font-medium text-slate-600">The free-cancellation window has passed — you can add places, but removing them isn’t refundable.</p>
                                        )
                                    ) : (
                                        free ? (
                                            <p className="text-[13px] text-slate-500">{quote.deadlineISO ? 'Free to cancel until ' + cutoffLabel(quote.deadlineISO) + '; after that an added place isn’t refundable.' : ''}</p>
                                        ) : (
                                            <p className="text-[13px] font-medium text-slate-600">Non-refundable</p>
                                        )
                                    )}

                                    {error && <p className="text-[13px] text-rose-600">{error}</p>}
                                </div>
                            )}
                        </div>

                        {quote && !quote.closed && free && !slotFull && !loadErr && (
                            <div className="border-t border-slate-100 p-4">
                                <button type="button" disabled={!canConfirm} onClick={proceed}
                                    className={
                                        'inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-50 '
                                        + (delta < 0 ? 'bg-slate-800 hover:bg-slate-900' : 'bg-emerald-700 hover:bg-emerald-800')
                                    }>
                                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                    {confirmLabel}
                                </button>
                            </div>
                        )}
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
