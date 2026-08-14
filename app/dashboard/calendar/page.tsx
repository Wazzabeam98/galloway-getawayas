'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import Logo from '@/components/base/Logo';
import LoginModel from '@/components/auth/LoginModel';
import { toast } from 'react-toastify';
import {
    startOfMonth, endOfMonth, eachDayOfInterval, format, addMonths, subMonths,
    isSameDay, isBefore, startOfDay, getDay,
} from 'date-fns';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

interface Listing {
    id: string;
    title: string;
    price_per_night: number;
    min_nights: number;
}

interface Override {
    date: string;
    is_blocked: boolean;
    price_override: number | null;
    min_nights_override: number | null;
}

interface Booking {
    check_in: string;
    check_out: string;
    guest_id: string;
}

export default function CalendarPage() {
    const supabase = createClientComponentClient();
    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<any>(null);

    const [listings, setListings] = useState<Listing[]>([]);
    const [selectedListingId, setSelectedListingId] = useState<string>('');
    const [month, setMonth] = useState(startOfMonth(new Date()));
    const [overrides, setOverrides] = useState<Record<string, Override>>({});
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [guestNames, setGuestNames] = useState<Record<string, string>>({});

    const [selectionStart, setSelectionStart] = useState<Date | null>(null);
    const [selectionEnd, setSelectionEnd] = useState<Date | null>(null);
    const [panelOpen, setPanelOpen] = useState(false);
    const [panelBlocked, setPanelBlocked] = useState(false);
    const [panelPrice, setPanelPrice] = useState('');
    const [panelMinNights, setPanelMinNights] = useState('');
    const [saving, setSaving] = useState(false);

    const selectedListing = listings.find((l) => l.id === selectedListingId);

    useEffect(() => {
        const load = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setSession(session);

            if (session?.user) {
                const { data } = await supabase
                    .from('listings')
                    .select('id, title, price_per_night, min_nights')
                    .eq('host_id', session.user.id)
                    .eq('status', 'published');
                setListings(data || []);
                if (data && data.length > 0) setSelectedListingId(data[0].id);
            }
            setLoading(false);
        };
        load();
    }, [supabase]);

    useEffect(() => {
        if (!selectedListingId) return;

        const loadCalendarData = async () => {
            const { data: overrideRows } = await supabase
                .from('calendar_overrides')
                .select('date, is_blocked, price_override, min_nights_override')
                .eq('listing_id', selectedListingId);

            const map: Record<string, Override> = {};
            (overrideRows || []).forEach((o) => { map[o.date] = o; });
            setOverrides(map);

            const { data: bookingRows } = await supabase
                .from('bookings')
                .select('check_in, check_out, guest_id')
                .eq('listing_id', selectedListingId)
                .eq('status', 'confirmed');
            setBookings(bookingRows || []);

            const guestIds = Array.from(new Set((bookingRows || []).map((b) => b.guest_id)));
            if (guestIds.length > 0) {
                const { data: profiles } = await supabase
                    .from('profiles')
                    .select('id, full_name, preferred_name')
                    .in('id', guestIds);
                const names: Record<string, string> = {};
                (profiles || []).forEach((p) => { names[p.id] = p.preferred_name || p.full_name || 'Guest'; });
                setGuestNames(names);
            }
        };
        loadCalendarData();
    }, [supabase, selectedListingId]);

    const days = useMemo(() => {
        const start = startOfMonth(month);
        const end = endOfMonth(month);
        return eachDayOfInterval({ start, end });
    }, [month]);

    // Pad the start of the grid so the 1st lands under the correct weekday (Mon-first).
    const leadingBlanks = useMemo(() => {
        const firstDay = getDay(startOfMonth(month)); // 0=Sun
        return (firstDay + 6) % 7; // convert to Mon=0
    }, [month]);

    const bookingForDate = (date: Date) => {
        return bookings.find((b) => {
            const start = new Date(b.check_in);
            const end = new Date(b.check_out);
            return date >= start && date < end;
        });
    };

    const isInSelection = (date: Date) => {
        if (!selectionStart) return false;
        const end = selectionEnd || selectionStart;
        const [lo, hi] = date < end ? [selectionStart, end] : [end, selectionStart];
        return date >= (selectionStart < end ? selectionStart : end) && date <= (selectionStart < end ? end : selectionStart);
    };

    const handleDayClick = (date: Date) => {
        if (isBefore(date, startOfDay(new Date()))) return;
        if (bookingForDate(date)) return; // can't edit already-booked dates here

        if (!selectionStart || selectionEnd) {
            setSelectionStart(date);
            setSelectionEnd(null);
            return;
        }

        const start = date < selectionStart ? date : selectionStart;
        const end = date < selectionStart ? selectionStart : date;
        setSelectionStart(start);
        setSelectionEnd(end);

        // Pre-fill the panel from the first selected date's existing override, if any.
        const key = format(start, 'yyyy-MM-dd');
        const existing = overrides[key];
        setPanelBlocked(existing?.is_blocked || false);
        setPanelPrice(existing?.price_override ? String(existing.price_override) : '');
        setPanelMinNights(existing?.min_nights_override ? String(existing.min_nights_override) : '');
        setPanelOpen(true);
    };

    const closePanel = () => {
        setPanelOpen(false);
        setSelectionStart(null);
        setSelectionEnd(null);
    };

    const saveOverrides = async () => {
        if (!selectionStart) return;
        const end = selectionEnd || selectionStart;
        const rangeDays = eachDayOfInterval({ start: selectionStart, end });

        setSaving(true);
        try {
            const rows = rangeDays.map((d) => ({
                listing_id: selectedListingId,
                date: format(d, 'yyyy-MM-dd'),
                is_blocked: panelBlocked,
                price_override: panelPrice ? Number(panelPrice) : null,
                min_nights_override: panelMinNights ? Number(panelMinNights) : null,
            }));

            const { error } = await supabase
                .from('calendar_overrides')
                .upsert(rows, { onConflict: 'listing_id,date' });

            if (error) {
                toast.error(error.message, { theme: 'colored' });
                return;
            }

            const map = { ...overrides };
            rows.forEach((r) => { map[r.date] = r as Override; });
            setOverrides(map);

            toast.success('Calendar updated.', { theme: 'colored' });
            closePanel();
        } catch (err: any) {
            toast.error(err?.message || 'Could not save.', { theme: 'colored' });
        } finally {
            setSaving(false);
        }
    };

    const clearOverrides = async () => {
        if (!selectionStart) return;
        const end = selectionEnd || selectionStart;
        const rangeDays = eachDayOfInterval({ start: selectionStart, end });
        const dateStrs = rangeDays.map((d) => format(d, 'yyyy-MM-dd'));

        setSaving(true);
        const { error } = await supabase
            .from('calendar_overrides')
            .delete()
            .eq('listing_id', selectedListingId)
            .in('date', dateStrs);
        setSaving(false);

        if (error) {
            toast.error(error.message, { theme: 'colored' });
            return;
        }

        const map = { ...overrides };
        dateStrs.forEach((d) => { delete map[d]; });
        setOverrides(map);
        toast.success('Reset to default.', { theme: 'colored' });
        closePanel();
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-4">
                <Logo />
                <p className="text-slate-500 animate-pulse">Loading your calendar...</p>
            </div>
        );
    }

    if (!session) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-6 text-center px-4">
                <Logo />
                <h1 className="text-2xl font-bold text-slate-900">Sign in to manage your calendar</h1>
                <LoginModel />
            </div>
        );
    }

    if (listings.length === 0) {
        return (
            <div className="text-center py-20 text-slate-500">
                You don't have any published listings yet.
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto px-6 py-10">
            <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
                <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Calendar</h1>
                {listings.length > 1 && (
                    <select
                        value={selectedListingId}
                        onChange={(e) => setSelectedListingId(e.target.value)}
                        className="p-2.5 border rounded-xl text-sm bg-white"
                    >
                        {listings.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
                    </select>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8">
                <div>
                    <div className="flex items-center justify-between mb-4">
                        <button type="button" onClick={() => setMonth(subMonths(month, 1))} className="p-2 rounded-full hover:bg-slate-100">
                            <ChevronLeft className="w-5 h-5" />
                        </button>
                        <h2 className="text-lg font-bold text-slate-900">{format(month, 'MMMM yyyy')}</h2>
                        <button type="button" onClick={() => setMonth(addMonths(month, 1))} className="p-2 rounded-full hover:bg-slate-100">
                            <ChevronRight className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="grid grid-cols-7 text-center text-xs font-semibold text-slate-500 mb-2">
                        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d}>{d}</div>)}
                    </div>

                    <div className="grid grid-cols-7 gap-1.5">
                        {Array.from({ length: leadingBlanks }).map((_, i) => <div key={`blank-${i}`} />)}
                        {days.map((day) => {
                            const key = format(day, 'yyyy-MM-dd');
                            const override = overrides[key];
                            const booking = bookingForDate(day);
                            const isPast = isBefore(day, startOfDay(new Date()));
                            const selected = isInSelection(day);
                            const price = override?.price_override ?? selectedListing?.price_per_night ?? 0;

                            return (
                                <button
                                    key={key}
                                    type="button"
                                    disabled={isPast}
                                    onClick={() => handleDayClick(day)}
                                    className={`aspect-square rounded-xl border-2 p-1.5 flex flex-col items-start justify-between text-left transition ${
                                        isPast ? 'opacity-30 cursor-not-allowed border-slate-100' :
                                        booking ? 'border-slate-900 bg-slate-900 text-white' :
                                        override?.is_blocked ? 'border-slate-300 bg-slate-100 text-slate-400' :
                                        selected ? 'border-slate-900 bg-slate-50' :
                                        'border-slate-200 hover:border-slate-400'
                                    }`}
                                >
                                    <span className={`text-xs font-semibold ${booking ? 'text-white' : override?.is_blocked ? 'line-through' : 'text-slate-800'}`}>
                                        {format(day, 'd')}
                                    </span>
                                    {booking ? (
                                        <span className="text-[9px] truncate w-full">{guestNames[booking.guest_id] || 'Guest'}</span>
                                    ) : override?.is_blocked ? (
                                        <span className="text-[9px]">Blocked</span>
                                    ) : (
                                        <span className="text-[10px] font-medium text-slate-600">£{price}</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex flex-wrap gap-4 mt-6 text-xs text-slate-500">
                        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-slate-900" /> Booked</div>
                        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-slate-100 border border-slate-300" /> Blocked</div>
                        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border-2 border-slate-200" /> Available</div>
                    </div>
                    <p className="text-xs text-slate-400 mt-3">Click a date to select it, then click another date to select a range — you'll be able to block it, set a custom price, or a minimum stay for those dates.</p>
                </div>

                {/* Side panel */}
                <div>
                    {panelOpen && selectionStart ? (
                        <div className="border rounded-2xl p-5 sticky top-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="font-bold text-slate-900">
                                    {selectionEnd && !isSameDay(selectionStart, selectionEnd)
                                        ? `${format(selectionStart, 'd MMM')} – ${format(selectionEnd, 'd MMM')}`
                                        : format(selectionStart, 'd MMM yyyy')}
                                </h3>
                                <button type="button" onClick={closePanel}><X className="w-4 h-4 text-slate-400" /></button>
                            </div>

                            <div className="flex items-center justify-between mb-4 p-3 border rounded-xl">
                                <span className="text-sm font-medium text-slate-800">Block these dates</span>
                                <button
                                    type="button"
                                    onClick={() => setPanelBlocked(!panelBlocked)}
                                    className={`w-11 h-6 rounded-full relative transition ${panelBlocked ? 'bg-slate-900' : 'bg-slate-300'}`}
                                >
                                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${panelBlocked ? 'left-5' : 'left-0.5'}`} />
                                </button>
                            </div>

                            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Custom price</label>
                            <input
                                type="number"
                                value={panelPrice}
                                onChange={(e) => setPanelPrice(e.target.value)}
                                placeholder={`Default: £${selectedListing?.price_per_night}`}
                                className="w-full p-2.5 border rounded-lg text-sm mb-4"
                            />

                            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Minimum stay override</label>
                            <input
                                type="number"
                                min={1}
                                value={panelMinNights}
                                onChange={(e) => setPanelMinNights(e.target.value)}
                                placeholder={`Default: ${selectedListing?.min_nights || 1} night(s)`}
                                className="w-full p-2.5 border rounded-lg text-sm mb-6"
                            />

                            <button
                                type="button"
                                onClick={saveOverrides}
                                disabled={saving}
                                className="w-full py-3 bg-rose-500 hover:bg-rose-600 text-white font-bold rounded-xl transition disabled:opacity-50 mb-2"
                            >
                                {saving ? 'Saving...' : 'Save'}
                            </button>
                            <button
                                type="button"
                                onClick={clearOverrides}
                                disabled={saving}
                                className="w-full py-3 border rounded-xl text-sm font-semibold text-slate-600 hover:border-slate-500"
                            >
                                Reset to default
                            </button>
                        </div>
                    ) : (
                        <div className="border rounded-2xl p-6 text-center text-sm text-slate-400">
                            Select a date (or a range) on the calendar to manage it.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
