'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DateRangePicker, Range, RangeKeyDict } from 'react-date-range';
import { MONTH_ARROW_LABELS } from '@/lib/calendarLabels';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';

// The SAME calendar guests book a stay with on the cottage page — react-date-range's
// DateRangePicker, the same props and the same emerald styling (see BookingWidget)
// — reused here for changing a reservation, rather than a hand-built lookalike.
//
// It keeps the change form's rules: the booking's OWN current nights stay
// available (they're the guest's already, even though they sit in the listing's
// busy nights); every other booking, blocked day and synced-calendar night is
// unavailable; past dates are disabled, except on a mid-stay change where the
// stay's own past check-in must still show; and every pick reports the new dates
// up so the price summary re-quotes.

function key(d: Date): string {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function fromKey(s: string): Date {
    const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
}
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

export default function ChangeDateRange({
    listingId, ownCheckIn, ownCheckOut, checkIn, checkOut, onChange,
}: {
    listingId: string;
    ownCheckIn: string;   // this booking's current nights are always selectable
    ownCheckOut: string;
    checkIn: string;
    checkOut: string;
    onChange: (checkIn: string, checkOut: string) => void;
}) {
    const calendarRef = useRef<HTMLDivElement>(null);
    // Null until the listing's calendar has loaded: the picker is not drawn
    // before then, because an empty list would show every night as free.
    const [disabledDates, setDisabledDates] = useState<Date[] | null>(null);

    // The booking's own nights, which stay pickable.
    const ownNights = useMemo(() => {
        const s = new Set<string>();
        let d = fromKey(ownCheckIn); const end = fromKey(ownCheckOut);
        while (d < end) { s.add(key(d)); d = addDays(d, 1); }
        return s;
    }, [ownCheckIn, ownCheckOut]);

    // A mid-stay change keeps a check-in that is already in the past, so the
    // calendar has to reach back to it; otherwise picking starts today.
    const today0 = useMemo(() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; }, []);
    const ownStart = useMemo(() => fromKey(ownCheckIn), [ownCheckIn]);
    const minDate = ownStart < today0 ? ownStart : today0;

    useEffect(() => {
        let live = true;
        (async () => {
            // One request, the same helper the listing page reads on the server
            // (lib/availability guestCalendar via /api/listings/calendar).
            const blocked = new Set<string>();
            try {
                const res = await fetch('/api/listings/calendar?listing=' + encodeURIComponent(listingId));
                if (res.ok) { const data = await res.json(); (data.blockedNights || []).forEach((k: string) => blocked.add(k)); }
            } catch { /* fall through with what we have; the change route re-checks */ }
            // The guest already holds their own nights — never strike those out.
            ownNights.forEach((k) => blocked.delete(k));
            if (live) setDisabledDates(Array.from(blocked).map(fromKey));
        })();
        return () => { live = false; };
    }, [listingId, ownNights]);

    const disabledKeys = useMemo(() => new Set((disabledDates || []).map(key)), [disabledDates]);

    // Struck-through numbers on unavailable nights — the same treatment the
    // booking widget uses, so grey is never the only signal.
    const renderDay = (date: Date) => {
        if (!disabledKeys.has(key(date))) return <span>{date.getDate()}</span>;
        return (
            <span className="line-through decoration-2 decoration-slate-400">
                {date.getDate()}
                <span className="sr-only"> unavailable</span>
            </span>
        );
    };

    // react-date-range leaves its disabled days unlabelled and its month heading
    // silent; mark them for screen readers, re-running whenever the month
    // changes. Same observer the booking widget runs.
    useEffect(() => {
        const root = calendarRef.current;
        if (!root) return;
        const label = () => {
            const heading = root.querySelector('.rdrMonthAndYearPickers');
            if (heading && !heading.hasAttribute('aria-live')) heading.setAttribute('aria-live', 'polite');
            root.querySelectorAll('.rdrDay').forEach((day) => {
                if (day.classList.contains('rdrDayDisabled')) day.setAttribute('aria-disabled', 'true');
                else day.removeAttribute('aria-disabled');
            });
        };
        label();
        const observer = new MutationObserver(label);
        observer.observe(root, { childList: true, subtree: true });
        return () => observer.disconnect();
    }, [disabledDates]);

    const range: Range = {
        startDate: checkIn ? fromKey(checkIn) : undefined,
        endDate: checkOut ? fromKey(checkOut) : undefined,
        key: 'selection',
    };

    const handleSelect = (ranges: RangeKeyDict) => {
        const sel = ranges.selection;
        if (!sel.startDate || !sel.endDate) return;
        onChange(key(sel.startDate), key(sel.endDate));
    };

    if (disabledDates === null) {
        return (
            <div className="change-cal border rounded-xl h-[340px] flex items-center justify-center text-sm text-slate-500" aria-busy="true">
                Loading availability…
            </div>
        );
    }

    return (
        // rdr-move makes the month grid fill the card (the base .rdrMonth is a fixed
        // 23em) with day cells spread evenly — scoped so the cottage booking widget's
        // calendar is untouched.
        <div ref={calendarRef} className="rdr-move change-cal border rounded-xl overflow-hidden">
            <DateRangePicker
                ariaLabels={MONTH_ARROW_LABELS}
                ranges={[range]}
                onChange={handleSelect}
                minDate={minDate}
                disabledDates={disabledDates}
                months={1}
                weekStartsOn={1}
                direction="vertical"
                rangeColors={['#047857']}
                showMonthAndYearPickers={false}
                showDateDisplay={false}
                staticRanges={[]}
                inputRanges={[]}
                dayContentRenderer={renderDay}
            />
        </div>
    );
}
