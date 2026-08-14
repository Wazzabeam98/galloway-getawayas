'use client';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { DateRangePicker, Range, RangeKeyDict } from 'react-date-range';
import { differenceInCalendarDays, addDays, isSameDay } from 'date-fns';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';
import LoginModel from '@/components/auth/LoginModel';
import { toast } from 'react-toastify';

interface Props {
    listingId: string;
    hostId: string;
    pricePerNight: number;
    maxGuests: number;
}

export default function BookingWidget({ listingId, hostId, pricePerNight, maxGuests }: Props) {
    const supabase = createClientComponentClient();
    const [session, setSession] = useState<any>(null);
    const [loadingSession, setLoadingSession] = useState(true);
    const [disabledDates, setDisabledDates] = useState<Date[]>([]);
    const [guests, setGuests] = useState(1);
    const [dateRange, setDateRange] = useState<Range>({
        startDate: undefined,
        endDate: undefined,
        key: 'selection',
    });
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [requested, setRequested] = useState(false);

    useEffect(() => {
        const load = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setSession(session);
            setLoadingSession(false);

            const { data: existing } = await supabase
                .from('bookings')
                .select('check_in, check_out')
                .eq('listing_id', listingId)
                .in('status', ['pending', 'confirmed']);

            const blocked: Date[] = [];
            (existing || []).forEach((b) => {
                let d = new Date(b.check_in);
                const end = new Date(b.check_out);
                while (d < end) {
                    blocked.push(new Date(d));
                    d = addDays(d, 1);
                }
            });
            setDisabledDates(blocked);
        };
        load();
    }, [supabase, listingId]);

    const nights =
        dateRange.startDate && dateRange.endDate
            ? differenceInCalendarDays(dateRange.endDate, dateRange.startDate)
            : 0;
    const total = nights * pricePerNight;

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
        if (guests > maxGuests) {
            setError(`This place sleeps up to ${maxGuests} guests.`);
            return;
        }

        // Re-check for overlap right before submitting, in case someone else booked in the meantime.
        const overlap = disabledDates.some(
            (d) => dateRange.startDate! <= d && d < dateRange.endDate!
        );
        if (overlap) {
            setError('Some of those dates were just booked by someone else. Please pick different dates.');
            return;
        }

        setSubmitting(true);
        try {
            const { error: insertErr } = await supabase.from('bookings').insert({
                listing_id: listingId,
                guest_id: session.user.id,
                host_id: hostId,
                check_in: dateRange.startDate.toISOString().split('T')[0],
                check_out: dateRange.endDate.toISOString().split('T')[0],
                guests,
                total_price: total,
                status: 'pending',
            });

            if (insertErr) {
                toast.error(insertErr.message, { theme: 'colored' });
                setError(insertErr.message);
                return;
            }

            setRequested(true);
            toast.success('Booking request sent to the host.', { theme: 'colored' });
        } catch (err: any) {
            const msg = err?.message || 'Something went wrong sending your request.';
            toast.error(msg, { theme: 'colored' });
            setError(msg);
        } finally {
            setSubmitting(false);
        }
    };

    if (requested) {
        return (
            <div className="border rounded-2xl p-6 bg-slate-50 text-center">
                <h3 className="font-bold text-lg text-slate-900 mb-1">Request sent</h3>
                <p className="text-slate-600 text-sm">
                    The host will review your dates and confirm or decline. You'll be able to see the status from your account.
                </p>
            </div>
        );
    }

    return (
        <div className="border rounded-2xl p-5 sticky top-6">
            <div className="mb-4">
                <span className="text-2xl font-bold text-slate-900">£{pricePerNight}</span>
                <span className="text-slate-500"> / night</span>
            </div>

            <div className="border rounded-xl overflow-hidden mb-4">
                <DateRangePicker
                    ranges={[dateRange]}
                    onChange={handleSelect}
                    minDate={new Date()}
                    disabledDates={disabledDates}
                    months={1}
                    direction="vertical"
                    rangeColors={['#f43f5e']}
                    showDateDisplay={false}
                />
            </div>

            <div className="mb-4">
                <label className="text-xs font-semibold text-slate-500 uppercase">Guests</label>
                <input
                    type="number"
                    min={1}
                    max={maxGuests}
                    value={guests}
                    onChange={(e) => setGuests(Math.max(1, Math.min(maxGuests, Number(e.target.value))))}
                    className="w-full p-2.5 border rounded-lg text-sm mt-1"
                />
                <p className="text-xs text-slate-400 mt-1">Max {maxGuests} guests</p>
            </div>

            {nights > 0 && (
                <div className="border-t pt-3 mb-4 text-sm">
                    <div className="flex justify-between text-slate-600">
                        <span>£{pricePerNight} × {nights} night{nights > 1 ? 's' : ''}</span>
                        <span>£{total.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-slate-900 mt-2 pt-2 border-t">
                        <span>Total</span>
                        <span>£{total.toFixed(2)}</span>
                    </div>
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
                    className="w-full py-3 bg-rose-500 hover:bg-rose-600 text-white font-bold rounded-xl transition disabled:opacity-50"
                >
                    {submitting ? 'Sending request...' : 'Request to book'}
                </button>
            )}
            <p className="text-xs text-slate-400 text-center mt-3">You won't be charged yet</p>
        </div>
    );
}
