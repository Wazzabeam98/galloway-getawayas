'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { formatGBP } from '@/lib/formatMoney';
import { DateRangePicker, Range, RangeKeyDict } from 'react-date-range';
import { MONTH_ARROW_LABELS } from '@/lib/calendarLabels';
import { addMonths } from 'date-fns';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';
import LoginModel from '@/components/auth/LoginModel';
import { dateToKey, keyToDate, readBookingDraft, writeBookingDraft } from '@/lib/bookingDraftParams';
import { toast } from 'react-toastify';
import { Minus, Plus } from 'lucide-react';
import { notify } from '@/lib/notify';
import { freeCancelUntil, formatUk, cancellationSummary } from '@/lib/cancellation';
import { quoteBooking, dateKey, dateFromKey } from '@/lib/pricing';
import { plural } from '@/lib/plural';
import { agreementProblem, versionForTick } from '@/lib/agreements';
import AgreementTick, { fetchAgreementStatus, recordAgreement } from '@/components/legal/AgreementTick';
import { NOT_TAKING_BOOKINGS } from '@/lib/listingBookable';

interface Props {
    listingId: string;
    hostId: string;
    pricePerNight: number;
    maxGuests: number;
    petsAllowed?: boolean;
    icalImportUrl?: string | null;
    weekendPrice?: number | null;
    cleaningFee?: number;
    petFee?: number;
    extraGuestFee?: number;
    extraGuestAfter?: number;
    extraGuestPeriod?: string;
    damageDeposit?: number;
    availabilityWindow?: string;
    instantBook?: boolean;
    instantBookRequiresPhone?: boolean;
    instantBookRequiresVerifiedId?: boolean;
    cancellationPolicy?: string | null;
    // Read on the server by the listing page (lib/availability guestCalendar),
    // so the calendar paints with the taken nights already struck out. It used
    // to fetch them after mount, and a month showed wide open until they came.
    blockedNights: string[];
    priceOverrides: Record<string, number>;
    // From the server too: whether the signed-in viewer still owes the Guest
    // Terms. Null when the page did not know (signed out at render).
    needsGuestTerms: boolean | null;
}

