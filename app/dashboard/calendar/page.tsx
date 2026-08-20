'use client';

import { PLATFORMS } from '@/lib/platforms';
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
import { displayName } from "@/lib/utils";

interface Listing {
    id: string;
    title: string;
    price_per_night: number;
    min_nights: number;
    max_nights: number | null;
    weekend_price: number | null;
    cleaning_fee: number;
    damage_deposit: number;
    pet_fee: number;
    extra_guest_fee: number;
    extra_guest_after: number;
    extra_guest_period: string;
    advance_notice: string;
    preparation_time: string;
    availability_window: string;
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

const ADVANCE_NOTICE_OPTIONS = ['Same day', '1 day', '2 days', '3 days', '7 days'];
const PREP_TIME_OPTIONS = ['None', '1 day', '2 days', '3 days'];
const AVAILABILITY_WINDOW_OPTIONS = ['3 months', '6 months', '9 months', '12 months', 'All future dates'];

export default function CalendarPage() {
    const supabase = createClientComponentClient();
    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<any>(null);

    const [listings, setListings] = useState<Listing[]>([]);
    const [selectedListingId, setSelectedListingId] = useState<string>('');
    const [month, setMonth] = useState(startOfMonth(new Date()));
    const [overrides, setOverrides] = useState<Record<string, Override>>({});
    const [bookings, setBookings] = useState<Booking[]>([]);
    // date -> which platform has it, from the imported calendars
    const [external, setExternal] = useState<Record<string, { platform: string; name: string }>>({});
    const [guestNames, setGuestNames] = useState<Record<string, string>>({});

    const [rightTab, setRightTab] = useState<'manage' | 'pricing' | 'fees' | 'availability'>('manage');

    const [selectionStart, setSelectionStart] = useState<Date | null>(null);
    const [selectionEnd, setSelectionEnd] = useState<Date | null>(null);
    const [panelOpen, setPanelOpen] = useState(false);
    const [panelBlocked, setPanelBlocked] = useState(false);
    const [panelPrice, setPanelPrice] = useState('');
    const [panelMinNights, setPanelMinNights] = useState('');
    const [saving, setSaving] = useState(false);

    // Listing-wide settings form state (Pricing / Fees / Availability tabs)
    const [basePrice, setBasePrice] = useState('');
    const [weekendPrice, setWeekendPrice] = useState('');
    const [cleaningFee, setCleaningFee] = useState('0');
    const [damageDeposit, setDamageDeposit] = useState('0');
    const [petFee, setPetFee] = useState('0');
    const [extraGuestFee, setExtraGuestFee] = useState('0');
    const [extraGuestAfter, setExtraGuestAfter] = useState('1');
    const [extraGuestPeriod, setExtraGuestPeriod] = useState('night');
    const [minNightsGlobal, setMinNightsGlobal] = useState('1');
    const [maxNightsGlobal, setMaxNightsGlobal] = useState('');
    const [advanceNotice, setAdvanceNotice] = useState('Same day');
    const [preparationTime, setPreparationTime] = useState('None');
    const [availabilityWindow, setAvailabilityWindow] = useState('9 months');
    const [savingSettings, setSavingSettings] = useState(false);

    const selectedListing = listings.find((l) => l.id === selectedListingId);

    useEffect(() => {
        const load = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setSession(session);

            if (session?.user) {
                // Properties they own, plus any they co-host with permission
                // to manage the calendar.
                const res = await fetch('/api/my-listings?permission=can_calendar');
                const allowed = res.ok ? (await res.json()).listings || [] : [];
                const ids = allowed.map((a: any) => a.id);

                const { data } = ids.length
                    ? await supabase
                        .from('listings')
                        .select('id, title, price_per_night, min_nights, max_nights, weekend_price, cleaning_fee, pet_fee, extra_guest_fee, extra_guest_after, extra_guest_period, damage_deposit, advance_notice, preparation_time, availability_window')
                        .in('id', ids)
                        // A hidden listing still has guests arriving, so its
                        // calendar has to stay reachable.
                        .neq('status', 'draft')
                    : { data: [] };

                setListings(data || []);
                if (data && data.length > 0) setSelectedListingId(data[0].id);
            }
            setLoading(false);
        };
        load();
    }, [supabase]);

