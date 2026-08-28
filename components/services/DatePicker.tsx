'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Picking a day, in something that looks like the rest of the site.
//
// WHY NOT <input type="date">
//
// It was one, and it looked twenty years old next to everything around it:
// the browser's own control, small, cramped, and on a phone a tap target the
// size of a word. It is also the one control on the page whose appearance
// nobody can influence.
//
// WHY IT IS INLINE AND NOT A POPOVER
//
// This sits inside a modal whose middle scrolls — see the Shell in
// EnquiryForm. A popover calendar in there is the clipping problem the
// booking calendar already met: an absolutely positioned panel inside an
// `overflow-y-auto` ancestor is clipped by it, and the half you cannot see is
// the half with the days in it. Worse, it fails at exactly one window height
// and looks fine at every other, so it survives a check on a desktop and
// breaks on a laptop.
//
// components/BookingWidget.tsx solved the same problem the same way: the
// calendar is rendered in flow, in a bordered box, and simply makes the
// content taller. Taller is free now that the card scrolls with a pinned
// footer. There is nothing to clip because there is nothing floating.
//
// TAP TARGETS
//
// Cells are at least 44px tall, which is the thumb guideline, and as wide as
// seven columns leave — about 42px at 375, since nothing can beat 375/7. That
// is a thumb rather than a word, which is the whole point of not using the
// browser's own control.

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

// Local, not UTC. `toISOString` on a British summer evening rolls back a day,
// which is how a host asking for the 3rd sends a tradesman to the 2nd.
function dayKey(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return date.getFullYear() + '-' + month + '-' + day;
}

function startOfToday(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export default function DatePicker({
    value,
    onChange,
}: {
    value: string;
    onChange: (value: string) => void;
}) {
    const today = startOfToday();

    const selected = value ? new Date(value + 'T12:00:00') : null;
    const [shown, setShown] = useState<Date>(
        selected && !isNaN(selected.getTime())
            ? new Date(selected.getFullYear(), selected.getMonth(), 1)
            : new Date(today.getFullYear(), today.getMonth(), 1)
    );

    // Monday-first, which is how a changeover week is read here.
    const firstWeekday = (new Date(shown.getFullYear(), shown.getMonth(), 1).getDay() + 6) % 7;
    const daysInMonth = new Date(shown.getFullYear(), shown.getMonth() + 1, 0).getDate();

    const cells: Array<Date | null> = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(shown.getFullYear(), shown.getMonth(), d));

    // A month entirely in the past cannot be reached. Unlike the booking
    // calendar there is no upper limit: a host may ask for whenever they like,
    // and nothing here claims the tradesman is free then.
    const canGoBack = shown.getFullYear() > today.getFullYear()
        || (shown.getFullYear() === today.getFullYear() && shown.getMonth() > today.getMonth());

    const move = (by: number) => setShown(new Date(shown.getFullYear(), shown.getMonth() + by, 1));

    return (
        <div className="rounded-xl border border-slate-300 overflow-hidden">
            <div className="flex items-center justify-between px-2 py-2 border-b border-slate-200 bg-slate-50">
                <button
                    type="button"
                    onClick={() => move(-1)}
                    disabled={!canGoBack}
                    aria-label="Previous month"
                    className="p-2 rounded-lg text-slate-600 hover:bg-slate-200 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                    <ChevronLeft className="w-5 h-5" />
                </button>

                <span className="text-sm font-semibold text-slate-900">
                    {MONTHS[shown.getMonth()]} {shown.getFullYear()}
                </span>

                <button
                    type="button"
                    onClick={() => move(1)}
                    aria-label="Next month"
                    className="p-2 rounded-lg text-slate-600 hover:bg-slate-200"
                >
                    <ChevronRight className="w-5 h-5" />
                </button>
            </div>

            <div className="p-1.5 sm:p-2">
                <div className="grid grid-cols-7 gap-1 mb-1">
                    {WEEKDAYS.map((d) => (
                        <div key={d} className="text-center text-[11px] font-semibold text-slate-500 py-1">
                            {d}
                        </div>
                    ))}
                </div>

                <div className="grid grid-cols-7 gap-1">
                    {cells.map((date, i) => {
                        if (!date) return <div key={'blank-' + i} />;

                        const key = dayKey(date);
                        const past = date.getTime() < today.getTime();
                        const isSelected = value === key;

                        return (
                            <button
                                key={key}
                                type="button"
                                disabled={past}
                                onClick={() => onChange(key)}
                                aria-pressed={isSelected}
                                className={
                                    // 44px tall, which is the thumb guideline.
                                    // The width is whatever seven columns
                                    // leave — about 42px at 375 — because no
                                    // layout beats 375/7 and the height is the
                                    // dimension a thumb actually misses on.
                                    'w-full min-h-[44px] rounded-lg text-sm transition '
                                    + (isSelected
                                        ? 'bg-emerald-700 text-white font-semibold'
                                        : past
                                            ? 'text-slate-300'
                                            : 'text-slate-800 hover:bg-emerald-50 hover:text-emerald-900')
                                }
                            >
                                {date.getDate()}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
