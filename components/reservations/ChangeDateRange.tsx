'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DateRangePicker, Range, RangeKeyDict } from 'react-date-range';
import { MONTH_ARROW_LABELS } from '@/lib/calendarLabels';
import { checkInPickable, checkoutPickable, nightsBetweenKeys } from '@/lib/stayRules';
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
//
// A stay occupies its NIGHTS, not its checkout day — the same '[)' rule the
// booking widget, checkout and the database's no-overlap constraint use. So a
// taken night is not simply handed to the picker as a disabled day: a day whose
// night is taken can still be a CHECKOUT (the morning another stay checks in),
// as on Airbnb, as long as none of the nights being stayed is unavailable. Each
// day is decided by lib/stayRules (checkInPickable / checkoutPickable) through
// disabledDay, exactly as the booking widget decides it.

function key(d: Date): string {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function fromKey(s: string): Date {
    const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
}
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

// The picker gets no disabled dates of its own — taken nights can still be
// checkouts, so each day is decided by disabledDay. One stable empty array.
const NO_DATES: Date[] = [];

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
    // before then, because an empty set would show every night as free. A set
    // of NIGHT keys (not days), the same shape the booking widget reasons about.
    const [unavailable, setUnavailable] = useState<Set<string> | null>(null);

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
            const nights = new Set<string>();
            try {
                const res = await fetch('/api/listings/calendar?listing=' + encodeURIComponent(listingId));
                if (res.ok) { const data = await res.json(); (data.blockedNights || []).forEach((k: string) => nights.add(k)); }
            } catch { /* fall through with what we have; the change route re-checks */ }
            // The guest already holds their own nights — never strike those out.
            ownNights.forEach((k) => nights.delete(k));
            if (live) setUnavailable(nights);
        })();
        return () => { live = false; };
    }, [listingId, ownNights]);

    // Which end the guest is choosing: a check-in exists and the range is still
    // one day, so the next tap sets the checkout — the same test the booking
    // widget uses. The minimum/maximum nights are left to the change route; the
    // picker only enforces that every night of the stay is free.
    const startKey = checkIn || '';
    const choosingCheckout = !!(checkIn && checkOut === checkIn);

    const dayPickable = (k: string): boolean => {
        if (!unavailable) return true;
        if (choosingCheckout && startKey && nightsBetweenKeys(startKey, k) > 0) {
            return checkoutPickable(startKey, k, unavailable, 1, null);
        }
        return checkInPickable(k, unavailable);
    };

    // Struck-through numbers on nights the stay can't use — the same treatment
    // the booking widget uses, so grey is never the only signal. A taken night
    // that is a valid checkout for the check-in being chosen is not struck.
    const renderDay = (date: Date) => {
        const k = key(date);
        const struck = !!unavailable
            && unavailable.has(k)
            && !(choosingCheckout && startKey && checkoutPickable(startKey, k, unavailable, 1, null));
        if (!struck) return <span>{date.getDate()}</span>;
        return (
            <span className="line-through decoration-2 decoration-slate-400">
                {date.getDate()}
                <span className="sr-only"> unavailable</span>
            </span>
        );
    };

    // react-date-range leaves its disabled days unlabelled and its month heading
    // silent; mark them for screen readers, re-running whenever the month
    // changes or a day flips pickable. Same observer the booking widget runs.
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
        // Class changes too: a day flips between pickable and not as the guest
        // picks a check-in (checkout days are decided per check-in).
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, [unavailable, choosingCheckout, startKey]);

    const range: Range = {
        startDate: checkIn ? fromKey(checkIn) : undefined,
        endDate: checkOut ? fromKey(checkOut) : undefined,
        key: 'selection',
    };

    const handleSelect = (ranges: RangeKeyDict) => {
        const sel = ranges.selection;
        if (!sel.startDate || !sel.endDate) return;
        const nextStart = key(sel.startDate);
        const nextEnd = key(sel.endDate);
        // Choosing a checkout, the guest tapped a day BEFORE the check-in: the
        // picker would make that day..check-in a stay across nights nobody
        // checked. Treat it as a fresh check-in instead, as the booking widget
        // (and Airbnb) do.
        if (choosingCheckout && startKey && nextStart < startKey && nextEnd === startKey) {
            onChange(nextStart, nextStart);
            return;
        }
        onChange(nextStart, nextEnd);
    };

    if (unavailable === null) {
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
                disabledDates={NO_DATES}
                disabledDay={(date: Date) => !dayPickable(key(date))}
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
