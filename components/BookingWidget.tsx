'use client';

import { useEffect, useRef, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { DateRangePicker, Range, RangeKeyDict } from 'react-date-range';
import { addDays, addMonths } from 'date-fns';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';
import LoginModel from '@/components/auth/LoginModel';
import { toast } from 'react-toastify';
import { Minus, Plus } from 'lucide-react';
import { notify } from '@/lib/notify';
import { freeCancelUntil, formatUk, cancellationSummary } from '@/lib/cancellation';
import { quoteBooking } from '@/lib/pricing';

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
                    className="w-7 h-7 rounded-full border flex items-center justify-center text-slate-600 hover:border-slate-900 disabled:opacity-30"
                >
                    <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="w-4 text-center text-sm">{value}</span>
                <button
                    type="button"
                    onClick={() => onChange(value + 1)}
                    className="w-7 h-7 rounded-full border flex items-center justify-center text-slate-600 hover:border-slate-900"
                >
                    <Plus className="w-3.5 h-3.5" />
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
}: Props) {
    const [payPlan, setPayPlan] = useState<'deposit' | 'full'>('deposit');
    const supabase = createClientComponentClient();
    const [session, setSession] = useState<any>(null);
    const [loadingSession, setLoadingSession] = useState(true);
    const [disabledDates, setDisabledDates] = useState<Date[]>([]);
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

    // react-date-range renders the month and year dropdowns itself and gives
    // no way to label them, so they arrive as two selects a screen reader
    // announces as nothing at all. Same for the day buttons it marks disabled:
    // the class is there but the `disabled` property is false and there is no
    // aria-disabled, so they read as ordinary buttons.
    //
    // The observer is not decoration. Both sets of nodes are replaced whenever
    // the guest changes month, and a one-off pass after mount would label the
    // first month and nothing after it.
    useEffect(() => {
        const root = calendarRef.current;
        if (!root) return;

        const label = () => {
            const month = root.querySelector('.rdrMonthPicker select');
            if (month) month.setAttribute('aria-label', 'Month');

            const year = root.querySelector('.rdrYearPicker select');
            if (year) year.setAttribute('aria-label', 'Year');

            root.querySelectorAll('.rdrDay').forEach((day) => {
                const off = day.classList.contains('rdrDayDisabled');
                if (off) {
                    day.setAttribute('aria-disabled', 'true');
                } else {
                    day.removeAttribute('aria-disabled');
                }
            });

            // The month list always offers all twelve, whatever the window
            // allows, and picking one outside it does nothing visible: the
            // library clamps the shown date back to the edge and the guest is
            // returned to the month they started on with no explanation.
            //
            // Observed on the live site: on a listing taking bookings to
            // 28 August 2027, choosing October 2027 silently went back to
            // August. Success and refusal looked identical, which is the shape
            // this project keeps meeting.
            //
            // A month is offered only if any part of it is actually bookable.
            // Both ends matter — the months earlier in this year are past and
            // snap back exactly the same way.
            if (month instanceof HTMLSelectElement && year instanceof HTMLSelectElement) {
                const shownYear = Number(year.value);
                const lower = new Date();
                lower.setHours(0, 0, 0, 0);

                Array.prototype.forEach.call(month.options, (option: HTMLOptionElement, index: number) => {
                    const firstOfMonth = new Date(shownYear, index, 1);
                    const lastOfMonth = new Date(shownYear, index + 1, 0);
                    const tooEarly = lastOfMonth.getTime() < lower.getTime();
                    const tooLate = !!maxBookableDate && firstOfMonth.getTime() > maxBookableDate.getTime();
                    option.disabled = tooEarly || tooLate;
                });
            }
        };

        label();

        const observer = new MutationObserver(label);
        observer.observe(root, { childList: true, subtree: true });
        return () => observer.disconnect();
        // availabilityWindow, not maxBookableDate: the latter is a fresh Date
        // on every render, so depending on it would tear down and rebuild the
        // observer constantly. The window prop is what actually decides it.
    }, [disabledDates, availabilityWindow]);

    const [priceOverrides, setPriceOverrides] = useState<Record<string, number>>({});
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

            const { data: existing } = await supabase
                // Busy nights, not bookings. A stranger can read no row of `bookings` at
                // all — see 20260828231530_bookings_are_not_public.sql — and the
                // view returns which listing, which nights and whether they are
                // pending or confirmed. Nothing about who, nothing about money.
                //
                // This is also where the lost-booking bug was: the old policy only
                // permitted 'confirmed', so a signed-out guest saw nights somebody
                // was mid-checkout on as free, picked them, and was refused at the
                // card. The view carries pending too.
                .from('listing_busy_nights')
                .select('check_in, check_out')
                .eq('listing_id', listingId)
                .in('status', ['pending', 'confirmed']);

            const blocked: Date[] = [];
            const addRange = (startStr: string, endStr: string) => {
                let d = new Date(startStr);
                const end = new Date(endStr);
                while (d < end) {
                    blocked.push(new Date(d));
                    d = addDays(d, 1);
                }
            };

            (existing || []).forEach((b) => addRange(b.check_in, b.check_out));

            const { data: calOverrides } = await supabase
                .from('calendar_overrides')
                .select('date, is_blocked, price_override')
                .eq('listing_id', listingId);

            const prices: Record<string, number> = {};
            (calOverrides || []).forEach((o) => {
                if (o.is_blocked) blocked.push(new Date(o.date));
                if (o.price_override) prices[o.date] = o.price_override;
            });
            setPriceOverrides(prices);

            // The server merges every calendar this listing syncs with. It
            // takes the listing id rather than a URL, so the host's private
            // export links never reach the browser.
            try {
                const res = await fetch('/api/ical-import?listing=' + encodeURIComponent(listingId));
                if (res.ok) {
                    const data = await res.json();
                    (data.events || []).forEach((ev: { start: string; end: string }) => addRange(ev.start, ev.end));
                }
            } catch {
                // If an external calendar can't be reached, we simply don't
                // block those dates — it shouldn't break booking altogether.
            }

            setDisabledDates(blocked);
        };
        load();
    }, [supabase, listingId]);

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

        setSubmitting(true);
        try {
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
                check_in: dateRange.startDate.toISOString().split('T')[0],
                check_out: dateRange.endDate.toISOString().split('T')[0],
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
                toast.error(insertErr.message, { theme: 'colored' });
                setError(insertErr.message);
                return;
            }

            // Hand over to Stripe's payment page. The host is told by
            // email from the webhook, once the money has actually arrived.
            const res = await fetch('/api/stripe/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingId: created.id, plan: payPlan }),
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
        <div className="border rounded-2xl p-5 sticky top-6">
            <div className="mb-4">
                <span className="text-2xl font-bold text-slate-900">£{pricePerNight}</span>
                <span className="text-slate-500"> / night</span>
                {weekendPrice && <span className="text-xs text-slate-400 block mt-0.5">£{weekendPrice} on Fri &amp; Sat nights</span>}
            </div>

            <div ref={calendarRef} className="border rounded-xl overflow-hidden mb-4">
                <DateRangePicker
                    ranges={[dateRange]}
                    onChange={handleSelect}
                    minDate={new Date()}
                    maxDate={maxBookableDate}
                    disabledDates={disabledDates}
                    months={1}
                    direction="vertical"
                    rangeColors={['#047857']}
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
            </div>

            {/*
              Said before it is hit, not after. The greyed-out months stop a
              guest choosing one they cannot have, but a control that simply
              refuses still leaves them wondering whether the place is booked
              solid or the site is broken. This is the sentence that answers it,
              and it is why the fix is both halves rather than either.
            */}
            {maxBookableDate && (
                <p className="text-xs text-slate-500 -mt-2 mb-4">
                    This place takes bookings up to {formatUk(maxBookableDate)}.
                </p>
            )}

            <div className="mb-4 border rounded-xl px-3 divide-y">
                <Counter label="Adults" sub="Ages 13+" value={adults} onChange={setAdults} min={1} />
                <Counter label="Children" sub="Ages 2–12" value={children} onChange={setChildren} min={0} />
                {petsAllowed && (
                    <Counter label="Pets" sub="This place allows pets" value={pets} onChange={setPets} min={0} />
                )}
            </div>
            <p className="text-xs text-slate-400 -mt-3 mb-4">Max {maxGuests} guests{petsAllowed ? ' (pets don\'t count toward this)' : ''}</p>

            {nights > 0 && (
                <div className="border-t pt-3 mb-4 text-sm space-y-1.5">
                    <div className="flex justify-between text-slate-600">
                        <span>{nights} night{nights > 1 ? 's' : ''}</span>
                        <span>£{nightsSubtotal.toFixed(2)}</span>
                    </div>
                    {cleaningFeeTotal > 0 && (
                        <div className="flex justify-between text-slate-600">
                            <span>Cleaning fee</span>
                            <span>£{cleaningFeeTotal.toFixed(2)}</span>
                        </div>
                    )}
                    {petFeeTotal > 0 && (
                        <div className="flex justify-between text-slate-600">
                            <span>Pet fee</span>
                            <span>£{petFeeTotal.toFixed(2)}</span>
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
                                        ' × £' +
                                        Number(extraGuestFee).toFixed(2) +
                                        (extraGuestPeriod === 'stay' ? '' : ' × ' + nights + (nights === 1 ? ' night' : ' nights'))
                                    );
                                })()}
                            </span>
                            <span>£{extraGuestTotal.toFixed(2)}</span>
                        </div>
                    )}
                    <div className="flex justify-between font-bold text-slate-900 mt-2 pt-2 border-t">
                        <span>Total</span>
                        <span>£{total.toFixed(2)}</span>
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
                            <span className="text-sm font-bold text-slate-900">£{depositNow.toFixed(2)}</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                            £{depositNow.toFixed(2)} now &middot; £{depositLater.toFixed(2)} on {formatUk(balanceDate)}
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
                            <span className="text-sm font-bold text-slate-900">£{total.toFixed(2)}</span>
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
                        £{Number(damageDeposit).toFixed(2)} damage deposit
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
                <div className="text-center">
                    <p className="text-sm text-slate-500 mb-2">Log in to request this booking</p>
                    <LoginModel />
                </div>
            ) : (
                <button
                    type="button"
                    onClick={handleRequest}
                    disabled={submitting || nights <= 0}
                    className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl transition disabled:opacity-50"
                >
                    {submitting
                        ? 'Taking you to payment...'
                        : nights > 0
                            ? 'Secure your dates for £' + dueNow.toFixed(2)
                            : (instantBook ? 'Reserve' : 'Request to book')}
                </button>
            )}
            <p className="text-xs text-slate-400 text-center mt-3">
                {instantBook
                    ? 'Payment is taken securely by Stripe. Your dates are confirmed straight away.'
                    : 'Payment is taken securely by Stripe. If the host declines, you get it all back.'}
            </p>
        </div>
    );
}
