'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DateRangePicker, Range, RangeKeyDict } from 'react-date-range';
import { X } from 'lucide-react';
import { MONTH_ARROW_LABELS } from '@/lib/calendarLabels';
import { checkoutAvailable, checkInAvailable, nightsBetweenKeys, arrivalAllowed, departureAllowed, changeoverNote, weekdayListPlural, type StayRulesListing } from '@/lib/stayRules';
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
// day is decided by lib/stayRules (checkInAvailable / checkoutAvailable) through
// disabledDay, exactly as the booking widget decides it.
//
// Only GENUINELY unavailable nights are greyed/struck. The host's changeover
// days (check-in / check-out weekdays) do NOT grey a day — Airbnb's behaviour,
// and the booking widget's: those days look normal, and tapping one that breaks
// the rule shows a dismissable note ("Check-out is only available on Fridays")
// without selecting it, rather than the day sitting silently struck. The change
// route (app/api/bookings/change) is the real wall for changeover; it does NOT
// enforce a minimum stay on a change, so — unlike the booking widget — the
// picker shows no minimum-stay note here. The booking's own current check-in /
// checkout stay pickable whatever the host has restricted since, the same
// allowance the change route makes.
//
// Focus is controlled (focusedRange + a no-op onRangeFocusChange) so a refused
// checkout keeps the guest choosing a checkout instead of react-date-range
// moving on — the same technique the booking widget uses.

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
    // The host's changeover days. They apply to a date being MOVED to: the
    // booking's own check-in and checkout stay pickable whatever the host has
    // ticked since, the same allowance the change route makes.
    const [changeover, setChangeover] = useState<StayRulesListing>({});
    // Which end react-date-range is editing: [0,0] choosing the check-in, [0,1]
    // choosing the checkout. Controlled so a refused checkout stays on the
    // checkout step (see the header note). onRangeFocusChange is a no-op; focus
    // is driven entirely from handleSelect.
    const [focusedRange, setFocusedRange] = useState<[number, 0 | 1]>([0, 0]);
    // The loud note shown when a guest taps a day that breaks the host's
    // changeover rule — a dismissable bar at the foot of the picker.
    const [stayHint, setStayHint] = useState<{ kind: 'changeover-out' | 'changeover-in' } | null>(null);

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
                if (res.ok) {
                    const data = await res.json();
                    (data.blockedNights || []).forEach((k: string) => nights.add(k));
                    if (live) setChangeover({ checkin_days: data.checkinDays || null, checkout_days: data.checkoutDays || null });
                }
            } catch { /* fall through with what we have; the change route re-checks */ }
            // The guest already holds their own nights — never strike those out.
            ownNights.forEach((k) => nights.delete(k));
            if (live) setUnavailable(nights);
        })();
        return () => { live = false; };
    }, [listingId, ownNights]);

    // Which end the guest is choosing: driven by the controlled focus, not by
    // endDate === startDate, so a refused checkout keeps us choosing-checkout
    // instead of the library moving on (the same test the booking widget uses).
    // Only availability is enforced in the picker — the minimum stay is left to
    // the change route (which doesn't impose one on a change), and changeover
    // days are explained on tap rather than greyed.
    const startKey = checkIn || '';
    const choosingCheckout = focusedRange[1] === 1 && !!checkIn && !!checkOut;

    // Would moving the check-in TO this day break the host's changeover rule?
    // The booking's own current check-in is exempt — a stay made before the
    // host restricted a weekday keeps it, the same allowance the change route
    // makes. Availability is handled separately (disabled days can't be tapped).
    const checkinChangeoverProblem = (k: string): boolean =>
        k !== ownCheckIn.slice(0, 10) && !arrivalAllowed(changeover, k);
    const checkoutChangeoverProblem = (k: string): boolean =>
        k !== ownCheckOut.slice(0, 10) && !departureAllowed(changeover, k);

    const dayPickable = (k: string): boolean => {
        if (!unavailable) return true;
        if (choosingCheckout && startKey && nightsBetweenKeys(startKey, k) > 0) {
            return checkoutAvailable(startKey, k, unavailable);
        }
        return checkInAvailable(k, unavailable);
    };
    const changeoverLine = changeoverNote(changeover);

    // Struck-through numbers on nights the stay can't use — the same treatment
    // the booking widget uses, so grey is never the only signal. A taken night
    // that is a valid checkout for the check-in being chosen is not struck, and
    // a changeover day is never struck (it looks normal, explained on tap).
    const renderDay = (date: Date) => {
        const k = key(date);
        const struck = !!unavailable
            && unavailable.has(k)
            && !(choosingCheckout && startKey && checkoutAvailable(startKey, k, unavailable));
        if (!struck) return <span>{date.getDate()}</span>;
        return (
            <span className="line-through decoration-2 decoration-slate-400">
                {date.getDate()}
                <span className="sr-only"> unavailable</span>
            </span>
        );
    };

    // Start (or restart) on a check-in, honouring the changeover arrival day —
    // a non-arrival day isn't greyed, it shows a note and doesn't start.
    const startOnCheckIn = (k: string) => {
        if (checkinChangeoverProblem(k)) {
            setStayHint({ kind: 'changeover-in' });
            setFocusedRange([0, 0]);
            return;
        }
        setStayHint(null);
        onChange(k, k);
        setFocusedRange([0, 1]);
    };

    const stayHintText = !stayHint ? '' :
        stayHint.kind === 'changeover-out'
            ? `Check-out is only available on ${weekdayListPlural(changeover.checkout_days)}.`
            : `Check-in is only available on ${weekdayListPlural(changeover.checkin_days)}.`;
    const stayHintBar = stayHint ? (
        <div role="alert" className="flex items-start gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
            <span className="flex-1">{stayHintText}</span>
            <button type="button" onClick={() => setStayHint(null)} aria-label="Dismiss" className="-m-1 flex-none rounded p-1 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900">
                <X className="h-4 w-4" />
            </button>
        </div>
    ) : null;

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
    }, [unavailable, choosingCheckout, startKey, changeover]);

    const range: Range = {
        startDate: checkIn ? fromKey(checkIn) : undefined,
        endDate: checkOut ? fromKey(checkOut) : undefined,
        key: 'selection',
    };

    const noopFocus = () => {};

    const handleSelect = (ranges: RangeKeyDict) => {
        const sel = ranges.selection;
        if (!sel.startDate || !sel.endDate) return;
        const nextStart = key(sel.startDate);
        const nextEnd = key(sel.endDate);

        if (choosingCheckout && startKey) {
            // Tapped a day BEFORE the check-in → restart on it as a fresh
            // check-in, as the booking widget (and Airbnb) do, then keep
            // choosing the checkout.
            if (nextStart < startKey) {
                startOnCheckIn(nextStart);
                return;
            }
            if (nextEnd > startKey) {
                // A changeover day that isn't a valid checkout: don't select it,
                // keep the check-in, keep choosing the checkout, and say why.
                if (checkoutChangeoverProblem(nextEnd)) {
                    setStayHint({ kind: 'changeover-out' });
                    onChange(startKey, startKey);
                    setFocusedRange([0, 1]);
                    return;
                }
                setStayHint(null);
                onChange(nextStart, nextEnd);
                setFocusedRange([0, 0]);
                return;
            }
            // Re-tapped the check-in day itself — nothing to do.
            return;
        }

        // Choosing a check-in (fresh, or after a completed selection).
        startOnCheckIn(nextStart);
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
                focusedRange={focusedRange}
                onRangeFocusChange={noopFocus}
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
            {stayHintBar}
            {changeoverLine && (
                <p className="border-t px-4 py-2 text-xs text-slate-500">{changeoverLine}</p>
            )}
        </div>
    );
}