// Defined out here on purpose. A component declared inside another one is a
// brand new type on every render, so React throws the old counters away and
// builds fresh ones each time anything changes — which is why the guest and
// pet counts used to stop feeding into the price once dates were picked.
function Counter({
    label,
    sub,
    value,
    onChange,
    min = 0,
}: {
    label: string;
    sub?: string;
    value: number;
    onChange: (v: number) => void;
    min?: number;
}) {
    return (
        <div className="flex items-center justify-between py-2.5">
            <div>
                <div className="text-sm font-medium text-slate-800">{label}</div>
                {sub && <div className="text-xs text-slate-400">{sub}</div>}
            </div>
            <div className="flex items-center space-x-3">
                <button
                    type="button"
                    onClick={() => onChange(Math.max(min, value - 1))}
                    disabled={value <= min}
                    // Icon-only, so named here — it was read out as "button".
                    aria-label={`Fewer ${label.toLowerCase()}`}
                    className="w-11 h-11 rounded-full border flex items-center justify-center text-slate-600 hover:border-slate-900 disabled:opacity-30"
                >
                    <Minus className="w-4 h-4" />
                </button>
                {/* Announced as it changes, so the new count is heard after a tap. */}
                <span className="w-6 text-center text-sm" aria-live="polite">
                    <span aria-hidden="true">{value}</span>
                    <span className="sr-only">{value} {label.toLowerCase()}</span>
                </span>
                <button
                    type="button"
                    onClick={() => onChange(value + 1)}
                    aria-label={`More ${label.toLowerCase()}`}
                    className="w-11 h-11 rounded-full border flex items-center justify-center text-slate-600 hover:border-slate-900"
                >
                    <Plus className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}

export default function BookingWidget({
    listingId, hostId, pricePerNight, maxGuests, petsAllowed, icalImportUrl,
    weekendPrice, cleaningFee = 0, petFee = 0, extraGuestFee = 0,
    extraGuestAfter = 1, extraGuestPeriod = 'night', availabilityWindow,
    instantBook = false, instantBookRequiresPhone = false, instantBookRequiresVerifiedId = false,
    damageDeposit = 0,
    cancellationPolicy,
    blockedNights,
    priceOverrides,
    needsGuestTerms: serverNeedsGuestTerms,
}: Props) {
    const [payPlan, setPayPlan] = useState<'deposit' | 'full'>('deposit');
    const supabase = createClientComponentClient();
    const [session, setSession] = useState<any>(null);
    const [loadingSession, setLoadingSession] = useState(true);
    // Fixed for the life of the page: every night taken here, blocked by the
    // host, or taken on another platform, as the server read it before paint.
    const [disabledDates] = useState<Date[]>(() => blockedNights.map(dateFromKey));
    const calendarRef = useRef<HTMLDivElement>(null);

    // Which nights are already taken, as 'yyyy-mm-dd', so the day renderer can
    // answer without comparing Date objects on every cell.
    const disabledKeys = new Set(
        disabledDates.map(
            (d) =>
                d.getFullYear()
                + '-' + String(d.getMonth() + 1).padStart(2, '0')
                + '-' + String(d.getDate()).padStart(2, '0')
        )
    );

    // A date a guest cannot have was signalled by nothing but grey. Grey is
    // also what this calendar uses for the days either side of the month, and
    // for anything before today — so with reduced colour vision there was no
    // way to tell a taken night from a free one. The line through the number
    // is the signal that does not depend on seeing a colour, and the hidden
    // word is what a screen reader reads out.
    const renderDay = (date: Date) => {
        const key =
            date.getFullYear()
            + '-' + String(date.getMonth() + 1).padStart(2, '0')
            + '-' + String(date.getDate()).padStart(2, '0');

        if (!disabledKeys.has(key)) return <span>{date.getDate()}</span>;

        return (
            <span className="line-through decoration-2 decoration-slate-400">
                {date.getDate()}
                <span className="sr-only"> unavailable</span>
            </span>
        );
    };

    // react-date-range marks a disabled day with a class only: the `disabled`
    // property is false and there is no aria-disabled, so a screen reader
    // reads it as an ordinary button. The month heading ("October 2026") is
    // plain text, so it is made a polite live region to announce the new
    // month when the guest uses the arrows.
    //
    // The observer is not decoration. The day nodes are replaced whenever
    // the guest changes month, and a one-off pass after mount would label the
    // first month and nothing after it.
    useEffect(() => {
        const root = calendarRef.current;
        if (!root) return;

        const label = () => {
            const heading = root.querySelector('.rdrMonthAndYearPickers');
            if (heading && !heading.hasAttribute('aria-live')) heading.setAttribute('aria-live', 'polite');

            root.querySelectorAll('.rdrDay').forEach((day) => {
                const off = day.classList.contains('rdrDayDisabled');
                if (off) {
                    day.setAttribute('aria-disabled', 'true');
                } else {
                    day.removeAttribute('aria-disabled');
                }
            });
        };

        label();

        const observer = new MutationObserver(label);
        observer.observe(root, { childList: true, subtree: true });
        return () => observer.disconnect();
    }, [disabledDates]);

    const [adults, setAdults] = useState(1);
    const [children, setChildren] = useState(0);
    const [pets, setPets] = useState(0);
    const [dateRange, setDateRange] = useState<Range>({
        startDate: undefined,
        endDate: undefined,
        key: 'selection',
    });
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [requested, setRequested] = useState(false);

    // Dates and guests live in the listing's URL as well as here, so signing in
    // part-way through — which reloads the page, or goes to Google, or to an
    // email and back — returns to the same choices. Read once on arrival, then
    // written back on every change. See lib/bookingDraftParams.
    const [draftReady, setDraftReady] = useState(false);
    useEffect(() => {
        const d = readBookingDraft(new URLSearchParams(window.location.search), maxGuests);
        if (d.checkIn) {
            setDateRange({ startDate: keyToDate(d.checkIn), endDate: keyToDate(d.checkOut) || keyToDate(d.checkIn), key: 'selection' });
        }
        setAdults(d.adults);
        setChildren(d.children);
        setPets(petsAllowed ? d.pets : 0);
        setDraftReady(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => {
        if (!draftReady) return;
        const start = dateToKey(dateRange.startDate);
        const end = dateToKey(dateRange.endDate);
        const params = writeBookingDraft(new URLSearchParams(window.location.search), {
            checkIn: start,
            checkOut: end && start && end > start ? end : null,
            adults,
            children,
            pets,
        });
        const query = params.toString();
        const url = window.location.pathname + (query ? '?' + query : '') + window.location.hash;
        if (url !== window.location.pathname + window.location.search + window.location.hash) {
            window.history.replaceState(window.history.state, '', url);
        }
    }, [draftReady, dateRange.startDate, dateRange.endDate, adults, children, pets]);
    // The Guest Terms are accepted at a guest's FIRST stay checkout, not forced
    // on them the moment they make an account. `needsGuestTerms` comes from the
    // page (read on the server); if the page did not know, it starts TRUE —
    // fail closed — until /api/agreements says otherwise. The tick shows above the
    // pay button until they accept, and the acceptance is recorded (version +
    // server time) before the booking is created.
    const [needsGuestTerms, setNeedsGuestTerms] = useState(serverNeedsGuestTerms !== false);
    const [guestTicked, setGuestTicked] = useState(false);
    const [guestTermsError, setGuestTermsError] = useState('');

    const maxBookableDate = (() => {
        const map: Record<string, number> = { '3 months': 3, '6 months': 6, '9 months': 9, '12 months': 12 };
        const months = availabilityWindow ? map[availabilityWindow] : undefined;
        return months ? addMonths(new Date(), months) : undefined;
    })();

    useEffect(() => {
        const load = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setSession(session);
            setLoadingSession(false);

            // Does this guest still owe the Guest Terms? The page usually knows
            // already (serverNeedsGuestTerms); only ask when it did not.
            if (session?.user && serverNeedsGuestTerms === null) {
                const st = await fetchAgreementStatus();
                // Fail CLOSED: only clear the tick when we have POSITIVELY
                // confirmed this guest has agreed. If the lookup errors or the
                // table is unreachable, fetchAgreementStatus returns null — and
                // we must keep the tick (and the disabled pay button) rather than
                // let someone pay with no agreement recorded. The checkout route
                // walls on it too (requireGuestTerms); this keeps the button honest.
                setNeedsGuestTerms(!(st && st.documents && st.documents.guest && st.documents.guest.agreed));
            }

        };
        load();
    }, [supabase, serverNeedsGuestTerms]);

    // Priced by the shared module, which is the same code the server runs
    // before taking any money — so what the guest is shown here and what
    // they are charged cannot come apart.
    const quote = quoteBooking(
        {
            price_per_night: pricePerNight,
            weekend_price: weekendPrice,
            cleaning_fee: cleaningFee,
            pet_fee: petFee,
            extra_guest_fee: extraGuestFee,
            extra_guest_after: extraGuestAfter,
            extra_guest_period: extraGuestPeriod,
        },
        priceOverrides,
        dateRange.startDate || new Date(),
        dateRange.endDate || (dateRange.startDate || new Date()),
        adults,
        children,
        pets
    );

    const totalGuests = adults + children;
    const nights = quote.nights;
    const nightsSubtotal = quote.nightsSubtotal;
    const extraGuestTotal = quote.extraGuestTotal;
    const petFeeTotal = quote.petFeeTotal;
    const cleaningFeeTotal = quote.cleaningFeeTotal;
    const total = quote.total;

    const handleSelect = (ranges: RangeKeyDict) => {
        setError('');
        setDateRange(ranges.selection);
    };

    // Back to "no dates yet": both ends undefined, which is how the quote, the
    // submit guard and .rdr-unselected all read an empty choice, and which the
    // draft effect above writes back to the URL as no checkIn/checkOut.
    const [calendarKey, setCalendarKey] = useState(0);

    // The month the guest is looking at, kept so Clear dates leaves them on it.
    // The remount below opens on `shownDate`; without it react-date-range
    // opens on the selection's month, and with no selection that is the
    // current month — November, pick dates, Clear dates landed on October.
    // A ref, not state: it only needs reading at that remount.
    const shownMonth = useRef<Date | undefined>(undefined);

    // One array per selection, not one per render. react-date-range re-aims
    // its month whenever `ranges` is a new array, and with no dates picked it
    // aims at the current month — so browsing to November and then pressing
    // Adults + (or anything else that redraws this box) threw the calendar
    // back to October.
    const calendarRanges = useMemo(() => [dateRange], [dateRange]);

    const clearDates = () => {
        setError('');
        setDateRange({ startDate: undefined, endDate: undefined, key: 'selection' });
        setCalendarKey((k) => k + 1);
    };

    const handleRequest = async () => {
        setError('');

        if (!session?.user) {
            setError('Please log in to request a booking.');
            return;
        }
        if (!dateRange.startDate || !dateRange.endDate || nights <= 0) {
            setError('Please select your check-in and check-out dates.');
            return;
        }
        if (maxBookableDate && dateRange.endDate > maxBookableDate) {
            setError('This host only accepts bookings within their availability window. Please pick earlier dates.');
            return;
        }
        if (totalGuests > maxGuests) {
            setError(`This place sleeps up to ${maxGuests} guests.`);
            return;
        }

        const overlap = disabledDates.some(
            (d) => dateRange.startDate! <= d && d < dateRange.endDate!
        );
        if (overlap) {
            setError('Some of those dates were just booked by someone else. Please pick different dates.');
            return;
        }

        // The Guest Terms, if this is their first booking. The same rule
        // /api/agreements applies to the record below.
        if (needsGuestTerms) {
            const problem = agreementProblem('guest', null, versionForTick('guest', guestTicked));
            if (problem) { setGuestTermsError(problem); return; }
        }

        setSubmitting(true);
        try {
            // Record the Guest Terms acceptance before anything is booked, so a
            // guest who reaches payment has agreed to them.
            if (needsGuestTerms) {
                const failed = await recordAgreement('guest', 'stay_checkout');
                if (failed) { setGuestTermsError(failed); return; }
                setNeedsGuestTerms(false);
            }
            // Instant Book can carry requirements the guest has to meet.
            //
            // Verified ID is deliberately NOT checked here. Nothing in the site
            // ever marks a guest as verified — profiles.identity_verified is set
            // only for hosts, by Stripe Connect — so honouring the flag would
            // turn away every guest with no way for them to fix it. The column
            // stays for when identity checks are actually connected.
            if (instantBook && instantBookRequiresPhone) {
                const { data: myProfile } = await supabase
                    .from('profile_private')
                    .select('phone')
                    .eq('id', session.user.id)
                    .single();

                if (instantBookRequiresPhone && (!myProfile?.phone || !myProfile.phone.trim())) {
                    const msg = 'This host asks for a phone number before booking instantly. Add one under Account settings, then try again.';
                    setError(msg);
                    toast.error(msg, { theme: 'colored' });
                    return;
                }
            }

            const { data: created, error: insertErr } = await supabase.from('bookings').insert({
                listing_id: listingId,
                guest_id: session.user.id,
                host_id: hostId,
                check_in: dateKey(dateRange.startDate),
                check_out: dateKey(dateRange.endDate),
                guests: totalGuests,
                adults,
                children,
                pets,
                total_price: total,
                // Nothing is confirmed until the payment lands. The webhook
                // moves this on once Stripe says the money arrived.
                status: 'pending_payment',
                confirmed_at: null,
            }).select('id').single();

            if (insertErr) {
                // 42501 is the INSERT policy refusing the row — in practice the
                // listing came down while this tab was open. Say so in the page's
                // own words rather than Postgres's.
                const msg = insertErr.code === '42501' ? NOT_TAKING_BOOKINGS + '.' : insertErr.message;
                toast.error(msg, { theme: 'colored' });
                setError(msg);
                return;
            }

            // Hand over to Stripe's payment page. The host is told by
            // email from the webhook, once the money has actually arrived.
            const res = await fetch('/api/stripe/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // The tick goes with it: the checkout route walls on the Guest
                // Terms itself rather than trusting the record made above.
                body: JSON.stringify({
                    bookingId: created.id,
                    plan: payPlan,
                    guestTermsVersion: versionForTick('guest', guestTicked),
                }),
            });
            const data = await res.json();

            if (data && data.ok && data.url) {
                window.location.href = data.url;
                return;
            }

            const msg = (data && data.error) || 'Could not open the payment page. Please try again.';
            toast.error(msg, { theme: 'colored' });
            setError(msg);
        } catch (err: any) {
            const msg = err?.message || 'Something went wrong sending your request.';
            toast.error(msg, { theme: 'colored' });
            setError(msg);
        } finally {
            setSubmitting(false);
        }
    };

    // Payment split, shown to the guest before they commit.
    const balanceDate = dateRange.startDate ? new Date(dateRange.startDate) : new Date();
    balanceDate.setDate(balanceDate.getDate() - 30);
    const depositAvailable = nights > 0 && balanceDate.getTime() > Date.now();
    // The 25%/75% split is a property of the stay, not of which option is
    // currently highlighted, so it is worked out once and never changes as
    // the guest clicks between the two cards.
    const depositNow = Math.round(total * 0.25 * 100) / 100;
    const depositLater = Math.round((total - depositNow) * 100) / 100;
    const dueNow = depositAvailable && payPlan === 'deposit' ? depositNow : total;
    const cancelInfo = nights > 0
        ? cancellationSummary(dateRange.startDate, cancellationPolicy)
        : null;

    if (requested) {
        return (
            <div className="border rounded-2xl p-6 bg-slate-50 text-center">
                <h3 className="font-bold text-lg text-slate-900 mb-1">
                    {instantBook ? "You're booked" : 'Request sent'}
                </h3>
                <p className="text-slate-600 text-sm">
                    {instantBook
                        ? "Your dates are confirmed. The host will be in touch with the details, and you can see your booking under Your trips."
                        : "The host will review your dates and confirm or decline. You'll be able to see the status from your account."}
                </p>
            </div>
        );
    }

    return (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 lg:p-5 lg:sticky lg:top-24 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
            <div className="mb-4">
                <span className="text-2xl font-bold text-slate-900">£{pricePerNight}</span>
                <span className="text-slate-500"> / night</span>
                {weekendPrice && <span className="text-xs text-slate-400 block mt-0.5">£{weekendPrice} on Fri &amp; Sat nights</span>}
            </div>

            <div ref={calendarRef} className={`cottage-cal border rounded-xl overflow-hidden mb-4${dateRange.startDate ? '' : ' rdr-unselected'}`}>
                <DateRangePicker
                    ariaLabels={MONTH_ARROW_LABELS}
                    // Remounted by Clear dates: the picker keeps its own note of
                    // which end it is choosing next, so after a check-in pick it
                    // would treat the guest's next tap as a check-out against an
                    // empty start. A fresh mount starts back at check-in, on
                    // the month the guest had navigated to (shownDate).
                    key={calendarKey}
                    ranges={calendarRanges}
                    shownDate={shownMonth.current}
                    onShownDateChange={(d: Date) => { shownMonth.current = d; }}
                    onChange={handleSelect}
                    minDate={new Date()}
                    maxDate={maxBookableDate}
                    disabledDates={disabledDates}
                    months={1}
                    // Monday-first, like every calendar on the site (and the UK).
                    weekStartsOn={1}
                    direction="vertical"
                    rangeColors={['#047857']}
                    // "October 2026" as one heading between the arrows, as
                    // Airbnb has it, not a month dropdown beside a year one.
                    showMonthAndYearPickers={false}
                    showDateDisplay={false}
                    // The preset sidebar this library ships with offers
                    // "Today", "Yesterday" and "Last Week", which mean nothing
                    // when picking a stay. globals.css already hides it; these
                    // stop it being built at all, so its two unlabelled inputs
                    // are not in the page either.
                    staticRanges={[]}
                    inputRanges={[]}
                    dayContentRenderer={renderDay}
                />
                {/* Bottom right, as on Airbnb's calendar. */}
                <div className="flex justify-end px-3 pb-3">
                    <button
                        type="button"
                        onClick={clearDates}
                        disabled={!dateRange.startDate}
                        className="text-sm font-medium text-[#222222] underline underline-offset-2 rounded px-1 py-0.5 hover:bg-slate-100 disabled:text-slate-300 disabled:no-underline disabled:hover:bg-transparent disabled:cursor-default"
                    >
                        Clear dates
                    </button>
                </div>
            </div>

            <div className="mb-4 border rounded-xl px-3 divide-y">
                <Counter label="Adults" sub="Ages 13+" value={adults} onChange={setAdults} min={1} />
                <Counter label="Children" sub="Ages 2–12" value={children} onChange={setChildren} min={0} />
                {petsAllowed && (
                    <Counter label="Pets" sub="This place allows pets" value={pets} onChange={setPets} min={0} />
                )}
            </div>
            <p className="text-xs text-slate-400 -mt-3 mb-4">Max {plural(maxGuests, 'guest')}{petsAllowed ? ' (pets don\'t count toward this)' : ''}</p>

            {nights > 0 && (
                <div className="border-t pt-3 mb-4 text-sm space-y-1.5">
                    <div className="flex justify-between text-slate-600">
                        <span>{nights} night{nights > 1 ? 's' : ''}</span>
                        <span>{formatGBP(nightsSubtotal)}</span>
                    </div>
                    {cleaningFeeTotal > 0 && (
                        <div className="flex justify-between text-slate-600">
                            <span>Cleaning fee</span>
                            <span>{formatGBP(cleaningFeeTotal)}</span>
                        </div>
                    )}
                    {petFeeTotal > 0 && (
                        <div className="flex justify-between text-slate-600">
                            <span>Pet fee</span>
                            <span>{formatGBP(petFeeTotal)}</span>
                        </div>
                    )}
                    {extraGuestTotal > 0 && (
                        <div className="flex justify-between text-slate-600">
                            <span>
                                {(() => {
                                    // Spelled out, so a guest can see where the
                                    // number came from rather than wondering.
                                    const extra = Math.max(0, totalGuests - Math.max(1, extraGuestAfter));
                                    return (
                                        extra +
                                        (extra === 1 ? ' extra guest' : ' extra guests') +
                                        ' × ' +
                                        formatGBP(extraGuestFee) +
                                        (extraGuestPeriod === 'stay' ? '' : ' × ' + nights + (nights === 1 ? ' night' : ' nights'))
                                    );
                                })()}
                            </span>
                            <span>{formatGBP(extraGuestTotal)}</span>
                        </div>
                    )}
                    <div className="flex justify-between font-bold text-slate-900 mt-2 pt-2 border-t">
                        <span>Total</span>
                        <span>{formatGBP(total)}</span>
                    </div>
                </div>
            )}

            {nights > 0 && depositAvailable && (
                <div className="mb-4 space-y-2">
                    <button
                        type="button"
                        onClick={() => setPayPlan('deposit')}
                        className={`w-full text-left border rounded-xl p-3 transition ${payPlan === 'deposit' ? 'border-emerald-700 bg-emerald-50/60 ring-1 ring-emerald-700' : 'border-slate-200 hover:border-slate-300'}`}
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-slate-900">Book now, pay the rest later</span>
                            <span className="text-sm font-bold text-slate-900">{formatGBP(depositNow)}</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                            {formatGBP(depositNow)} now &middot; {formatGBP(depositLater)} on {formatUk(balanceDate)}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">No fees, no interest.</p>
                    </button>

                    <button
                        type="button"
                        onClick={() => setPayPlan('full')}
                        className={`w-full text-left border rounded-xl p-3 transition ${payPlan === 'full' ? 'border-emerald-700 bg-emerald-50/60 ring-1 ring-emerald-700' : 'border-slate-200 hover:border-slate-300'}`}
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-slate-900">Pay in full today</span>
                            <span className="text-sm font-bold text-slate-900">{formatGBP(total)}</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">Settled in one go, nothing more to pay.</p>
                    </button>
                </div>
            )}

            {cancelInfo && (
                <div
                    className={`text-xs rounded-lg px-3 py-2 mb-4 border ${
                        cancelInfo.kind === 'free'
                            ? 'text-emerald-800 bg-emerald-50 border-emerald-100'
                            : cancelInfo.kind === 'partial'
                                ? 'text-amber-800 bg-amber-50 border-amber-100'
                                : 'text-slate-600 bg-slate-50 border-slate-200'
                    }`}
                >
                    <span className="font-semibold">{cancelInfo.headline}</span>
                    <span className="block mt-0.5 opacity-90">{cancelInfo.detail}</span>
                </div>
            )}

            {Number(damageDeposit) > 0 && nights > 0 && (
                <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
                    <span className="font-semibold text-slate-800">
                        {formatGBP(damageDeposit)} damage deposit
                    </span>
                    <span className="block mt-0.5">
                        Collected by your host at the property and returned after your stay. It
                        isn&apos;t part of the total above and we don&apos;t take it.
                    </span>
                </div>
            )}

            {error && <p className="text-red-600 text-xs mb-3">{error}</p>}

            {loadingSession ? (
                <div className="text-center text-sm text-slate-400 py-2">Loading...</div>
            ) : !session ? (
                <div>
                    <p className="text-sm text-slate-500 mb-2 text-center">Log in or sign up to request this booking</p>
                    <LoginModel variant="button" label="Continue" />
                </div>
            ) : (
                <>
                {needsGuestTerms && (
                    <div className="mb-3">
                        <AgreementTick
                            doc="guest"
                            id="booking-agree-guest"
                            checked={guestTicked}
                            onChange={(v) => { setGuestTicked(v); setGuestTermsError(''); }}
                            error={guestTermsError}
                            open="tab"
                        />
                    </div>
                )}
                <button
                    type="button"
                    onClick={handleRequest}
                    disabled={submitting || nights <= 0 || (needsGuestTerms && !guestTicked)}
                    className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl transition disabled:opacity-50"
                >
                    {submitting
                        ? 'Taking you to payment...'
                        : nights > 0
                            ? 'Secure your dates for ' + formatGBP(dueNow)
                            : (instantBook ? 'Reserve' : 'Request to book')}
                </button>
                </>
            )}
            <p className="text-xs text-slate-400 text-center mt-3">
                {instantBook
                    ? 'Payment is taken securely by Stripe. Your dates are confirmed straight away.'
                    : 'Payment is taken securely by Stripe. If the host declines, you get it all back.'}
            </p>
            <p className="text-xs text-slate-400 text-center mt-1">
                The stay is provided by the host. Galloway Getaways is acting as the host&apos;s agent and
                takes payment on their behalf.
            </p>
        </div>
    );
}