    // Whenever the selected listing changes, sync the settings form fields to it.
    useEffect(() => {
        if (!selectedListing) return;
        setBasePrice(String(selectedListing.price_per_night ?? ''));
        setWeekendPrice(selectedListing.weekend_price ? String(selectedListing.weekend_price) : '');
        setCleaningFee(String(selectedListing.cleaning_fee ?? 0));
        setDamageDeposit(String(selectedListing.damage_deposit ?? 0));
        setPetFee(String(selectedListing.pet_fee ?? 0));
        setExtraGuestFee(String(selectedListing.extra_guest_fee ?? 0));
        setExtraGuestAfter(String(selectedListing.extra_guest_after ?? 1));
        setExtraGuestPeriod(selectedListing.extra_guest_period || 'night');
        setMinNightsGlobal(String(selectedListing.min_nights ?? 1));
        setMaxNightsGlobal(selectedListing.max_nights ? String(selectedListing.max_nights) : '');
        setAdvanceNotice(selectedListing.advance_notice || 'Same day');
        setPreparationTime(selectedListing.preparation_time || 'None');
        setAvailabilityWindow(selectedListing.availability_window || '9 months');
    }, [selectedListingId, selectedListing]);

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

            // Dates taken on Airbnb, Booking.com and anywhere else this
            // listing syncs with. Without this a host sees their Galloway
            // bookings only and assumes the rest of the month is free.
            try {
                const res = await fetch('/api/ical-import?listing=' + selectedListingId);
                const data = res.ok ? await res.json() : { events: [] };

                const map: Record<string, any> = {};

                (data.events || []).forEach((ev: any) => {
                    const day = new Date(ev.start);
                    const end = new Date(ev.end);

                    // An iCal event runs up to its checkout date, which is
                    // itself free — the same convention as a booking here.
                    while (day < end) {
                        map[format(day, 'yyyy-MM-dd')] = {
                            platform: ev.platform,
                            name: ev.platformName,
                        };
                        day.setDate(day.getDate() + 1);
                    }
                });

                setExternal(map);
            } catch (err) {
                // A calendar we can't reach shouldn't stop the page loading.
                setExternal({});
            }

