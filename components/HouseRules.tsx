'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ShieldAlert, Check, X, Clock } from 'lucide-react';
import { houseRulesView, type HouseRulesInput } from '@/lib/houseRules';

// One renderer for the house rules, shared by the reservation pages and the
// listing page so a guest reads the same words before and after booking.
//
// Two shapes:
//   - variant 'page' (the listing): the rules with a tick/cross, and a "Show
//     more" that expands the full set inline. Unchanged.
//   - variant 'card' (the stay reservation): Airbnb's shape — rule titles in
//     bold, no cross beside a "no …" rule, three shown, and the rest behind a
//     "Show more" that opens a MODAL with the full set, the times and any extra
//     rules. Every listing has house rules (sensible defaults), so this always
//     renders.
export default function HouseRules({
    listing,
    variant = 'card',
}: {
    listing: HouseRulesInput | null | undefined;
    variant?: 'card' | 'page';
}) {
    const v = houseRulesView(listing);
    const [open, setOpen] = useState(false);
    const isCard = variant !== 'page';

    const PREVIEW = 3;
    const preview = v.rules.slice(0, PREVIEW);

    // The listing keeps its tick/cross rows. The card bolds the title and drops
    // the cross: a "no parties" rule reads as itself, not as a red X. The icon
    // slot is kept (empty for a dropped cross) so every title still lines up.
    const RuleRow = ({ label, allowed, neutral }: { label: string; allowed: boolean; neutral?: boolean }) => {
        const icon = neutral
            ? <Clock className="h-4 w-4 text-slate-400" />
            : allowed
                ? <Check className="h-4 w-4 text-emerald-600" />
                : isCard ? null : <X className="h-4 w-4 text-slate-400" />;
        return (
            <li className="flex items-start gap-2.5 text-sm text-slate-700">
                <span className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center">{icon}</span>
                <span className={isCard ? 'font-semibold text-slate-900' : ''}>{label}</span>
            </li>
        );
    };

    const timesAndExtra = (
        <>
            <div className="mt-4 space-y-1 border-t border-slate-100 pt-4 text-sm text-slate-700">
                <div>
                    <span className="text-slate-500">Check-in:</span>{' '}
                    from {v.checkInFrom}{v.checkInUntil ? ' until ' + v.checkInUntil : ''}
                </div>
                <div><span className="text-slate-500">Checkout:</span> by {v.checkoutBy}</div>
            </div>
            {v.additional && (
                <div className="mt-4 border-t border-slate-100 pt-4">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Additional rules</div>
                    <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-700">{v.additional}</p>
                </div>
            )}
        </>
    );

    const heading = variant === 'page'
        ? <h2 className="flex items-center gap-2 text-xl font-semibold text-slate-900"><ShieldAlert className="h-5 w-5 text-slate-500" /> House rules</h2>
        : <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><ShieldAlert className="h-3.5 w-3.5" /> Rules and instructions</div>;

    // ---- Listing page: the existing inline expand, unchanged ----
    if (variant === 'page') {
        const panel = (
            <div className="mt-4 border-t border-slate-100 pt-4">
                <ul className="space-y-2.5">
                    {v.rules.map((r) => <RuleRow key={r.label} {...r} />)}
                </ul>
                {timesAndExtra}
                <button type="button" onClick={() => setOpen(false)} className="mt-4 text-sm font-medium text-slate-600 underline hover:text-slate-800">Show less</button>
            </div>
        );
        return (
            <div className="mt-8 pt-8 border-t">
                {heading}
                {open ? panel : (
                    <>
                        <ul className="mt-4 space-y-2.5">
                            {preview.map((r) => <RuleRow key={r.label} {...r} />)}
                        </ul>
                        <button type="button" onClick={() => setOpen(true)} className="mt-3 text-sm font-medium text-slate-600 underline hover:text-slate-800">Show more</button>
                    </>
                )}
            </div>
        );
    }

    // ---- Reservation card: three rules, the rest behind a modal ----
    const hasMore = v.rules.length > PREVIEW || !!v.additional;
    return (
        <div>
            {heading}
            <ul className="mt-3 space-y-2.5">
                {preview.map((r) => <RuleRow key={r.label} {...r} />)}
            </ul>
            {hasMore && (
                <button type="button" onClick={() => setOpen(true)} className="mt-3 text-sm font-medium text-slate-600 underline hover:text-slate-800">
                    Show all {v.rules.length} rules
                </button>
            )}

            {open && typeof document !== 'undefined' && createPortal(
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-0 sm:items-center sm:px-4" onClick={() => setOpen(false)}>
                    <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-6 pt-6">
                            <h2 className="text-lg font-bold text-slate-900">House rules</h2>
                            <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">
                            <ul className="space-y-3">
                                {v.rules.map((r) => <RuleRow key={r.label} {...r} />)}
                            </ul>
                            {timesAndExtra}
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
