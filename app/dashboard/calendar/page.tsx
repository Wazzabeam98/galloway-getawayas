'use client';

import { PLATFORMS } from '@/lib/platforms';
import { useEffect, useMemo, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import Logo from '@/components/base/Logo';
import LoginModel from '@/components/auth/LoginModel';
import { toast } from 'react-toastify';
import {
    startOfMonth, endOfMonth, format, addMonths, subMonths, getDay,
} from 'date-fns';
import {
    minNightsFor, prepBufferNights, prepDays, earliestCheckInKey,
    latestCheckOutKey, londonTodayKey, addDaysKey, nightsBetweenKeys,
    unsellableNights,
} from '@/lib/stayRules';
import { ChevronLeft, ChevronRight, Wrench, X } from 'lucide-react';
import { firstName, getImageUrl } from "@/lib/utils";
import { ukDate } from '@/lib/dayKey';
import { requestedWhen } from '@/lib/serviceEnquiries';
import { tradeLabel } from '@/lib/serviceProviders';

// Our own bookings have no platform colour, so they get a neutral slate — "this
// one is ours", distinct from every imported channel's colour.
const DIRECT_COLOUR = '#334155';

// Nights the minimum stay leaves unbookable — a gap too short to meet it and
// not closed on both sides, so no stay can ever include them. Marked, as
// Airbnb marks them, rather than left looking like ordinary free nights.
// The colour is a muted violet: Liam first asked for black, but that sits too
// close to the slate of "Booked direct", so violet was chosen to stand clearly
// apart from both that and Airbnb's pink/coral. Drawn as a soft diagonal wash
// (deliberately not an icon), so it reads as "a special, unavailable state"
// rather than another booking.
const MIN_STAY_COLOUR = '#7c3aed'; // violet-600
const MIN_STAY_HATCH =
    'repeating-linear-gradient(45deg, rgba(124,58,237,0.16) 0, rgba(124,58,237,0.16) 4px, transparent 4px, transparent 9px)';

// A platform's colour, lightened towards white so a whole month of bars reads
// as calm rather than a wall of saturated blocks — Airbnb's bars are soft too.
function soften(hex: string, amount: number): string {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const mix = (c: number) => Math.round(c + (255 - c) * amount);
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

// Dark or white text, whichever reads on the softened fill.
function textOn(rgb: string): string {
    const m = rgb.match(/\d+/g);
    if (!m) return '#1f2937';
    const r = Number(m[0]), g = Number(m[1]), b = Number(m[2]);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.62 ? '#1f2937' : '#ffffff';
}

// A day number out of a 'yyyy-mm-dd' key, and the weekday, without ever going
// through Date-from-ISO (which shifts under BST). Local construction only.
function dayNumber(key: string): number {
    return Number(key.slice(8, 10));
}
function dowFromKey(key: string): number {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).getDay(); // 0=Sun … 5=Fri, 6=Sat
}
function keyLabel(key: string, fmt: string): string {
    const [y, m, d] = key.split('-').map(Number);
    return format(new Date(y, m - 1, d), fmt);
}

// A selected range, compact, for naming it on each control — "12–14 Oct" within
// one month, "28 Sep – 2 Oct" across two, "14 Oct" for a single day. Built from
// the day-key parts (never toISOString), British day-before-month order.
function rangeLabel(start: string, end: string | null): string {
    if (!end || end === start) return keyLabel(start, 'd MMM');
    if (start.slice(0, 7) === end.slice(0, 7)) return `${dayNumber(start)}–${keyLabel(end, 'd MMM')}`;
    return `${keyLabel(start, 'd MMM')} – ${keyLabel(end, 'd MMM')}`;
}

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

// A date taken on another platform, as /api/ical-import returns it: a range,
// not a single day, so the calendar can draw it as one continuous bar.
interface ChannelEvent {
    start: string;
    end: string;
    platform: string;
    platformName: string;
}

// One reservation to draw as a bar — ours or imported. `start`/`end` are day
// keys; the stay holds the nights [start, end), so the bar runs from the middle
// of the check-in day to the middle of the checkout day.
interface Reservation {
    start: string;
    end: string;
    platform: string | null; // null = our own (direct) booking
    label: string;
    kind: 'direct' | 'channel';
    // Our own bookings only: the guest's photo (null = draw their initial).
    // An imported stay carries no guest at all — the iCal feed has no name or
    // photo — so it never gets one.
    avatarUrl?: string | null;
}

const ADVANCE_NOTICE_OPTIONS = ['Same day', '1 day', '2 days', '3 days', '7 days'];
const PREP_TIME_OPTIONS = ['None', '1 day', '2 days', '3 days'];
const AVAILABILITY_WINDOW_OPTIONS = ['3 months', '6 months', '9 months', '12 months', 'All future dates'];

// Shown on a listing-settings tab (Pricing, Fees, Availability) whenever its
// form holds an edit that has not been saved. One note, used by all three, so a
// typed-but-unsaved value — a 3-night minimum, a new price, a cleaning fee —
// can never pass for the setting that actually governs a booking. `extra` says
// what still applies in the meantime.
function UnsavedNote({ extra }: { extra?: string }) {
    return (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Not saved yet — these take effect only when you press <strong>Save</strong>.{extra ? ' ' + extra : ''}
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
    // Dates taken on other platforms, as ranges, from the imported calendars.
    const [channelEvents, setChannelEvents] = useState<ChannelEvent[]>([]);
    const [guestNames, setGuestNames] = useState<Record<string, string>>({});
    const [guestAvatars, setGuestAvatars] = useState<Record<string, string | null>>({});
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

    // Day keys, not Dates — the whole grid reasons in 'yyyy-mm-dd' keys now.
    const [selectionStart, setSelectionStart] = useState<string | null>(null);
    const [selectionEnd, setSelectionEnd] = useState<string | null>(null);
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

                // Kept as ranges (not expanded to a per-day map) so each stay
                // can be drawn as one continuous bar. A co-host without detail
                // gets events with no platform — dropped here.
                const evs: ChannelEvent[] = (data.events || [])
                    .filter((ev: any) => ev && ev.start && ev.end && ev.platform)
                    .map((ev: any) => ({
                        start: String(ev.start).slice(0, 10),
                        end: String(ev.end).slice(0, 10),
                        platform: ev.platform,
                        platformName: ev.platformName || '',
                    }));

                if (live) setChannelEvents(evs);
            } catch (err) {
                // A calendar we can't reach shouldn't stop the page loading.
                if (live) setChannelEvents([]);
            }

            const guestIds = Array.from(new Set((bookingRows || []).map((b) => b.guest_id)));
            if (guestIds.length > 0) {
                const { data: profiles } = await supabase
                    .from('profiles')
                    .select('id, full_name, preferred_name, show_full_name, avatar_url')
                    .in('id', guestIds);
                const names: Record<string, string> = {};
                const avatars: Record<string, string | null> = {};
                (profiles || []).forEach((p) => {
                    names[p.id] = firstName(p, 'Guest');
                    avatars[p.id] = p.avatar_url ? getImageUrl(String(p.avatar_url)) : null;
                });
                if (live) {
                    setGuestNames(names);
                    setGuestAvatars(avatars);
                }
            }
            if (live) setCalendarFor(selectedListingId);
        };
        loadCalendarData();
        return () => { live = false; };
    }, [supabase, selectedListingId]);

    const todayKey = londonTodayKey();
    const monthKey = format(month, 'yyyy-MM');

    // The month as weeks of day keys, Monday-first, carrying the overflow days
    // of the neighbouring months so a reservation bar flows across the edge
    // rather than being chopped at the 1st or the 31st.
    const weeks = useMemo(() => {
        const monthStartKey = format(startOfMonth(month), 'yyyy-MM-dd');
        const leading = (getDay(startOfMonth(month)) + 6) % 7;
        const gridStart = addDaysKey(monthStartKey, -leading);
        const total = Math.ceil((leading + endOfMonth(month).getDate()) / 7) * 7;
        const out: string[][] = [];
        for (let w = 0; w * 7 < total; w++) {
            const row: string[] = [];
            for (let d = 0; d < 7; d++) row.push(addDaysKey(gridStart, w * 7 + d));
            out.push(row);
        }
        return out;
    }, [month]);

    // Every reservation to draw — our own confirmed stays and the ones imported
    // from other platforms — as ranges, so each becomes one continuous bar.
    const reservations = useMemo<Reservation[]>(() => {
        const out: Reservation[] = [];
        bookings.forEach((b) => out.push({
            start: String(b.check_in).slice(0, 10),
            end: String(b.check_out).slice(0, 10),
            platform: null,
            label: guestNames[b.guest_id] || 'Guest',
            kind: 'direct',
            avatarUrl: guestAvatars[b.guest_id] ?? null,
        }));
        channelEvents.forEach((e) => out.push({
            start: e.start,
            end: e.end,
            platform: e.platform,
            label: e.platformName || (PLATFORMS[e.platform] || PLATFORMS.other).name,
            kind: 'channel',
        }));
        return out;
    }, [bookings, channelEvents, guestNames, guestAvatars]);

    // The per-night reservation lookup, the full unavailable-night set (taken +
    // host-blocked + preparation time), and the nights that cannot be sold at
    // all — a gap too short to meet the minimum and not closed on both sides,
    // so no stay can ever include it. Computed across the whole bookable
    // horizon (not just this month) so a run crossing the month edge is judged
    // whole. The booking card and checkout enforce the matching rule
    // (lib/stayRules), so what is marked unsellable here is exactly what a guest
    // would be refused.
    const { takenByNight, unsellable } = useMemo(() => {
        const taken: Record<string, Reservation> = {};
        const ranges: { start: string; end: string }[] = [];
        reservations.forEach((r) => {
            ranges.push({ start: r.start, end: r.end });
            let k = r.start;
            while (k < r.end) { if (!taken[k]) taken[k] = r; k = addDaysKey(k, 1); }
        });

        const unavail = new Set<string>();
        Object.keys(taken).forEach((k) => unavail.add(k));
        Object.keys(overrides).forEach((k) => { if (overrides[k].is_blocked) unavail.add(k); });
        if (selectedListing) {
            prepBufferNights(ranges, prepDays(selectedListing)).forEach((k) => unavail.add(k));
        }

        let unsell = new Set<string>();
        if (selectedListing) {
            const minOv: Record<string, number> = {};
            Object.keys(overrides).forEach((k) => {
                const m = overrides[k].min_nights_override;
                if (m) minOv[k] = Number(m);
            });
            const from = earliestCheckInKey(selectedListing, todayKey);
            const to = latestCheckOutKey(selectedListing, todayKey) || addDaysKey(todayKey, 365);
            const ordered: string[] = [];
            for (let k = from; k <= to; k = addDaysKey(k, 1)) ordered.push(k);
            unsell = unsellableNights(ordered, unavail, (key) => minNightsFor(selectedListing, minOv, key));
        }
        return { takenByNight: taken, unsellable: unsell };
    }, [reservations, overrides, selectedListing, todayKey]);

    const dayPriceFor = (key: string) => {
        const ov = overrides[key];
        if (ov?.price_override) return ov.price_override;
        const dow = dowFromKey(key); // 0=Sun … 5=Fri, 6=Sat
        if ((dow === 5 || dow === 6) && selectedListing?.weekend_price) return selectedListing.weekend_price;
        return selectedListing?.price_per_night ?? 0;
    };

    // How the month breaks down. "Sold" counts every channel together — a host
    // sees Galloway as one channel among several. The split that matters to
    // them is what is left: the nights they can still sell, and the orphan
    // nights they cannot.
    const monthSummary = useMemo(() => {
        const channels: Record<string, { name: string; colour: string }> = {};
        // Every night of the month lands in exactly one of these, so the four
        // always add up to the month's length — the old count dropped past free
        // nights, so a 31-day month could read "19 booked, 11 to sell" (30).
        let sold = 0, blocked = 0, sellable = 0, minStay = 0, inMonth = 0;
        weeks.forEach((row) => row.forEach((key) => {
            if (key.slice(0, 7) !== monthKey) return;
            inMonth = inMonth + 1;
            const res = takenByNight[key];
            if (res) {
                sold = sold + 1;
                if (res.kind === 'channel' && res.platform) {
                    const p = PLATFORMS[res.platform] || PLATFORMS.other;
                    const id = res.label || p.name;
                    if (!channels[id]) channels[id] = { name: id, colour: p.colour };
                }
                return;
            }
            if (overrides[key]?.is_blocked) { blocked = blocked + 1; return; }
            // The minimum stay leaves this night unbookable (unsellable only ever
            // holds future nights, so a past free night falls through to "to
            // sell" — it was free, and it keeps the four buckets summing).
            if (unsellable.has(key)) { minStay = minStay + 1; return; }
            sellable = sellable + 1;
        }));
        return {
            sold, blocked, sellable, minStay,
            channels: Object.keys(channels).map((k) => channels[k]),
            occupancy: inMonth ? Math.round((sold / inMonth) * 100) : 0,
        };
    }, [weeks, monthKey, takenByNight, overrides, unsellable, todayKey]);

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

    const inSelection = (key: string) => {
        if (!selectionStart) return false;
        const end = selectionEnd || selectionStart;
        const lo = selectionStart < end ? selectionStart : end;
        const hi = selectionStart < end ? end : selectionStart;
        return key >= lo && key <= hi;
    };

    const handleDayClick = (key: string) => {
        if (key < todayKey) return;
        if (takenByNight[key]) return;

        if (!selectionStart || selectionEnd) {
            setSelectionStart(key);
            setSelectionEnd(null);
            return;
        }

        const start = key < selectionStart ? key : selectionStart;
        const end = key < selectionStart ? selectionStart : key;
        setSelectionStart(start);
        setSelectionEnd(end);

        const existing = overrides[start];
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

    // Every day key from the selection's lower bound to its upper bound.
    const selectedKeys = () => {
        if (!selectionStart) return [] as string[];
        const end = selectionEnd || selectionStart;
        const lo = selectionStart < end ? selectionStart : end;
        const hi = selectionStart < end ? end : selectionStart;
        const out: string[] = [];
        for (let k = lo; k <= hi; k = addDaysKey(k, 1)) out.push(k);
        return out;
    };

    const saveOverrides = async () => {
        if (!selectionStart) return;

        setSaving(true);
        try {
            const rows = selectedKeys().map((k) => ({
                listing_id: selectedListingId,
                date: k,
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
        const dateStrs = selectedKeys();

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

    // Every listing-wide setting on this page — Pricing, Fees and Availability
    // — goes through /api/listings/save rather than updating the table here.
    //
    // Writing straight to `listings` from the browser meant nothing on this
    // screen was ever checked: not the £5,000 ceiling, not the permission, not
    // the audit trail an owner moderating somebody else's property leaves
    // behind. It was the one way left to put £50,000 a night on a listing.
    //
    // It also silently did nothing for a co-host. Row-level security matches
    // on host_id, so their update changed no rows and returned no error, and
    // the page said "Saved." on top of it. The route uses the service key
    // after checking the permission itself, so a co-host who may edit the
    // listing now genuinely saves, and one who may not is told so.
    const saveListingSettings = async (fields: Record<string, any>) => {
        if (!selectedListingId) return;
        setSavingSettings(true);

        try {
            const res = await fetch('/api/listings/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ listingId: selectedListingId, patch: fields }),
            });

            const data = await res.json().catch(() => ({}));

            if (!res.ok || !data.ok) {
                // The route's own words — it is the one that knows whether
                // this was a permission, a rule, or the database.
                toast.error(data.error || 'Could not save.', { theme: 'colored' });
                return;
            }

            setListings((prev) =>
                prev.map((l) => (l.id === selectedListingId ? { ...l, ...fields } : l))
            );
            toast.success('Saved.', { theme: 'colored' });
        } catch (err: any) {
            toast.error('Could not save — check your connection.', { theme: 'colored' });
        } finally {
            setSavingSettings(false);
        }
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

    // The stored availability settings — the single source of truth
    // (listings.min_nights and friends), normalised exactly as the sync effect
    // loads them into the form. `min_nights` is what actually governs a booking:
    // the guest booking card and the checkout route both read it through
    // minNightsFor(), and the account "Booking permissions" page reads it too.
    // So the number shown here is only real once it has been saved — an edit
    // sitting unsaved in these inputs looks like the minimum but is not one,
    // which is how the calendar could read "3" while the stored (and enforced)
    // value was still 1. availabilityDirty drives the "not saved yet" warning
    // below so that gap can never pass for a setting again.
    const savedAvailability = {
        min: String(selectedListing?.min_nights ?? 1),
        max: selectedListing?.max_nights ? String(selectedListing.max_nights) : '',
        notice: selectedListing?.advance_notice || 'Same day',
        prep: selectedListing?.preparation_time || 'None',
        window: selectedListing?.availability_window || '9 months',
    };
    const availabilityDirty =
        minNightsGlobal !== savedAvailability.min ||
        maxNightsGlobal !== savedAvailability.max ||
        advanceNotice !== savedAvailability.notice ||
        preparationTime !== savedAvailability.prep ||
        availabilityWindow !== savedAvailability.window;

    // The same unsaved-edit trap on the Pricing and Fees tabs — the form holds
    // local state until Save, so a typed price or fee can sit there looking set.
    // Normalised exactly as the sync effect loads each field from the listing.
    const pricingDirty =
        basePrice !== String(selectedListing?.price_per_night ?? '') ||
        weekendPrice !== (selectedListing?.weekend_price ? String(selectedListing.weekend_price) : '');
    const feesDirty =
        cleaningFee !== String(selectedListing?.cleaning_fee ?? 0) ||
        petFee !== String(selectedListing?.pet_fee ?? 0) ||
        extraGuestFee !== String(selectedListing?.extra_guest_fee ?? 0) ||
        extraGuestAfter !== String(selectedListing?.extra_guest_after ?? 1) ||
        extraGuestPeriod !== (selectedListing?.extra_guest_period || 'night') ||
        damageDeposit !== String(selectedListing?.damage_deposit ?? 0);

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
                        <div className="absolute inset-0 z-20 bg-white" aria-busy="true" aria-label="Loading calendar">
                            {weeks.map((row, wi) => (
                                <div key={'sk-w' + wi} className="grid grid-cols-7">
                                    {row.map((key) => <div key={'sk-' + key} className="h-[4.75rem] border border-slate-100 bg-slate-100 animate-pulse" />)}
                                </div>
                            ))}
                        </div>
                    )}
                    <div className={`overflow-hidden rounded-xl border border-slate-200 ${calendarFor !== selectedListingId ? 'invisible' : ''}`}>
                        {weeks.map((row, wi) => {
                            const weekStart = row[0];
                            const weekEnd = row[6];
                            return (
                                <div key={'w' + wi} className="relative grid grid-cols-7">
                                    {/* The day cells — flat; a reservation is drawn on top as a bar. */}
                                    {row.map((key) => {
                                        const inMonth = key.slice(0, 7) === monthKey;
                                        const isPast = key < todayKey;
                                        const ov = overrides[key];
                                        const booked = !!takenByNight[key];
                                        const blockedDay = !booked && !!ov?.is_blocked;
                                        const orphan = !booked && !blockedDay && !isPast && inMonth && unsellable.has(key);
                                        const selected = inSelection(key);
                                        const clickable = !isPast && !booked;
                                        const price = dayPriceFor(key);

                                        return (
                                            <button
                                                key={key}
                                                type="button"
                                                disabled={!clickable}
                                                onClick={() => handleDayClick(key)}
                                                className={[
                                                    'relative h-[4.75rem] border border-slate-100 p-1.5 text-left align-top transition',
                                                    // Focus ring for keyboard users only — a click must not leave one behind.
                                                    'focus:outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400',
                                                    !inMonth ? 'bg-slate-50/70' : 'bg-white',
                                                    clickable ? 'hover:bg-slate-50 cursor-pointer' : 'cursor-default',
                                                    selected ? 'z-10 ring-2 ring-inset ring-slate-900' : '',
                                                ].join(' ')}
                                                style={orphan ? { backgroundImage: MIN_STAY_HATCH } : undefined}
                                            >
                                                <span className={[
                                                    'text-xs font-medium',
                                                    (isPast || !inMonth) ? 'text-slate-300' : 'text-slate-700',
                                                    blockedDay ? 'line-through text-slate-400' : '',
                                                ].join(' ')}>
                                                    {dayNumber(key)}
                                                </span>

                                                {!booked && (
                                                    blockedDay ? (
                                                        <span className="absolute bottom-1 left-1.5 text-[9px] text-slate-400">Blocked</span>
                                                    ) : orphan ? (
                                                        <span className="absolute bottom-1 left-1.5 text-[9px] font-medium text-violet-700">
                                                            Min. stay<span className="sr-only"> — minimum stay, a gap too short to book</span>
                                                        </span>
                                                    ) : (!isPast && inMonth) ? (
                                                        <span className="absolute bottom-1 left-1.5 text-[10px] font-medium text-slate-500">£{price}</span>
                                                    ) : null
                                                )}
                                            </button>
                                        );
                                    })}

                                    {/* Reservation bars: one per stay, from the middle of the
                                        check-in day to the middle of the checkout day, so a
                                        back-to-back stay or a same-day turnover shows as two
                                        bars meeting at a cell with a small gap between them. */}
                                    <div className="pointer-events-none absolute inset-0">
                                        {reservations.map((res, ri) => {
                                            if (!(res.start <= weekEnd && res.end >= weekStart)) return null;

                                            let leftFrac = 0;
                                            let leftOpen = true;
                                            if (res.start >= weekStart) {
                                                leftFrac = (nightsBetweenKeys(weekStart, res.start) + 0.5) / 7;
                                                leftOpen = false;
                                            }
                                            let rightFrac = 1;
                                            let rightOpen = true;
                                            if (res.end <= weekEnd) {
                                                rightFrac = (nightsBetweenKeys(weekStart, res.end) + 0.5) / 7;
                                                rightOpen = false;
                                            }
                                            if (rightFrac <= leftFrac) return null;

                                            const colour = res.kind === 'direct'
                                                ? DIRECT_COLOUR
                                                : (PLATFORMS[res.platform as string] || PLATFORMS.other).colour;
                                            const fill = soften(colour, 0.78);
                                            const fg = textOn(fill);

                                            return (
                                                <div
                                                    key={'r' + ri}
                                                    className="absolute flex items-center overflow-hidden rounded-md px-2 text-[11px] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                                                    style={{
                                                        top: '2.55rem',
                                                        height: '1.65rem',
                                                        left: `calc(${leftFrac * 100}% + ${leftOpen ? 0 : 3}px)`,
                                                        right: `calc(${(1 - rightFrac) * 100}% + ${rightOpen ? 0 : 3}px)`,
                                                        backgroundColor: fill,
                                                        color: fg,
                                                        borderTopLeftRadius: leftOpen ? 0 : undefined,
                                                        borderBottomLeftRadius: leftOpen ? 0 : undefined,
                                                        borderTopRightRadius: rightOpen ? 0 : undefined,
                                                        borderBottomRightRadius: rightOpen ? 0 : undefined,
                                                    }}
                                                >
                                                    {/* Airbnb's mark of a guest: their photo, round, at the
                                                        start of the stay — only on the row the stay begins
                                                        in, not where it carries over from last week. Ours
                                                        only; an imported stay has no guest to show. Small
                                                        enough that a one-night bar on a phone keeps room
                                                        for the first letters of the name. */}
                                                    {res.kind === 'direct' && !leftOpen && (
                                                        res.avatarUrl ? (
                                                            // eslint-disable-next-line @next/next/no-img-element
                                                            <img
                                                                src={res.avatarUrl}
                                                                alt=""
                                                                className="-ml-1 mr-1.5 h-[18px] w-[18px] shrink-0 rounded-full object-cover sm:h-5 sm:w-5"
                                                            />
                                                        ) : (
                                                            <span
                                                                aria-hidden="true"
                                                                className="-ml-1 mr-1.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-emerald-50 text-[10px] font-semibold text-emerald-700 sm:h-5 sm:w-5"
                                                            >
                                                                {res.label.slice(0, 1).toUpperCase()}
                                                            </span>
                                                        )
                                                    )}
                                                    <span className="truncate">{res.label}</span>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Work-asked-for markers, on top of the bars so they stay
                                        visible on a booked day. Amber where a guest is also in. */}
                                    <div className="pointer-events-none absolute inset-0">
                                        {row.map((key) => {
                                            const isPast = key < todayKey;
                                            const work = workByDate[key];
                                            if (isPast || !(work && work.length)) return null;
                                            const collision = !!takenByNight[key];
                                            const idx = nightsBetweenKeys(weekStart, key);
                                            return (
                                                <span
                                                    key={'wk' + key}
                                                    title={workTitle(work, collision)}
                                                    className={`pointer-events-auto absolute flex items-center justify-center w-4 h-4 rounded-full shadow-sm ${
                                                        collision ? 'bg-amber-400 text-amber-950' : 'bg-emerald-600 text-white'
                                                    }`}
                                                    style={{ top: '0.3rem', left: `calc(${((idx + 1) / 7) * 100}% - 1.25rem)` }}
                                                >
                                                    <Wrench className="w-2.5 h-2.5" />
                                                </span>
                                            );
                                        })}
                                    </div>
                                </div>
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
                                {monthSummary.sold} booked
                                {', ' + monthSummary.sellable + ' to sell'}
                                {monthSummary.minStay > 0
                                    ? ', ' + monthSummary.minStay + ' on minimum stay'
                                    : ''}
                                {monthSummary.blocked > 0
                                    ? ', ' + monthSummary.blocked + ' blocked'
                                    : ''}
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500">
                            <div className="flex items-center gap-1.5">
                                <span className="w-4 h-3 rounded-sm" style={{ backgroundColor: soften(DIRECT_COLOUR, 0.78) }} /> Booked direct
                            </div>

                            {monthSummary.channels.map((p) => (
                                <div key={p.name} className="flex items-center gap-1.5">
                                    <span className="w-4 h-3 rounded-sm" style={{ backgroundColor: soften(p.colour, 0.78) }} />
                                    {p.name}
                                </div>
                            ))}

                            {monthSummary.minStay > 0 && (
                                <div className="flex items-center gap-1.5">
                                    <span className="w-4 h-3 rounded-sm border" style={{ backgroundImage: MIN_STAY_HATCH, borderColor: MIN_STAY_COLOUR }} /> Minimum stay
                                </div>
                            )}
                            <div className="flex items-center gap-1.5">
                                <span className="w-4 h-3 rounded-sm bg-slate-100 border border-slate-300" /> Blocked
                            </div>
                        </div>
                    </div>

                    <p className="text-xs text-slate-400 mt-3">Click a free date, then another, to set a price, a minimum stay or to block those nights.</p>
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
                                {/* The dates this panel is about, named at the top (from → to, our
                                    usual DD/MM/YYYY) as Airbnb does, so the controls below are never
                                    ambiguous about which nights they change. */}
                                <div className="flex items-start justify-between mb-4">
                                    <div className="grid grid-cols-2 gap-x-6">
                                        <div>
                                            <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">From</span>
                                            <span className="text-sm font-semibold text-slate-900">{ukDate(selectionStart)}</span>
                                        </div>
                                        <div>
                                            <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">To</span>
                                            <span className="text-sm font-semibold text-slate-900">{ukDate(selectionEnd || selectionStart)}</span>
                                        </div>
                                    </div>
                                    <button type="button" onClick={closePanel} aria-label="Close"><X className="w-4 h-4 text-slate-400" /></button>
                                </div>

                                <div className="flex items-center justify-between mb-4 p-3 border rounded-xl">
                                    <span className="text-sm font-medium text-slate-800">
                                        Block these dates <span className="font-normal text-slate-400">({rangeLabel(selectionStart, selectionEnd)})</span>
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setPanelBlocked(!panelBlocked)}
                                        className={`w-11 h-6 rounded-full relative transition ${panelBlocked ? 'bg-slate-900' : 'bg-slate-300'}`}
                                    >
                                        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${panelBlocked ? 'left-5' : 'left-0.5'}`} />
                                    </button>
                                </div>

                                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">
                                    Nightly price <span className="normal-case font-medium text-slate-400">({rangeLabel(selectionStart, selectionEnd)})</span>
                                </label>
                                <input
                                    type="number"
                                    value={panelPrice}
                                    onChange={(e) => setPanelPrice(e.target.value)}
                                    placeholder={`Default: £${selectedListing?.price_per_night}`}
                                    className="w-full p-2.5 border rounded-lg text-sm mb-4"
                                />

                                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">
                                    Minimum stay <span className="normal-case font-medium text-slate-400">({rangeLabel(selectionStart, selectionEnd)})</span>
                                </label>
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

                    {rightTab === 'pricing' && mayEditSelected && (
                        <div className="border rounded-2xl p-5 space-y-5">
                            {pricingDirty && (
                                <UnsavedNote extra="Until then your saved prices still apply." />
                            )}
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
                                disabled={savingSettings || !pricingDirty}
                                onClick={() => saveListingSettings({
                                    price_per_night: Number(basePrice) || 0,
                                    weekend_price: weekendPrice ? Number(weekendPrice) : null,
                                })}
                                className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl transition disabled:opacity-50"
                            >
                                {savingSettings ? 'Saving...' : pricingDirty ? 'Save' : 'Saved'}
                            </button>
                        </div>
                    )}

                    {rightTab === 'fees' && mayEditSelected && (
                        <div className="border rounded-2xl p-5 space-y-5">
                            {feesDirty && (
                                <UnsavedNote extra="Until then your saved fees still apply." />
                            )}
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
                                disabled={savingSettings || !feesDirty}
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
                                {savingSettings ? 'Saving...' : feesDirty ? 'Save' : 'Saved'}
                            </button>
                        </div>
                    )}

                    {rightTab === 'availability' && mayEditSelected && (
                        <div className="border rounded-2xl p-5 space-y-5">
                            {availabilityDirty && (
                                <UnsavedNote extra="Until then your stored settings (including the minimum nights guests can book) still apply." />
                            )}
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
                                disabled={savingSettings || !availabilityDirty}
                                onClick={() => saveListingSettings({
                                    min_nights: Math.max(1, Number(minNightsGlobal) || 1),
                                    max_nights: maxNightsGlobal ? Number(maxNightsGlobal) : null,
                                    advance_notice: advanceNotice,
                                    preparation_time: preparationTime,
                                    availability_window: availabilityWindow,
                                })}
                                className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl transition disabled:opacity-50"
                            >
                                {savingSettings ? 'Saving...' : availabilityDirty ? 'Save' : 'Saved'}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
