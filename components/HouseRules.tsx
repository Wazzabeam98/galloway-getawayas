'use client';

import { useState } from 'react';
import { ShieldAlert, Check, X, Clock } from 'lucide-react';
import { houseRulesView, type HouseRulesInput } from '@/lib/houseRules';

// One renderer for the house rules, shared by the trip card and the listing
// page so a guest reads the same words before and after booking. Airbnb's shape:
// a short list of the rules, then "Show more" opening the full set with the
// check-in/checkout times and any additional rules. Every listing has house
// rules (sensible defaults apply), so this always renders.
export default function HouseRules({
    listing,
    variant = 'card',
}: {
    listing: HouseRulesInput | null | undefined;
    variant?: 'card' | 'page';
}) {
    const v = houseRulesView(listing);
    const [open, setOpen] = useState(false);

    const PREVIEW = 3;
    const preview = v.rules.slice(0, PREVIEW);

    const RuleRow = ({ label, allowed, neutral }: { label: string; allowed: boolean; neutral?: boolean }) => (
        <li className="flex items-start gap-2.5 text-sm text-slate-700">
            {neutral
                ? <Clock className="mt-0.5 h-4 w-4 flex-none text-slate-400" />
                : allowed
                    ? <Check className="mt-0.5 h-4 w-4 flex-none text-emerald-600" />
                    : <X className="mt-0.5 h-4 w-4 flex-none text-slate-400" />}
            <span>{label}</span>
        </li>
    );

    const panel = (
        <div className="mt-4 border-t border-slate-100 pt-4">
            <ul className="space-y-2.5">
                {v.rules.map((r) => <RuleRow key={r.label} {...r} />)}
            </ul>
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
            <button
                type="button"
                onClick={() => setOpen(false)}
                className="mt-4 text-sm font-medium text-slate-600 underline hover:text-slate-800"
            >
                Show less
            </button>
        </div>
    );

    const heading = variant === 'page'
        ? <h2 className="flex items-center gap-2 text-xl font-semibold text-slate-900"><ShieldAlert className="h-5 w-5 text-slate-500" /> House rules</h2>
        : <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><ShieldAlert className="h-3.5 w-3.5" /> Rules and instructions</div>;

    const wrapper = variant === 'page'
        ? 'mt-8 pt-8 border-t'
        : 'mt-8 rounded-2xl border border-slate-200 p-6 sm:p-7';

    return (
        <div className={wrapper}>
            {heading}
            {open ? panel : (
                <>
                    <ul className={variant === 'page' ? 'mt-4 space-y-2.5' : 'mt-3 space-y-2.5'}>
                        {preview.map((r) => <RuleRow key={r.label} {...r} />)}
                    </ul>
                    <button
                        type="button"
                        onClick={() => setOpen(true)}
                        className="mt-3 text-sm font-medium text-slate-600 underline hover:text-slate-800"
                    >
                        Show more
                    </button>
                </>
            )}
        </div>
    );
}