            const guestIds = Array.from(new Set((bookingRows || []).map((b) => b.guest_id)));
            if (guestIds.length > 0) {
                const { data: profiles } = await supabase
                    .from('profiles')
                    .select('id, full_name, preferred_name, show_full_name')
                    .in('id', guestIds);
                const names: Record<string, string> = {};
                (profiles || []).forEach((p) => { names[p.id] = displayName(p, 'Guest'); });
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

    const leadingBlanks = useMemo(() => {
        const firstDay = getDay(startOfMonth(month));
        return (firstDay + 6) % 7;
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
        return date >= (selectionStart < end ? selectionStart : end) && date <= (selectionStart < end ? end : selectionStart);
    };

    const dayPrice = (date: Date, key: string, override?: Override) => {
        if (override?.price_override) return override.price_override;
        const dow = getDay(date); // 0=Sun, 5=Fri, 6=Sat
        if ((dow === 5 || dow === 6) && selectedListing?.weekend_price) return selectedListing.weekend_price;
        return selectedListing?.price_per_night ?? 0;
    };

    const handleDayClick = (date: Date) => {
        if (isBefore(date, startOfDay(new Date()))) return;
        if (bookingForDate(date)) return;

        if (!selectionStart || selectionEnd) {
            setSelectionStart(date);
            setSelectionEnd(null);
            return;
        }

        const start = date < selectionStart ? date : selectionStart;
        const end = date < selectionStart ? selectionStart : date;
        setSelectionStart(start);
        setSelectionEnd(end);

        const key = format(start, 'yyyy-MM-dd');
        const existing = overrides[key];
        setPanelBlocked(existing?.is_blocked || false);
        setPanelPrice(existing?.price_override ? String(existing.price_override) : '');
        setPanelMinNights(existing?.min_nights_override ? String(existing.min_nights_override) : '');
        setPanelOpen(true);
        setRightTab('manage');
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

    const saveListingSettings = async (fields: Record<string, any>) => {
        setSavingSettings(true);
        const { error } = await supabase.from('listings').update(fields).eq('id', selectedListingId);
        setSavingSettings(false);

        if (error) {
            toast.error(error.message, { theme: 'colored' });
            return;
        }

        setListings((prev) => prev.map((l) => (l.id === selectedListingId ? { ...l, ...fields } : l)));
        toast.success('Saved.', { theme: 'colored' });
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

    const TABS = [
        { key: 'manage', label: 'Manage dates' },
        { key: 'pricing', label: 'Pricing' },
        { key: 'fees', label: 'Fees' },
        { key: 'availability', label: 'Availability' },
    ] as const;

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

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-8">
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
                            const away = !booking ? external[key] : null;
                            const awayColour = away
                                ? (PLATFORMS[away.platform] || PLATFORMS.other).colour
                                : null;
                            const isPast = isBefore(day, startOfDay(new Date()));
                            const selected = isInSelection(day);
                            const price = dayPrice(day, key, override);

                            return (
                                <button
                                    key={key}
                                    type="button"
                                    disabled={isPast}
                                    onClick={() => handleDayClick(day)}
                                    className={`aspect-square rounded-xl border-2 p-1.5 flex flex-col items-start justify-between text-left transition ${
                                        isPast ? 'opacity-30 cursor-not-allowed border-slate-100' :
                                        booking ? 'border-slate-900 bg-slate-900 text-white' :
                                        awayColour ? 'text-white' :
                                        override?.is_blocked ? 'border-slate-300 bg-slate-100 text-slate-400' :
                                        selected ? 'border-slate-900 bg-slate-50' :
                                        'border-slate-200 hover:border-slate-400'
                                    }`}
                                    style={
                                        awayColour
                                            ? { backgroundColor: awayColour, borderColor: awayColour }
                                            : undefined
                                    }
                                >
                                    <span className={`text-xs font-semibold ${booking || awayColour ? 'text-white' : override?.is_blocked ? 'line-through' : 'text-slate-800'}`}>
                                        {format(day, 'd')}
                                    </span>
                                    {booking ? (
                                        <span className="text-[9px] truncate w-full">{guestNames[booking.guest_id] || 'Guest'}</span>
                                    ) : away ? (
                                        <span className="text-[9px] truncate w-full">{away.name}</span>
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
                        {Array.from(new Set(Object.keys(external).map((k) => external[k].platform))).map((key) => {
                            const p = PLATFORMS[key as string] || PLATFORMS.other;
                            const name = Object.keys(external)
                                .map((k) => external[k])
                                .find((e) => e.platform === key);
                            return (
                                <div key={key as string} className="flex items-center gap-1.5">
                                    <span
                                        className="w-3 h-3 rounded"
                                        style={{ backgroundColor: p.colour }}
                                    />
                                    {(name && name.name) || p.name}
                                </div>
                            );
                        })}
                        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border-2 border-slate-200" /> Available</div>
                    </div>
                    <p className="text-xs text-slate-400 mt-3">Click a date to select it, then click another date to select a range for date-specific overrides.</p>
                </div>

                {/* Right column: tabs + panel */}
                <div>
                    <div className="flex flex-wrap gap-1 mb-4 border-b">
                        {TABS.map((t) => (
                            <button
                                key={t.key}
                                type="button"
                                onClick={() => setRightTab(t.key)}
                                className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px transition ${rightTab === t.key ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>

                    {rightTab === 'manage' && (
                        panelOpen && selectionStart ? (
                            <div className="border rounded-2xl p-5">
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
                                    className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl transition disabled:opacity-50 mb-2"
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
                        )
                    )}

                    {rightTab === 'pricing' && (
                        <div className="border rounded-2xl p-5 space-y-5">
                            <p className="text-xs text-slate-500">These apply to all nights, unless overridden by a specific date.</p>
                            <div>
                                <label className="block text-sm font-semibold text-slate-800 mb-1">Base price</label>
                                <div className="flex items-center border rounded-xl px-3 py-2">
                                    <span className="text-slate-500 mr-1">£</span>
                                    <input type="number" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} className="w-full outline-none text-sm" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-800 mb-1">Custom weekend price</label>
                                <p className="text-xs text-slate-400 mb-1">Friday and Saturday nights</p>
                                <div className="flex items-center border rounded-xl px-3 py-2">
                                    <span className="text-slate-500 mr-1">£</span>
                                    <input type="number" value={weekendPrice} onChange={(e) => setWeekendPrice(e.target.value)} placeholder="Same as base price" className="w-full outline-none text-sm" />
                                </div>
                            </div>
                            <button
                                type="button"
                                disabled={savingSettings}
                                onClick={() => saveListingSettings({
                                    price_per_night: Number(basePrice) || 0,
                                    weekend_price: weekendPrice ? Number(weekendPrice) : null,
                                })}
                                className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl transition disabled:opacity-50"
                            >
                                {savingSettings ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                    )}

                    {rightTab === 'fees' && (
                        <div className="border rounded-2xl p-5 space-y-5">
                            <div>
                                <label className="block text-sm font-semibold text-slate-800 mb-1">Cleaning fee</label>
                                <p className="text-xs text-slate-400 mb-1">Charged once per stay</p>
                                <div className="flex items-center border rounded-xl px-3 py-2">
                                    <span className="text-slate-500 mr-1">£</span>
                                    <input type="number" value={cleaningFee} onChange={(e) => setCleaningFee(e.target.value)} className="w-full outline-none text-sm" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-800 mb-1">Pet fee</label>
                                <p className="text-xs text-slate-400 mb-1">Charged once per stay, if the guest brings a pet</p>
                                <div className="flex items-center border rounded-xl px-3 py-2">
                                    <span className="text-slate-500 mr-1">£</span>
                                    <input type="number" value={petFee} onChange={(e) => setPetFee(e.target.value)} className="w-full outline-none text-sm" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-800 mb-1">Extra guest fee</label>
                                <p className="text-xs text-slate-400 mb-2">
                                    Leave at 0 if your price covers everyone.
                                </p>

                                <div className="flex items-center border rounded-xl px-3 py-2 mb-2">
                                    <span className="text-slate-500 mr-1">£</span>
                                    <input type="number" value={extraGuestFee} onChange={(e) => setExtraGuestFee(e.target.value)} className="w-full outline-none text-sm" />
                                </div>

                                <div className="flex items-center gap-2 mb-2">
                                    <span className="text-sm text-slate-600 whitespace-nowrap">for each guest after the first</span>
                                    <input
                                        type="number"
                                        min="1"
                                        value={extraGuestAfter}
                                        onChange={(e) => setExtraGuestAfter(e.target.value)}
                                        className="w-16 border rounded-xl px-3 py-2 text-sm outline-none"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setExtraGuestPeriod('night')}
                                        className={
                                            'border rounded-xl px-3 py-2 text-sm font-medium transition ' +
                                            (extraGuestPeriod === 'night'
                                                ? 'border-slate-900 bg-slate-50 text-slate-900'
                                                : 'text-slate-500 hover:border-slate-400')
                                        }
                                    >
                                        Per night
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setExtraGuestPeriod('stay')}
                                        className={
                                            'border rounded-xl px-3 py-2 text-sm font-medium transition ' +
                                            (extraGuestPeriod === 'stay'
                                                ? 'border-slate-900 bg-slate-50 text-slate-900'
                                                : 'text-slate-500 hover:border-slate-400')
                                        }
                                    >
                                        Once per stay
                                    </button>
                                </div>

                                {Number(extraGuestFee) > 0 && (
                                    <p className="text-xs text-slate-500 mt-2">
                                        {Number(extraGuestAfter) === 1
                                            ? 'One guest is included. '
                                            : 'The first ' + (Number(extraGuestAfter) || 1) + ' guests are included. '}
                                        After that it&apos;s £{Number(extraGuestFee).toFixed(2)} each
                                        {extraGuestPeriod === 'night' ? ', per night.' : ', for the whole stay.'}
                                    </p>
                                )}
                            </div>

                            <div className="border-t pt-5">
                                <label className="block text-sm font-semibold text-slate-800 mb-1">Damage deposit</label>
                                <p className="text-xs text-slate-400 mb-1">
                                    Shown to guests before they book. You collect and return this
                                    yourself at the property — we don&apos;t take it or hold it.
                                    Leave at 0 for none.
                                </p>
                                <div className="flex items-center border rounded-xl px-3 py-2">
                                    <span className="text-slate-500 mr-1">£</span>
                                    <input type="number" value={damageDeposit} onChange={(e) => setDamageDeposit(e.target.value)} className="w-full outline-none text-sm" />
                                </div>
                            </div>
                            <button
                                type="button"
                                disabled={savingSettings}
                                onClick={() => saveListingSettings({
                                    cleaning_fee: Number(cleaningFee) || 0,
                                    pet_fee: Number(petFee) || 0,
                                    extra_guest_fee: Number(extraGuestFee) || 0,
                                    extra_guest_after: Math.max(1, Number(extraGuestAfter) || 1),
                                    extra_guest_period: extraGuestPeriod === 'stay' ? 'stay' : 'night',
                                    damage_deposit: Number(damageDeposit) || 0,
                                })}
                                className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl transition disabled:opacity-50"
                            >
                                {savingSettings ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                    )}

                    {rightTab === 'availability' && (
                        <div className="border rounded-2xl p-5 space-y-5">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Min nights</label>
                                    <input type="number" min={1} value={minNightsGlobal} onChange={(e) => setMinNightsGlobal(e.target.value)} className="w-full p-2.5 border rounded-lg text-sm" />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Max nights</label>
                                    <input type="number" value={maxNightsGlobal} onChange={(e) => setMaxNightsGlobal(e.target.value)} placeholder="No limit" className="w-full p-2.5 border rounded-lg text-sm" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-800 mb-1">Advance notice</label>
                                <select value={advanceNotice} onChange={(e) => setAdvanceNotice(e.target.value)} className="w-full p-2.5 border rounded-lg text-sm bg-white">
                                    {ADVANCE_NOTICE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-800 mb-1">Preparation time</label>
                                <p className="text-xs text-slate-400 mb-1">Buffer between bookings</p>
                                <select value={preparationTime} onChange={(e) => setPreparationTime(e.target.value)} className="w-full p-2.5 border rounded-lg text-sm bg-white">
                                    {PREP_TIME_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-800 mb-1">Availability window</label>
                                <p className="text-xs text-slate-400 mb-1">How far ahead guests can book</p>
                                <select value={availabilityWindow} onChange={(e) => setAvailabilityWindow(e.target.value)} className="w-full p-2.5 border rounded-lg text-sm bg-white">
                                    {AVAILABILITY_WINDOW_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                                </select>
                            </div>
                            <button
                                type="button"
                                disabled={savingSettings}
                                onClick={() => saveListingSettings({
                                    min_nights: Math.max(1, Number(minNightsGlobal) || 1),
                                    max_nights: maxNightsGlobal ? Number(maxNightsGlobal) : null,
                                    advance_notice: advanceNotice,
                                    preparation_time: preparationTime,
                                    availability_window: availabilityWindow,
                                })}
                                className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl transition disabled:opacity-50"
                            >
                                {savingSettings ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
