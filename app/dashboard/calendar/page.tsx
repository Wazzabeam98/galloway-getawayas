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
import { ChevronLeft, ChevronRight, Wrench, X } from 'lucide-react';
import Link from 'next/link';
import { firstName } from "@/lib/utils";
import { requestedWhen } from '@/lib/serviceEnquiries';
import { tradeLabel } from '@/lib/serviceProviders';

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

// Accepted, planned service work the host asked a tradesman for. It carries a
// requested date and an optional window — NOT a confirmed slot. Nothing here
// holds the day; it is shown so a host can see, and be warned about, a guest
// and a trade landing on the same date. See lib/serviceEnquiries.ts, which
// guards the "asked for, never booked" wording this reuses.
interface Work {
    preferred_date: string;
    trade: string;
    business_name: string;
    window_from: string | null;
    window_to: string | null;
}

// A read-only summary of listing-wide settings that now live in the listing
// editor. The calendar shows them so a host can see the figures without leaving
// the page, and links through to the one place they are changed — never a
// second control writing the same column.
function SettingSummary({
    note,
    editHref,
    canEdit,
    rows,
}: {
    note: string;
    editHref: string;
    canEdit: boolean;
    rows: [string, string][];
}) {
    return (
        <div className="border rounded-2xl p-5">
            <p className="text-xs text-slate-500 mb-3">{note}</p>
            <dl className="divide-y divide-slate-100">
                {rows.map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between py-2 text-sm">
                        <dt className="text-slate-500">{label}</dt>
                        <dd className="font-medium text-slate-900">{value}</dd>
                    </div>
                ))}
            </dl>
            {canEdit && (
                <Link href={editHref} className="mt-4 inline-flex text-sm font-semibold text-emerald-700 hover:underline">
                    Edit in listing &rarr;
                </Link>
            )}
        </div>
    );
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
    // preferred_date -> the accepted, planned work asked for that day. Keyed by
    // the day, because more than one job can be asked for on the same date.
    const [workByDate, setWorkByDate] = useState<Record<string, Work[]>>({});
    // date -> which platform has it, from the imported calendars
    const [external, setExternal] = useState<Record<string, { platform: string; name: string }>>({});
    const [guestNames, setGuestNames] = useState<Record<string, string>>({});
    // Which listing the bookings/blocks/synced nights above belong to. Until it
    // matches the selected listing the month is not drawn — an empty map would
    // show every night as open at the base price, then fill in, which reads as
    // the calendar being wrong. Also covers switching listing.
    const [calendarFor, setCalendarFor] = useState<string>('');

    const [rightTab, setRightTab] = useState<'manage' | 'pricing' | 'fees' | 'availability'>('manage');

    // Which of these listings this person may edit, not merely open. The page
    // is a can_calendar screen, but its Pricing, Fees and Availability tabs
    // change the listing itself, which is can_listing. Drawing them for a
    // co-host without it would be a button that can only fail.
    const [canEditListing, setCanEditListing] = useState<Record<string, boolean>>({});

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
                // Properties they own, plus any they co-host with permission
                // to manage the calendar.
                const res = await fetch('/api/my-listings?permission=can_calendar');
                const allowed = res.ok ? (await res.json()).listings || [] : [];
                const ids = allowed.map((a: any) => a.id);

                const editable: Record<string, boolean> = {};
                allowed.forEach((a: any) => { editable[a.id] = !!a.can_listing; });
                setCanEditListing(editable);

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

    // Switching to a property they only have calendar access to must not leave
    // them looking at a tab that is no longer in the bar.
    useEffect(() => {
        if (selectedListingId && !canEditListing[selectedListingId] && rightTab !== 'manage') {
            setRightTab('manage');
        }
    }, [selectedListingId, canEditListing, rightTab]);

    useEffect(() => {
        if (!selectedListingId) return;

        let live = true;
        const loadCalendarData = async () => {
            // In parallel, not one after another: these used to run in a row,
            // which is most of the wait before the month could be trusted.
            const [{ data: overrideRows }, { data: bookingRows }, { data: workRows }, icalRes] = await Promise.all([
                supabase
                    .from('calendar_overrides')
                    .select('date, is_blocked, price_override, min_nights_override')
                    .eq('listing_id', selectedListingId),
                supabase
                    .from('bookings')
                    .select('check_in, check_out, guest_id')
                    .eq('listing_id', selectedListingId)
                    .eq('status', 'confirmed'),
                // Accepted, planned work the host asked a tradesman for on this
                // cottage — see the note where it is mapped below.
                supabase
                    .from('service_enquiries')
                    .select('preferred_date, trade, business_name, window_from, window_to')
                    .eq('listing_id', selectedListingId)
                    .eq('status', 'accepted')
                    .eq('urgency', 'planned')
                    .not('preferred_date', 'is', null),
                fetch('/api/ical-import?listing=' + selectedListingId).catch(() => null),
            ]);
            if (!live) return;

            const map: Record<string, Override> = {};
            (overrideRows || []).forEach((o) => { map[o.date] = o; });
            setOverrides(map);

            setBookings(bookingRows || []);

            // Accepted, planned work the host asked a tradesman for on this
            // cottage. Only 'planned' carries a date; 'accepted' is the point a
            // tradesman said he would take a look. Neither holds the day — this
            // is shown so the host can SEE the work, and be warned where a guest
            // and a trade fall on one date. The wording stays "asked for"
            // everywhere it renders. A co-host without a select policy simply
            // gets nothing back, which shows an empty layer rather than failing.
            const wmap: Record<string, Work[]> = {};
            (workRows || []).forEach((w: any) => {
                const k = String(w.preferred_date).slice(0, 10);
                (wmap[k] = wmap[k] || []).push(w as Work);
            });
            setWorkByDate(wmap);

            // Dates taken on Airbnb, Booking.com and anywhere else this
            // listing syncs with. Without this a host sees their Galloway
            // bookings only and assumes the rest of the month is free.
            try {
                const res = icalRes;
                const data = res && res.ok ? await res.json() : { events: [] };

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
                (profiles || []).forEach((p) => { names[p.id] = firstName(p, 'Guest'); });
                if (live) setGuestNames(names);
            }
            if (live) setCalendarFor(selectedListingId);
        };
        loadCalendarData();
        return () => { live = false; };
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

    // How full the month is, counting every source together. A host sees
    // Galloway as one channel among several, so singling our own bookings out
    // as "direct" would be our framing, not theirs — and the split between
    // channels is their business, not something this page needs to total up.
    const monthSummary = useMemo(() => {
        const sources: Record<string, { name: string; colour: string }> = {};
        let sold = 0;
        let blocked = 0;
        let free = 0;

        days.forEach((day) => {
            const key = format(day, 'yyyy-MM-dd');

            const booked = bookings.find((b) => {
                const start = new Date(b.check_in);
                const end = new Date(b.check_out);
                return day >= start && day < end;
            });

            if (booked) {
                sold = sold + 1;
                return;
            }

            const away = external[key];
            if (away) {
                const p = PLATFORMS[away.platform] || PLATFORMS.other;
                const id = away.name || p.name;
                if (!sources[id]) sources[id] = { name: id, colour: p.colour };
                sold = sold + 1;
                return;
            }

            if (overrides[key]?.is_blocked) {
                blocked = blocked + 1;
                return;
            }

            free = free + 1;
        });

        return {
            sold: sold,
            blocked: blocked,
            free: free,
            sources: Object.keys(sources).map((k) => sources[k]),
            occupancy: days.length ? Math.round((sold / days.length) * 100) : 0,
        };
    }, [days, bookings, external, overrides]);

    const bookingForDate = (date: Date) => {
        return bookings.find((b) => {
            const start = new Date(b.check_in);
            const end = new Date(b.check_out);
            return date >= start && date < end;
        });
    };

    // The hover text for a day that has work asked for. requestedWhen carries
    // the "Asked for …" wording from lib/serviceEnquiries, so a tooltip can
    // never read as a confirmed appointment. When a guest is also in on the
    // day, that is said first — it is the collision the host needs to see.
    const workTitle = (work: Work[], collision: boolean) => {
        const lines = work.map((w) => {
            const when = requestedWhen(w);
            return tradeLabel(w.trade) + (when ? ' — ' + when.charAt(0).toLowerCase() + when.slice(1) : ' — asked for this day');
        });
        return (collision ? 'A guest is in on this day — check before it clashes.\n' : '') + lines.join('\n');
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

    // Pricing, Fees and Availability are no longer edited here. Each of those
    // settings has one home — the listing editor — and this page shows them
    // read-only with a link through to it, so there is never a second control
    // writing the same column with nothing to say which was used last. The
    // calendar keeps what is genuinely its own: per-date price and minimum-stay
    // overrides, under "Manage dates".

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
                <div className="w-full max-w-xs"><LoginModel variant="button" /></div>
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

    // Manage dates is the calendar itself and belongs to can_calendar. The
    // other three change the listing, so they are only offered to someone who
    // may edit it — see canEditListing.
    const mayEditSelected = !!selectedListingId && !!canEditListing[selectedListingId];

    const TABS = ([
        { key: 'manage', label: 'Manage dates' },
        { key: 'pricing', label: 'Pricing' },
        { key: 'fees', label: 'Fees' },
        { key: 'availability', label: 'Availability' },
    ] as const).filter((t) => t.key === 'manage' || mayEditSelected);

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

                    <div className="relative">
                    {calendarFor !== selectedListingId && (
                        <div className="absolute inset-0 z-20 grid grid-cols-7 gap-1.5 bg-white" aria-busy="true" aria-label="Loading calendar">
                            {Array.from({ length: leadingBlanks }).map((_, i) => <div key={`sk-blank-${i}`} />)}
                            {days.map((day) => (
                                <div key={'sk-' + day.toISOString()} className="aspect-square rounded-xl bg-slate-100 animate-pulse" />
                            ))}
                        </div>
                    )}
                    <div className={`grid grid-cols-7 gap-1.5 ${calendarFor !== selectedListingId ? 'invisible' : ''}`}>
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

                            const work = workByDate[key];
                            const hasWork = !isPast && !!(work && work.length);
                            // A guest is "in" whether the stay is ours or came
                            // off another channel — either way the cottage is
                            // occupied, so either counts as a clash with work.
                            const collision = hasWork && (!!booking || !!away);

                            return (
                                <button
                                    key={key}
                                    type="button"
                                    disabled={isPast}
                                    onClick={() => handleDayClick(day)}
                                    className={`relative aspect-square rounded-xl border-2 p-1.5 flex flex-col items-start justify-between text-left transition ${
                                        isPast ? 'opacity-30 cursor-not-allowed border-slate-100' :
                                        booking ? 'border-slate-900 bg-slate-900 text-white' :
                                        awayColour ? 'text-white' :
                                        override?.is_blocked ? 'border-slate-300 bg-slate-100 text-slate-400' :
                                        selected ? 'border-slate-900 bg-slate-50' :
                                        'border-slate-200 hover:border-slate-400'
                                    } ${collision ? 'ring-2 ring-amber-400 ring-offset-1' : ''}`}
                                    style={
                                        awayColour
                                            ? { backgroundColor: awayColour, borderColor: awayColour }
                                            : undefined
                                    }
                                >
                                    {/* Work asked for that day. Amber when a
                                        guest is also in — the one case a host
                                        needs to catch. A request, never a slot:
                                        the hover text says "asked for". */}
                                    {hasWork && (
                                        <span
                                            title={workTitle(work, collision)}
                                            className={`absolute top-1 right-1 z-10 flex items-center justify-center w-4 h-4 rounded-full shadow-sm ${
                                                collision ? 'bg-amber-400 text-amber-950'
                                                    : (booking || awayColour) ? 'bg-white text-slate-900'
                                                    : 'bg-emerald-600 text-white'
                                            }`}
                                        >
                                            <Wrench className="w-2.5 h-2.5" />
                                        </span>
                                    )}
                                    <span className={`text-xs font-medium ${booking || awayColour ? 'text-white' : override?.is_blocked ? 'line-through' : 'text-[#222222]'}`}>
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
                    </div>

                    <div className="mt-6 border-t pt-5">
                        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 mb-4">
                            <div>
                                <span className="text-2xl font-bold text-slate-900">
                                    {monthSummary.occupancy}%
                                </span>
                                <span className="text-xs text-slate-500 ml-1.5">booked</span>
                            </div>

                            <div className="text-xs text-slate-500">
                                {monthSummary.sold} {monthSummary.sold === 1 ? 'night' : 'nights'} booked
                                {monthSummary.free > 0
                                    ? ', ' + monthSummary.free + ' still free'
                                    : ''}
                                {monthSummary.blocked > 0
                                    ? ', ' + monthSummary.blocked + ' blocked'
                                    : ''}
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500">
                            <div className="flex items-center gap-1.5">
                                <span className="w-3 h-3 rounded bg-slate-900" /> Booked here
                            </div>

                            {monthSummary.sources.map((p) => (
                                <div key={p.name} className="flex items-center gap-1.5">
                                    <span
                                        className="w-3 h-3 rounded"
                                        style={{ backgroundColor: p.colour }}
                                    />
                                    {p.name}
                                </div>
                            ))}

                            <div className="flex items-center gap-1.5">
                                <span className="w-3 h-3 rounded bg-slate-100 border border-slate-300" /> Blocked
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="w-3 h-3 rounded border-2 border-slate-200" /> Available
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="w-4 h-4 rounded-full bg-emerald-600 flex items-center justify-center">
                                    <Wrench className="w-2.5 h-2.5 text-white" />
                                </span>
                                Work asked for
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="w-4 h-4 rounded-full bg-amber-400 flex items-center justify-center">
                                    <Wrench className="w-2.5 h-2.5 text-amber-950" />
                                </span>
                                Guest in + work asked — check
                            </div>
                        </div>
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

                    {rightTab === 'pricing' && mayEditSelected && selectedListing && (
                        <SettingSummary
                            note="Set in the listing. Per-date overrides for a specific day or range are under Manage dates."
                            editHref={`/edit-listing/${selectedListingId}?section=rates`}
                            canEdit={mayEditSelected}
                            rows={[
                                ['Base price', `£${selectedListing.price_per_night ?? 0} / night`],
                                ['Weekend price', selectedListing.weekend_price ? `£${selectedListing.weekend_price} / night` : 'Same as base'],
                            ]}
                        />
                    )}

                    {rightTab === 'fees' && mayEditSelected && selectedListing && (
                        <SettingSummary
                            note="Set in the listing, under Booking settings."
                            editHref={`/edit-listing/${selectedListingId}?section=booking`}
                            canEdit={mayEditSelected}
                            rows={[
                                ['Cleaning fee', selectedListing.cleaning_fee ? `£${selectedListing.cleaning_fee} / stay` : 'None'],
                                [
                                    'Extra guest fee',
                                    selectedListing.extra_guest_fee
                                        ? `£${selectedListing.extra_guest_fee} / ${selectedListing.extra_guest_period === 'stay' ? 'stay' : 'night'}, after ${selectedListing.extra_guest_after || 1}`
                                        : 'None',
                                ],
                                ['Pet fee', selectedListing.pet_fee ? `£${selectedListing.pet_fee} / stay` : 'None'],
                                ['Damage deposit', selectedListing.damage_deposit ? `£${selectedListing.damage_deposit}` : 'None'],
                            ]}
                        />
                    )}

                    {rightTab === 'availability' && mayEditSelected && selectedListing && (
                        <SettingSummary
                            note="Set in the listing, under Booking settings."
                            editHref={`/edit-listing/${selectedListingId}?section=booking`}
                            canEdit={mayEditSelected}
                            rows={[
                                ['Minimum nights', String(selectedListing.min_nights || 1)],
                                ['Maximum nights', selectedListing.max_nights ? String(selectedListing.max_nights) : 'No limit'],
                                ['Advance notice', selectedListing.advance_notice || 'Same day'],
                                ['Preparation time', selectedListing.preparation_time || 'None'],
                                ['Booking window', selectedListing.availability_window || '9 months'],
                            ]}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
