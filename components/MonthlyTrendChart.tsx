'use client';

import { useState } from 'react';

// The monthly earnings bars.
//
// A CLIENT COMPONENT FOR ONE REASON: on a phone there is nowhere to put the
// number. The bars are 19px wide there, and the only way the £ figure was ever
// available was the `title` attribute — which is a mouse hover, and a host
// looking at this is holding a phone. They got the shape of their year and
// none of the amounts.
//
// WHAT WAS WRONG WITH THE OLD ONE
//
// Twelve bars at a 28px minimum with a 12px gap is 468px of content. The card
// gives it 277px on a 375px screen, so five months sat outside the box behind
// a horizontal scroll with no scrollbar and no fade — a host saw seven months
// of their year and nothing telling them there were more. Measured at 375px
// and 414px; it is fine from about 570px up, which is to say on no phone.
//
// The fix is the one the booking calendar already uses: make it fit. That grid
// is `grid-cols-7` and never scrolls sideways. Here it means dropping the
// minimum bar width and the gap below `sm`, which gets twelve months into
// 277px at 19px each.
//
// A 19px bar cannot hold "Sept" — the label is 26px — so the month names go to
// single letters on a phone and back to three at `sm`. Ambiguous in isolation,
// which they are not: it is always twelve months, always in order.

export interface TrendMonth {
    label: string;
    net: number;
}

export default function MonthlyTrendChart({ months }: { months: TrendMonth[] }) {
    // The month whose figure is being shown. Defaults to the best one, so
    // there is a real number on screen before anybody touches anything —
    // otherwise a phone shows a shape and no amounts until it is prodded.
    const best = months.reduce(
        (winner, m, i) => (m.net > months[winner].net ? i : winner),
        0
    );
    const [shown, setShown] = useState<number | null>(null);
    const active = shown === null ? best : shown;

    const maxMonth = Math.max(1, ...months.map((m) => m.net));
    const money = (n: number) =>
        '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    return (
        <div>
            {/* The readout. This is where the numbers live now, so it says
                which month it is talking about — a bare figure over a strip of
                twelve bars belongs to none of them. */}
            <p className="text-sm mb-4" aria-live="polite">
                <span className="font-semibold text-slate-900">{months[active]?.label}</span>
                <span className="text-slate-400"> · </span>
                <span className="font-semibold text-slate-900">{money(months[active]?.net || 0)}</span>
                {shown === null && months[best]?.net > 0 && (
                    <span className="text-slate-400"> · best month</span>
                )}
            </p>

            <div className="flex items-end gap-1 sm:gap-3 h-40">
                {months.map((m, i) => {
                    const pct = (m.net / maxMonth) * 100;
                    const isActive = i === active;

                    return (
                        <button
                            key={`${m.label}-${i}`}
                            type="button"
                            // A button, not a div: this is the only way to the
                            // figure on a touch screen, and it has to be
                            // reachable by keyboard too. onFocus as well as
                            // onClick, so tabbing through reads them out.
                            onClick={() => setShown(i)}
                            onFocus={() => setShown(i)}
                            onMouseEnter={() => setShown(i)}
                            title={`${m.label} — ${money(m.net)}`}
                            aria-label={`${m.label}, ${money(m.net)}`}
                            className="flex-1 min-w-0 sm:min-w-[28px] flex flex-col items-center justify-end h-full group"
                        >
                            {/* The track. Without it a month that earned
                                nothing next to a month that earned five
                                thousand is an invisible column, and a host
                                cannot tell "nothing happened" from "this chart
                                only has eight months in it". The bar sits on
                                top of it. */}
                            <span className="relative w-full flex-1 flex items-end">
                                <span
                                    aria-hidden="true"
                                    className="absolute inset-0 bg-slate-100 rounded-lg"
                                />
                                <span
                                    className={
                                        'relative w-full rounded-t-lg transition-colors '
                                        + (isActive ? 'bg-emerald-800' : 'bg-emerald-700')
                                        // A month with money in it is never
                                        // thinner than this, so a quiet month
                                        // beside a huge one is still a mark
                                        // rather than a hairline.
                                        + (m.net > 0 ? ' min-h-[6px]' : '')
                                    }
                                    style={{ height: `${pct}%` }}
                                />
                            </span>

                            <span
                                className={
                                    'text-xs mt-2 transition-colors '
                                    + (isActive ? 'text-slate-900 font-semibold' : 'text-slate-500')
                                }
                            >
                                {/* One letter on a phone, three from sm up.
                                    Both rendered, one hidden, so there is no
                                    layout shift and no JS deciding it. */}
                                <span className="sm:hidden">{m.label.slice(0, 1)}</span>
                                <span className="hidden sm:inline">{m.label}</span>
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
