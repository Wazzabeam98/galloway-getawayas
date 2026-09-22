'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'react-toastify';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import Env from '@/config/Env';
import { getImageUrl, generateRandomNumber } from '@/lib/utils';
import { compressImage } from '@/lib/compressImage';
import { GUEST_REGIONS, GUEST_COVERAGE_ALL_KEY } from '@/lib/strings';
import { childrenAllowed } from '@/lib/guestAges';
import { stepHeadings } from '@/lib/experienceSteps';
import { slotAsksWhereFork, ACCESSIBILITY_OPTIONS, PARKING_OPTIONS, EXPERIENCE_CANCELLATION_OPTIONS, experienceCancellationOption, EXPERIENCE_AMENITY_GROUPS } from '@/lib/serviceProviders';
import { PhotoEditorGrid } from './PhotoEditorGrid';
import { OptionPills, Stepper, SESSION_LENGTH_OPTIONS, minutesLabel } from './editorControls';
import {
    FileText, User, Info, Salad, Image as ImageIcon,
    ShoppingBag, MapPin, CalendarRange, CalendarClock, Sparkles, RotateCcw,
    Eye, EyeOff, ExternalLink, Check,
} from 'lucide-react';

// The guest-experience listing editor. A card list of sections; each opens,
// edits and SAVES ON ITS OWN (its own button, its own POST), so changing a price
// never means re-running twelve screens. Approval is one-time — an approved
// provider edits freely, changes go live immediately, there is no pending state
// and no re-review.
//
// This first cut wires the text / guest_details sections and the take-down
// toggle end to end. Photos, the menu, where-it-happens and the weekly
// availability template are their own sections (heavier — image upload, the
// hours grid) and land next; they are shown as "coming" so the shape is honest
// rather than hidden.

export interface EditorProvider {
    id: string; shape: string; isSlot: boolean; isFood: boolean;
    business_name: string; category_label: string; category: string; description: string;
    status: string; owner_paused: boolean;
    photos: string[]; headshot: string | null; logo: string | null;
    dietary_note: string; fulfilment: string;
    collection_street: string; collection_town: string; collection_postcode: string;
    slot_length_minutes: number | null; slot_turnaround_minutes: number;
    slot_capacity: number | null; slot_min_people: number; max_guests: number | null;
    lead_time_days: number; cancellation_window_hours: number; booking_horizon_days: number;
    offered_times: string[];
    professional_title: string; years_experience: string; qualifications: string; recognition: string;
    what_to_expect: string; itinerary: Array<{ title?: string | null; detail?: string | null }>;
    min_age: number | null; activity_level: string; what_to_bring: string;
    accessibility: string; parking: string; no_refund: boolean;
    amenities: string[];
    dietary_options: string[];
    areas: string[];
    items: Array<{ id: string; name: string; description: string; price: number; unit: string; image: string | null; duration_minutes: number | null; fulfilment: string | null; active: boolean; capacity: number | null; min_people: number | null; included_guests?: number | null; extra_adult_fee?: number | null; extra_child_fee?: number | null; max_party?: number | null; is_custom?: boolean }>;
    availability: Array<{ day_of_week: number; open_time: string; close_time: string }>;
}

type SectionKey = 'title' | 'about' | 'happens' | 'things' | 'amenities' | 'dietary' | 'photos' | 'menu' | 'where' | 'booking' | 'availability' | 'cancellation' | 'status';

const BUILT: Record<string, boolean> = { title: true, about: true, photos: true, menu: true, happens: true, things: true, amenities: true, dietary: true, where: true, booking: true, availability: true, cancellation: true, status: true };

// How far ahead a guest can book — a pick from sensible windows rather than a
// number box (Airbnb's booking-window control). Stored as days.
const BOOKING_HORIZON_OPTIONS: { days: number; label: string }[] = [
    { days: 30, label: '30 days' },
    { days: 60, label: '60 days' },
    { days: 90, label: '3 months' },
    { days: 180, label: '6 months' },
    { days: 365, label: 'A year' },
];

// How much notice a guest must give — a pick, not a typed number.
const LEAD_TIME_OPTIONS: { days: number; label: string }[] = [
    { days: 0, label: 'Same day' },
    { days: 1, label: '1 day' },
    { days: 2, label: '2 days' },
    { days: 3, label: '3 days' },
    { days: 7, label: '1 week' },
];

// The gap between sessions — common picks, in minutes. (Session length and the
// pill/stepper controls are shared with the scheduler via ./editorControls.)
const TURNAROUND_OPTIONS = [0, 15, 30, 45, 60];

async function saveSection(providerId: string, section: string, data: any): Promise<boolean> {
    const res = await fetch('/api/services/listing/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, section, data }),
    });
    const json = await res.json().catch(() => ({ ok: false, error: 'Could not save' }));
    if (!json.ok) { toast.error(json.error || 'Could not save', { theme: 'colored' }); return false; }
    toast.success('Saved.', { theme: 'colored' });
    return true;
}

// One section shell: header, the fields (children), and its own Save button.
// `disabled` blocks the save while a hard requirement isn't met (e.g. the photo
// minimum) — the button explains why rather than saving something invalid.
function SectionCard({ title, hint, children, onSave, saving, disabled, disabledLabel }: {
    title: string; hint?: string; children: React.ReactNode; onSave: () => void; saving: boolean;
    disabled?: boolean; disabledLabel?: string;
}) {
    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
            <h2 className="text-xl font-bold text-slate-900">{title}</h2>
            {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
            <div className="mt-4 space-y-4">{children}</div>
            <button type="button" onClick={onSave} disabled={saving || disabled}
                className="mt-5 rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60">
                {saving ? 'Saving…' : (disabled && disabledLabel) ? disabledLabel : 'Save'}
            </button>
        </section>
    );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
            <div className="mt-1">{children}</div>
            {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
        </label>
    );
}

const inputCls = 'w-full rounded-xl border border-slate-300 p-3 text-sm';

export default function ProviderListingEditor({ provider }: { provider: EditorProvider }) {
    const [p] = useState(provider);
    const [active, setActive] = useState<SectionKey>('title');
    const [savingKey, setSavingKey] = useState<string>('');
    const [paused, setPaused] = useState(provider.owner_paused);
    const [pausing, setPausing] = useState(false);

    // Section field state
    const [businessName, setBusinessName] = useState(p.business_name);
    const [profTitle, setProfTitle] = useState(p.professional_title);
    const [years, setYears] = useState(p.years_experience);
    const [quals, setQuals] = useState(p.qualifications);
    const [recognition, setRecognition] = useState(p.recognition);
    const [whatToExpect, setWhatToExpect] = useState(p.what_to_expect);
    // What happens is an ordered arrival → during → finish flow (Airbnb's "What
    // you'll do"), not a bare paragraph or empty step rows. Stored as the itinerary
    // array, keyed by phase title; a phase with no detail simply isn't saved.
    // Read by POSITION, not title: the three phases are the generic Arrival /
    // During / Finish (or, for made-to-order, the real Order / Made / Collection-
    // or-Delivery steps), so what the phase is called is decided by the shape, not
    // stored per-category. The provider writes only the detail under each.
    const phaseDetail = (i: number) => (p.itinerary[i]?.detail) || '';
    const [arrival, setArrival] = useState(phaseDetail(0));
    const [during, setDuring] = useState(phaseDetail(1));
    const [finish, setFinish] = useState(phaseDetail(2));
    const [minAge, setMinAge] = useState(p.min_age != null ? String(p.min_age) : '');
    const [activity, setActivity] = useState(p.activity_level);
    const [whatToBring, setWhatToBring] = useState(p.what_to_bring);
    const [accessibility, setAccessibility] = useState(p.accessibility);
    const [parking, setParking] = useState(p.parking);
    // What's included, as ticks — the same keys render the "What's included" list
    // on the guest listing, so a provider picks rather than writes prose.
    const [amenities, setAmenities] = useState<string[]>(p.amenities || []);
    const toggleAmenity = (key: string) => setAmenities((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
    // Cancellation as a named policy (shared by every shape). noRefund is the
    // non-refundable option; cancelHours (declared with the slot fields below)
    // holds the window preset for the refundable ones.
    const [noRefund, setNoRefund] = useState(p.no_refund);
    const [dietaryNote, setDietaryNote] = useState(p.dietary_note);

    // Availability (slot providers): the weekly template. Seven rows, Sun..Sat,
    // each on/off with an open and close time — the single home for weekly hours
    // now they've left the wizard. Dated days-off and part-day blocks stay in the
    // diary.
    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const [hours, setHours] = useState(() => DAY_NAMES.map((_, d) => {
        const row = p.availability.find((a) => a.day_of_week === d);
        return { on: !!row, open: row?.open_time || '09:00', close: row?.close_time || '17:00' };
    }));
    const [slotLength, setSlotLength] = useState(p.slot_length_minutes != null ? Number(p.slot_length_minutes) : 60);
    const [turnaround, setTurnaround] = useState(Number(p.slot_turnaround_minutes || 0));
    const [leadDays, setLeadDays] = useState(Math.max(0, Number(p.lead_time_days || 0)));
    const [cancelHours, setCancelHours] = useState(Number(p.cancellation_window_hours ?? 48));
    const [horizonDays, setHorizonDays] = useState(Math.max(1, Number(p.booking_horizon_days || 90)));
    const cancelPolicy = experienceCancellationOption(Number(cancelHours), noRefund);
    // A request shape's booking times used to be a free "offered times" list;
    // comes-to-you now generates them from its weekly opening hours (the
    // Availability/Opening-hours section) and made-to-order is a date only, so
    // there is no offered-times control here any more.

    // Max group size — the largest booking. A slot's is slot_capacity (it sizes
    // sellable seats); every other shape keeps it in guest_details.max_guests. One
    // control, reachable by every shape (a chef and a whole-session sauna both had
    // nowhere to set it). Defaults to a realistic group so it is never blank.
    const initialMaxGroup = p.isSlot ? p.slot_capacity : p.max_guests;
    const [maxGuests, setMaxGuests] = useState<number>(
        initialMaxGroup && initialMaxGroup > 0 ? initialMaxGroup : (p.isSlot ? 8 : 6));


    // Photos: gallery keys (storage paths), plus the headshot and logo. Uploaded
    // to the bucket immediately (like the wizard), so the section saves keys.
    const supabase = createClientComponentClient();
    const [photos, setPhotos] = useState<string[]>(p.photos);
    const [headshot, setHeadshot] = useState<string | null>(p.headshot);
    const [logo, setLogo] = useState<string | null>(p.logo);
    const [uploading, setUploading] = useState(false);

    async function uploadOne(file: File, prefix: string): Promise<string | null> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { toast.error('Please sign in again.', { theme: 'colored' }); return null; }
        try {
            const ready = await compressImage(file);
            const path = 'providers/' + prefix + '-' + user.id + '-' + Date.now() + '-' + generateRandomNumber() + '.jpg';
            const { error } = await supabase.storage.from(Env.S3_BUCKET).upload(path, ready, { contentType: 'image/jpeg' });
            if (error) { toast.error(error.message, { theme: 'colored' }); return null; }
            return path;
        } catch {
            toast.error('That image couldn’t be read. Try a different one.', { theme: 'colored' });
            return null;
        }
    }

    async function addGalleryPhotos(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        if (!files.length) return;
        setUploading(true);
        const keys: string[] = [];
        for (const f of files) { const k = await uploadOne(f, 'photo'); if (k) keys.push(k); }
        if (keys.length) setPhotos((prev) => [...prev, ...keys]);
        setUploading(false);
    }

    async function changeHeadshot(e: React.ChangeEvent<HTMLInputElement>) {
        const file = (e.target.files || [])[0];
        e.target.value = '';
        if (!file) return;
        setUploading(true);
        const k = await uploadOne(file, 'headshot');
        if (k) setHeadshot(k);
        setUploading(false);
    }

    // The menu. Each row edits in place; prices are strings while typing. New rows
    // have no id (the save route inserts them); removed rows drop out (the route
    // deletes them). ids are preserved so an item keeps its photo and bookings.
    type MenuRow = { id?: string; name: string; description: string; price: string; unit: string; image: string | null; duration: string; fulfilment: string | null; active: boolean; capacity: string; includedGuests: string; extraAdultFee: string; extraChildFee: string; maxParty: string; isCustom: boolean };
    const [menu, setMenu] = useState<MenuRow[]>(p.items.map((it) => ({
        id: it.id, name: it.name, description: it.description, price: String(it.price),
        unit: it.unit, image: it.image, duration: it.duration_minutes != null ? String(it.duration_minutes) : '',
        fulfilment: it.fulfilment, active: it.active,
        // Blank = inherit the provider default; a number here overrides it for this item.
        capacity: it.capacity != null ? String(it.capacity) : '',
        // Extra-guests pricing (flat items). Blank = a plain flat price.
        includedGuests: (it as any).included_guests != null ? String((it as any).included_guests) : '',
        extraAdultFee: (it as any).extra_adult_fee != null ? String((it as any).extra_adult_fee) : '',
        extraChildFee: (it as any).extra_child_fee != null ? String((it as any).extra_child_fee) : '',
        maxParty: (it as any).max_party != null ? String((it as any).max_party) : '',
        // Made-to-order: standard (instant) vs custom (a request the provider agrees).
        isCustom: !!(it as any).is_custom,
    })));
    const setRow = (i: number, patch: Partial<MenuRow>) => setMenu(menu.map((r, j) => j === i ? { ...r, ...patch } : r));

    // Seats and a minimum-to-run only mean anything when something is sold PER
    // PERSON — a whole-session (private) price is one booking at one price
    // whoever turns up, so "how many can it hold" and "smallest group to run"
    // are noise on a sauna. Shown only when an active item is priced per person.
    // (Capacity/min moved onto the item in feat/per-item-capacity; this reads
    // the same per-person signal at the provider level until the per-item write
    // UI lands.)
    const hasPerPersonItem = menu.some((r) => r.active && r.unit === 'person');

    async function changeItemImage(i: number, e: React.ChangeEvent<HTMLInputElement>) {
        const file = (e.target.files || [])[0];
        e.target.value = '';
        if (!file) return;
        setUploading(true);
        const k = await uploadOne(file, 'item');
        if (k) setRow(i, { image: k });
        setUploading(false);
    }

    // Where it happens: how a guest reaches the experience, the private venue
    // address (a guest only ever sees the town), and the regions a travelling
    // provider covers.
    // Whether this experience can travel to the guest. A slot that is fixed by
    // nature — a sauna, a tasting, a guided walk — happens in one place; only
    // the yoga/massage/painting kind genuinely goes either way (the same call
    // the sign-up wizard makes, slotAsksWhereFork). 'other' and any as-yet-
    // unknown category keep every option rather than be guessed fixed. A fixed
    // category is pinned to come-to-me and never offered travel.
    const fixedInPlace = p.isSlot && !!p.category && p.category !== 'other' && !slotAsksWhereFork(p.category);
    const canTravel = !fixedInPlace;
    const [fulfilment, setFulfilment] = useState(fixedInPlace ? 'collection' : (p.fulfilment || 'collection'));
    const [street, setStreet] = useState(p.collection_street);
    const [town, setTown] = useState(p.collection_town);
    const [postcode, setPostcode] = useState(p.collection_postcode);
    const [areas, setAreas] = useState<string[]>(p.areas);
    const collects = fulfilment === 'collection' || fulfilment === 'both';
    const travels = fulfilment === 'delivery' || fulfilment === 'both';

    // Coverage is a fixed pick-list of D&G regions (never free text). "All of
    // Dumfries & Galloway" is exclusive with the individual regions — the same
    // rule the wizard's picker uses.
    const ALL_REGION_LABEL = GUEST_REGIONS.find((r) => r.key === GUEST_COVERAGE_ALL_KEY)!.label;
    const toggleRegion = (label: string, isAll: boolean) => {
        if (isAll) { setAreas(areas.includes(ALL_REGION_LABEL) ? [] : [ALL_REGION_LABEL]); return; }
        const withoutAll = areas.filter((a) => a !== ALL_REGION_LABEL);
        setAreas(withoutAll.includes(label) ? withoutAll.filter((a) => a !== label) : [...withoutAll, label]);
    };

    async function run(section: string, data: any) {
        setSavingKey(section);
        await saveSection(p.id, section, data);
        setSavingKey('');
    }

    async function togglePaused() {
        setPausing(true);
        const next = !paused;
        const ok = await saveSection(p.id, 'status', { owner_paused: next });
        if (ok) setPaused(next);
        setPausing(false);
    }

    // What's still empty — surfaced, never blocking, so the optional fields get
    // filled rather than sitting empty forever. Ordered by how much a guest misses
    // it.
    const missing: string[] = [];
    if (!p.headshot) missing.push('a photo of yourself');
    if (!p.photos.length) missing.push('photos of the experience');
    if (!p.what_to_expect.trim()) missing.push('what happens');
    if (!p.itinerary.length) missing.push('an itinerary');
    if (!p.what_to_bring.trim()) missing.push('what to bring');
    if (p.min_age == null) missing.push('a minimum age');
    if (!p.activity_level.trim()) missing.push('the activity level');

    const SECTIONS: { key: SectionKey; label: string; icon: any }[] = [
        // Grouped as a provider thinks: identity (who/where) → content (photos,
        // offerings, the experience) → operations (availability, status). Where it
        // happens sits high — Airbnb asks location early, and the menu's per-item
        // location depends on the come-to-me/travel/both choice being set first.
        { key: 'title', label: 'Title', icon: FileText },
        { key: 'about', label: 'About you', icon: User },
        // A fixed venue (guests always come to one place) has an Address, not a
        // where-do-you-work choice — there's no travel fork to make.
        { key: 'where', label: fixedInPlace ? 'Address' : 'Where it happens', icon: MapPin },
        { key: 'photos', label: 'Photos', icon: ImageIcon },
        { key: 'menu', label: 'What you offer', icon: ShoppingBag },
        { key: 'happens', label: 'What happens', icon: FileText },
        { key: 'things', label: 'Things to know', icon: Info },
        { key: 'amenities', label: 'Amenities', icon: Sparkles },
        // Food & dietary is only meaningful for a food business (chef, baker,
        // hamper) — a sauna or a guide never caters, so it doesn't see this.
        ...(p.isFood ? [{ key: 'dietary' as SectionKey, label: 'Food & dietary', icon: Salad }] : []),
        // Booking rules reach every shape. Weekly opening hours reach a slot AND a
        // comes-to-you provider — the one place a chef sets the hours they work,
        // which their booking times are generated from. A made-to-order baker is a
        // date only, so it has no hours section.
        { key: 'booking', label: 'Booking', icon: CalendarClock },
        ...((p.isSlot || p.shape === 'comes_to_you') ? [{ key: 'availability' as SectionKey, label: p.isSlot ? 'Availability' : 'Opening hours', icon: CalendarRange }] : []),
        { key: 'cancellation', label: 'Cancellation policy', icon: RotateCcw },
        { key: 'status', label: 'Listing status', icon: paused ? EyeOff : Eye },
    ];

    return (
        <div className="mx-auto w-full max-w-5xl px-5 py-8">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-extrabold text-emerald-800">Edit your listing</h1>
                    <p className="mt-1 text-sm text-slate-500">
                        Change a section and save it — no need to run through everything again.
                    </p>
                </div>
                <Link href={`/experiences/browse/${p.id}`} target="_blank"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:border-slate-500">
                    <ExternalLink className="h-4 w-4" /> View listing
                </Link>
            </div>

            {/* Only when paused: an informative strip so a hidden listing is never a
                silent surprise. The "take it down" control itself lives at the bottom,
                in the Listing status section — the editor doesn't push a live provider
                toward taking their listing down. */}
            {paused && (
                <div className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-start gap-2.5">
                            <EyeOff className="mt-0.5 h-5 w-5 text-amber-700" />
                            <div>
                                <div className="font-semibold text-slate-900">Your listing is taken down</div>
                                <p className="text-sm text-slate-600">Guests can’t find or book it. Bookings you’ve already confirmed still stand.</p>
                            </div>
                        </div>
                        <button type="button" onClick={togglePaused} disabled={pausing}
                            className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-60">
                            {pausing ? '…' : 'Put it back up'}
                        </button>
                    </div>
                </div>
            )}

            {/* Go-live gate for a slot OR comes-to-you provider with no weekly
                hours: both generate their booking times from the weekly hours, so
                with none set a guest sees no times to pick. Said loudly, with a
                jump to fix it — never a hard block. */}
            {(p.isSlot || p.shape === 'comes_to_you') && p.availability.length === 0 && !paused && (
                <div className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 p-4">
                    <div className="font-semibold text-amber-900">You’re not bookable yet — add your weekly hours</div>
                    <p className="mt-1 text-sm text-amber-900/80">
                        Guests book a time from your weekly hours. Until you set them, your listing generates no
                        times and won’t appear in the marketplace.
                    </p>
                    <button type="button" onClick={() => setActive('availability')}
                        className="mt-3 rounded-md bg-amber-700 px-3 py-2 text-sm font-medium text-white">
                        Set your hours
                    </button>
                </div>
            )}

            {/* Missing-field prompts */}
            {missing.length > 0 && (
                <div className="mb-6 rounded-2xl border border-sky-200 bg-sky-50 p-4">
                    <div className="text-sm font-semibold text-sky-900">Your listing is missing a few things</div>
                    <p className="mt-1 text-sm text-sky-800">
                        None of these stop it going live, but a fuller listing gets booked more. Still to add:{' '}
                        {missing.join(', ')}.
                    </p>
                </div>
            )}

            <div className="grid grid-cols-1 gap-8 md:grid-cols-[220px_1fr]">
                {/* Sidebar */}
                <nav className="space-y-1">
                    {SECTIONS.map(({ key, label, icon: Icon }) => (
                        <button key={key} type="button" onClick={() => setActive(key)}
                            className={`flex w-full items-center rounded-xl px-3 py-2.5 text-sm font-medium transition ${active === key ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}>
                            <Icon className="mr-3 h-4 w-4" /> {label}
                            {!BUILT[key] && <span className="ml-auto text-[10px] font-semibold uppercase text-slate-400">soon</span>}
                        </button>
                    ))}
                </nav>

                {/* Content */}
                <div className="space-y-6">
                    {active === 'title' && (
                        <SectionCard title="Title" hint="The name at the top of your listing." saving={savingKey === 'title'}
                            onSave={() => run('title', { business_name: businessName })}>
                            <Field label="Listing title">
                                <input className={inputCls} value={businessName} onChange={(e) => setBusinessName(e.target.value)} maxLength={80} />
                            </Field>
                        </SectionCard>
                    )}

                    {active === 'about' && (
                        <SectionCard title="About you" hint="You, and why a guest can trust you — shown beneath your listing name." saving={savingKey === 'about'}
                            onSave={() => run('about', { professional_title: profTitle, years_experience: years, qualifications: quals, recognition, headshot })}>
                            <div>
                                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Your photo</span>
                                <p className="mt-0.5 text-xs text-slate-400">The person a guest is meeting — shown beside your name.</p>
                                <div className="mt-2 flex items-center gap-3">
                                    {headshot ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={getImageUrl(headshot)} alt="" className="h-16 w-16 rounded-full object-cover ring-1 ring-slate-200" />
                                    ) : (
                                        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400"><User className="h-6 w-6" /></span>
                                    )}
                                    <label className="cursor-pointer rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-500">
                                        {headshot ? 'Replace' : 'Add a photo'}
                                        <input type="file" accept="image/png, image/jpeg" onChange={changeHeadshot} className="hidden" disabled={uploading} />
                                    </label>
                                    {headshot && <button type="button" onClick={() => setHeadshot(null)} className="text-sm text-slate-500 hover:text-red-600">Remove</button>}
                                </div>
                            </div>
                            <Field label="Professional title"><input className={inputCls} value={profTitle} onChange={(e) => setProfTitle(e.target.value)} /></Field>
                            <Field label="Years of experience"><input className={inputCls} value={years} onChange={(e) => setYears(e.target.value)} placeholder="5" /></Field>
                            <Field label="Qualifications"><textarea className={inputCls} rows={2} value={quals} onChange={(e) => setQuals(e.target.value)} /></Field>
                            <Field label="Recognition (optional)"><textarea className={inputCls} rows={2} value={recognition} onChange={(e) => setRecognition(e.target.value)} /></Field>
                        </SectionCard>
                    )}

                    {active === 'happens' && (
                        <SectionCard title="What happens" hint="A line on what it is, then walk a guest through it start to finish." saving={savingKey === 'happens'}
                            onSave={() => run('happens', {
                                what_to_expect: whatToExpect,
                                itinerary: stepHeadings(p.shape, fulfilment).map((h, i) => ({ title: h.title, detail: [arrival, during, finish][i] })),
                            })}>
                            <Field label="In a sentence, what is it?">
                                <textarea className={inputCls} rows={3} value={whatToExpect} onChange={(e) => setWhatToExpect(e.target.value)} placeholder="A wood-fired lakeside sauna with cold-water dips between rounds." />
                            </Field>
                            <div>
                                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">The flow</span>
                                <p className="mt-0.5 text-xs text-slate-400">Take a guest through it, start to finish. Leave a step blank to skip it.</p>
                                <div className="mt-3 space-y-3">
                                    {stepHeadings(p.shape, fulfilment).map((h, idx) => ([
                                        { n: 1, label: h.title, value: arrival, set: setArrival, ph: 'Where to meet, how to find you, what to expect first.' },
                                        { n: 2, label: h.title, value: during, set: setDuring, ph: 'The heart of it — what you’ll actually do together.' },
                                        { n: 3, label: h.title, value: finish, set: setFinish, ph: 'How it wraps up — and anything to do after.' },
                                    ][idx])).map((s) => (
                                        <div key={s.label} className="flex gap-3">
                                            <div className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-emerald-700 text-xs font-bold text-white">{s.n}</div>
                                            <div className="flex-1">
                                                <div className="text-sm font-semibold text-slate-900">{s.label}</div>
                                                <textarea className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm" rows={2} value={s.value} onChange={(e) => s.set(e.target.value)} placeholder={s.ph} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </SectionCard>
                    )}

                    {active === 'things' && (
                        <SectionCard title="Things to know" hint="A few practical facts a guest wants before booking." saving={savingKey === 'things'}
                            onSave={() => run('things', { min_age: minAge, activity_level: activity, what_to_bring: whatToBring })}>
                            <Field label="Minimum age" hint="The youngest a guest can be to take part.">
                                <OptionPills
                                    options={[
                                        { value: '', label: 'No minimum' },
                                        { value: '12', label: '12+' },
                                        { value: '16', label: '16+' },
                                        { value: '18', label: '18+' },
                                        { value: '21', label: '21+' },
                                    ]}
                                    value={minAge}
                                    onChange={(v) => setMinAge(v)}
                                />
                            </Field>
                            <Field label="Activity level">
                                <OptionPills
                                    options={[
                                        { value: 'gentle', label: 'Gentle' },
                                        { value: 'moderate', label: 'Moderate' },
                                        { value: 'challenging', label: 'Challenging' },
                                    ]}
                                    value={activity}
                                    onChange={(v) => setActivity(activity === v ? '' : v)}
                                />
                            </Field>
                            <Field label="What to bring"><textarea className={inputCls} rows={3} value={whatToBring} onChange={(e) => setWhatToBring(e.target.value)} placeholder="Warm layers, sturdy shoes…" /></Field>
                        </SectionCard>
                    )}

                    {active === 'amenities' && (
                        <SectionCard title="Amenities" hint="What guests can count on when they arrive. Everything you tick shows as a “What’s included” list on your listing." saving={savingKey === 'amenities'}
                            onSave={() => run('amenities', { accessibility, parking, amenities })}>
                            {/* What's included — a multi-select tick-list. A provider
                                ticks rather than writing prose, and the same keys drive
                                the guest listing's "What's included" section. */}
                            {EXPERIENCE_AMENITY_GROUPS.map((grp) => (
                                <div key={grp.group}>
                                    <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{grp.group}</span>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {grp.items.map((a) => {
                                            const on = amenities.includes(a.key);
                                            return (
                                                <button key={a.key} type="button" onClick={() => toggleAmenity(a.key)}
                                                    aria-pressed={on}
                                                    className={`inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm transition ${on ? 'border-emerald-700 ring-2 ring-emerald-700 bg-emerald-50 text-slate-900' : 'border-slate-300 text-slate-700 hover:border-slate-400'}`}>
                                                    {on && <Check className="h-4 w-4 flex-none text-emerald-700" />}
                                                    {a.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                            <div className="border-t border-slate-200 pt-4">
                                <Field label="Accessibility" hint="The nearest option — a guest who needs it wants a clear answer, not a paragraph.">
                                    <OptionPills
                                        options={ACCESSIBILITY_OPTIONS.map((o) => ({ value: o.key, label: o.label }))}
                                        value={accessibility}
                                        onChange={(v) => setAccessibility(accessibility === v ? '' : v)}
                                    />
                                </Field>
                            </div>
                            <Field label="Parking">
                                <OptionPills
                                    options={PARKING_OPTIONS.map((o) => ({ value: o.key, label: o.label }))}
                                    value={parking}
                                    onChange={(v) => setParking(parking === v ? '' : v)}
                                />
                            </Field>
                        </SectionCard>
                    )}

                    {active === 'dietary' && (
                        <SectionCard title="Food & dietary" hint="What you can cater for." saving={savingKey === 'dietary'}
                            onSave={() => run('dietary', { dietary_note: dietaryNote, dietary_options: p.dietary_options })}>
                            <Field label="Dietary note"><textarea className={inputCls} rows={3} value={dietaryNote} onChange={(e) => setDietaryNote(e.target.value)} placeholder="Vegetarian and gluten-free on request; not a nut-free kitchen." /></Field>
                        </SectionCard>
                    )}

                    {active === 'photos' && (
                        <SectionCard title="Photos" hint="Photos of the experience — these lead the listing. The first is the cover; drag to reorder." saving={savingKey === 'photos'}
                            disabled={photos.length < 3} disabledLabel={`Add ${3 - photos.length} more photo${3 - photos.length === 1 ? '' : 's'}`}
                            onSave={() => run('photos', { photos, logo })}>
                            {/* Photo minimum stays three (a listing shouldn't lead on
                                one weak image), but it's carried by the disabled Save
                                and its "Add N more" label — no separate count banner. */}
                            <div>
                                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Gallery</span>
                                <div className="mt-2">
                                    <PhotoEditorGrid
                                        items={photos.map((k) => ({ key: k, src: getImageUrl(k) }))}
                                        onReorder={(from, to) => setPhotos((prev) => { const n = [...prev]; const [m] = n.splice(from, 1); n.splice(to, 0, m); return n; })}
                                        onRemove={(i) => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                                        onAdd={addGalleryPhotos}
                                        uploading={uploading}
                                        addLabel="Add photos"
                                    />
                                </div>
                            </div>
                        </SectionCard>
                    )}

                    {active === 'menu' && (
                        <SectionCard title="What you offer" hint="What a guest books, with a price. A slot prices per person or as a whole session." saving={savingKey === 'menu'}
                            onSave={() => run('menu', {
                                items: menu.map((r) => ({
                                    id: r.id, name: r.name, description: r.description, price: r.price,
                                    unit: r.unit, image: r.image, duration_minutes: r.duration,
                                    fulfilment: r.fulfilment, active: r.active,
                                    capacity: r.capacity,
                                    included_guests: r.includedGuests, extra_adult_fee: r.extraAdultFee,
                                    extra_child_fee: r.extraChildFee, max_party: r.maxParty,
                                    is_custom: r.isCustom,
                                })),
                            })}>
                            {/* Last-priced-item guard: a listing with no active priced
                                item can't be booked and is dropped from the shop.
                                Warned, never blocked. */}
                            {!menu.some((r) => r.active && r.name.trim() && Number(r.price) > 0) && (
                                <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                                    <Check className="mt-0.5 h-4 w-4 flex-none" />
                                    You have no priced item. Until you add one, your listing can’t be booked and won’t appear.
                                </div>
                            )}
                            <div className="space-y-4">
                                {menu.map((r, i) => (
                                    <div key={r.id || `new-${i}`} className="rounded-xl border border-slate-200 p-4">
                                        <div className="flex items-start gap-4">
                                            <label className="group relative flex-none cursor-pointer">
                                                {r.image ? (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img src={getImageUrl(r.image)} alt="" className="h-28 w-28 rounded-2xl object-cover ring-1 ring-slate-200" />
                                                ) : (
                                                    <span className="flex h-28 w-28 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-slate-300 text-slate-400">
                                                        <ImageIcon className="h-6 w-6" />
                                                        <span className="text-xs font-medium">Add photo</span>
                                                    </span>
                                                )}
                                                {r.image && (
                                                    <span className="absolute inset-x-0 bottom-0 rounded-b-2xl bg-black/45 py-1 text-center text-[11px] font-semibold text-white opacity-0 transition group-hover:opacity-100">Change</span>
                                                )}
                                                <input type="file" accept="image/png, image/jpeg" onChange={(e) => changeItemImage(i, e)} className="hidden" disabled={uploading} />
                                            </label>
                                            <div className="flex-1 space-y-3">
                                                <input className={inputCls} placeholder="Name (e.g. 90-minute private sauna)" value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} />
                                                {/* Per-item location: only a slot provider who offers BOTH
                                                    sets it — this item at their place, or travelled to the
                                                    guest. A travelled item is a private whole-cottage hire,
                                                    so its price is per whole session (not per person). */}
                                                {p.isSlot && fulfilment === 'both' && (
                                                    <div>
                                                        <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">This one happens</span>
                                                        <div className="mt-1 flex gap-2">
                                                            <button type="button" onClick={() => setRow(i, { fulfilment: 'collection' })}
                                                                className={`rounded-xl border px-3 py-2 text-sm transition ${(r.fulfilment || 'collection') === 'collection' ? 'border-emerald-700 bg-emerald-50 text-slate-900' : 'border-slate-300 text-slate-700 hover:border-slate-400'}`}>
                                                                At my place
                                                            </button>
                                                            <button type="button" onClick={() => setRow(i, { fulfilment: 'delivery', unit: 'flat' })}
                                                                className={`rounded-xl border px-3 py-2 text-sm transition ${r.fulfilment === 'delivery' ? 'border-emerald-700 bg-emerald-50 text-slate-900' : 'border-slate-300 text-slate-700 hover:border-slate-400'}`}>
                                                                I travel to them
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                                <div className="flex flex-wrap gap-3">
                                                    {/* A plain pound input — no 1p spinner. Text with a
                                                        decimal keypad on mobile; sanitised to digits and one dot. */}
                                                    <label className="flex items-center gap-1 rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus-within:border-slate-500">
                                                        <span className="text-slate-500">£</span>
                                                        <input className="w-20 border-0 bg-transparent p-0 text-sm outline-none" type="text" inputMode="decimal" placeholder="0"
                                                            value={r.price} onChange={(e) => setRow(i, { price: e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1') })} />
                                                    </label>
                                                    {p.isSlot && fulfilment === 'both' && r.fulfilment === 'delivery' ? (
                                                        <span className="flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500">Whole session — private, you travel</span>
                                                    ) : (
                                                        <select className="rounded-xl border border-slate-300 p-2.5 text-sm" value={r.unit} onChange={(e) => setRow(i, { unit: e.target.value })}>
                                                            <option value="flat">whole session</option>
                                                            <option value="person">per person</option>
                                                            {!p.isSlot && <option value="hour">per hour</option>}
                                                            {!p.isSlot && <option value="night">per night</option>}
                                                            {!p.isSlot && <option value="ticket">per ticket</option>}
                                                            {!p.isSlot && <option value="item">per item</option>}
                                                        </select>
                                                    )}
                                                    {p.isSlot && (
                                                        <label className="flex items-center gap-1 text-sm text-slate-500">
                                                            {/* Minutes, in quarter-hour steps — nothing runs for 17 minutes, and a 1-minute step invited exactly that. */}
                                                            <input className="w-20 rounded-xl border border-slate-300 p-2.5 text-sm" type="number" min={15} step={15} placeholder="mins" value={r.duration} onChange={(e) => setRow(i, { duration: e.target.value })} />
                                                            <span>min</span>
                                                        </label>
                                                    )}
                                                </div>
                                                {/* Per-item capacity — only for a per-person item on a
                                                    slot. Each priced-per-person item sets how many it
                                                    holds; blank inherits the Booking default, so two
                                                    items no longer share one number that means different
                                                    things. No minimum-per-booking: a shared session's
                                                    whole point is that individuals can attend, so there
                                                    is no floor — a provider who won't take one person is
                                                    describing the whole-session (private) item instead. */}
                                                {p.isSlot && r.unit === 'person' && (
                                                    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-3">
                                                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Capacity</span>
                                                        <span className="flex items-center gap-1">
                                                            <input className="w-20 rounded-lg border border-slate-300 p-2 text-sm" type="number" min={1} placeholder={String(maxGuests)} value={r.capacity} onChange={(e) => setRow(i, { capacity: e.target.value })} />
                                                            <span className="text-slate-500 text-sm">people</span>
                                                        </span>
                                                        <span className="w-full text-xs text-slate-400">Blank uses your default of {maxGuests}.</span>
                                                    </div>
                                                )}
                                                {/* Extra guests — a group price that grows with the
                                                    party. Only for a flat (whole-session) item; blank
                                                    leaves a plain flat price. The child fee only shows
                                                    where the minimum age admits children, and the price
                                                    never drops below the base. */}
                                                {r.unit === 'flat' && (
                                                    <div className="space-y-2 rounded-xl bg-slate-50 p-3">
                                                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Extra guests (optional)</span>
                                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-600">
                                                            <label className="flex items-center gap-1">Includes
                                                                <input className="w-16 rounded-lg border border-slate-300 p-2 text-sm" type="number" min={1} placeholder="—" value={r.includedGuests} onChange={(e) => setRow(i, { includedGuests: e.target.value })} /> guests</label>
                                                            <label className="flex items-center gap-1">+£
                                                                <input className="w-16 rounded-lg border border-slate-300 p-2 text-sm" type="text" inputMode="decimal" placeholder="0" value={r.extraAdultFee} onChange={(e) => setRow(i, { extraAdultFee: e.target.value.replace(/[^0-9.]/g, '') })} /> per extra adult</label>
                                                            {childrenAllowed(Number(minAge) || null) && (
                                                                <label className="flex items-center gap-1">+£
                                                                    <input className="w-16 rounded-lg border border-slate-300 p-2 text-sm" type="text" inputMode="decimal" placeholder="0" value={r.extraChildFee} onChange={(e) => setRow(i, { extraChildFee: e.target.value.replace(/[^0-9.]/g, '') })} /> per extra child</label>
                                                            )}
                                                            <label className="flex items-center gap-1">Max party
                                                                <input className="w-16 rounded-lg border border-slate-300 p-2 text-sm" type="number" min={1} placeholder="—" value={r.maxParty} onChange={(e) => setRow(i, { maxParty: e.target.value })} /></label>
                                                        </div>
                                                        <span className="block text-xs text-slate-400">Leave blank for one flat price. The price never drops below the base.</span>
                                                    </div>
                                                )}
                                                {/* Made-to-order: standard books and charges instantly;
                                                    custom needs your say-so, so any order with a custom
                                                    item is held as a request until you accept. */}
                                                {p.shape === 'made_to_order' && (
                                                    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3">
                                                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">This item is</span>
                                                        <button type="button" onClick={() => setRow(i, { isCustom: false })}
                                                            className={`rounded-full border px-3 py-1.5 text-sm transition ${!r.isCustom ? 'border-emerald-700 bg-emerald-50 text-slate-900' : 'border-slate-300 text-slate-600 hover:border-slate-400'}`}>Standard — books instantly</button>
                                                        <button type="button" onClick={() => setRow(i, { isCustom: true })}
                                                            className={`rounded-full border px-3 py-1.5 text-sm transition ${r.isCustom ? 'border-emerald-700 bg-emerald-50 text-slate-900' : 'border-slate-300 text-slate-600 hover:border-slate-400'}`}>Custom — you approve first</button>
                                                    </div>
                                                )}
                                                <textarea className={inputCls} rows={2} placeholder="Description (optional)" value={r.description} onChange={(e) => setRow(i, { description: e.target.value })} />
                                            </div>
                                        </div>
                                        <div className="mt-3 flex items-center justify-between">
                                            <button type="button" onClick={() => setRow(i, { active: !r.active })}
                                                className={`text-xs font-semibold ${r.active ? 'text-emerald-700' : 'text-slate-400'}`}>
                                                {r.active ? 'Active' : 'Hidden'}
                                            </button>
                                            <button type="button" onClick={() => setMenu(menu.filter((_, j) => j !== i))} className="text-xs text-slate-500 hover:text-red-600">Remove</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <button type="button" onClick={() => setMenu([...menu, { name: '', description: '', price: '', unit: 'flat', image: null, duration: p.isSlot ? '60' : '', fulfilment: (p.isSlot && fulfilment === 'both') ? 'collection' : null, active: true, capacity: '', includedGuests: '', extraAdultFee: '', extraChildFee: '', maxParty: '', isCustom: false }])}
                                className="text-sm font-semibold text-emerald-700 hover:text-emerald-800">+ Add an item</button>
                        </SectionCard>
                    )}

                    {active === 'where' && (
                        <SectionCard title={fixedInPlace ? 'Address' : 'Where it happens'} hint="How guests reach you. They only ever see the town — the street and postcode stay private until a booking is confirmed." saving={savingKey === 'where'}
                            onSave={() => run('where', {
                                fulfilment,
                                collection_street: street, collection_town: town, collection_postcode: postcode,
                                areas: travels ? areas : [],
                            })}>
                            {canTravel ? (
                                <Field label="How guests get it">
                                    <div className="space-y-2">
                                        {[
                                            { key: 'collection', label: 'Guests come to me', note: 'At your studio, sauna, kitchen — one place.' },
                                            { key: 'delivery', label: 'I travel to the guest', note: 'You go to their cottage.' },
                                            { key: 'both', label: 'Both', note: 'Guests can come to you, or you travel to them.' },
                                        ].map((o) => (
                                            <button key={o.key} type="button" onClick={() => setFulfilment(o.key)}
                                                className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition ${fulfilment === o.key ? 'border-emerald-700 ring-2 ring-emerald-700 bg-emerald-50' : 'border-slate-300 hover:border-slate-400'}`}>
                                                <div className="font-semibold text-slate-900">{o.label}</div>
                                                <div className="text-xs text-slate-500">{o.note}</div>
                                            </button>
                                        ))}
                                    </div>
                                </Field>
                            ) : (
                                // Fixed by nature — it happens in one place, so there is no
                                // travel choice to make. Just the address below.
                                <p className="text-sm text-slate-600">Guests come to you — this kind of experience happens in one place.</p>
                            )}

                            {collects && (
                                <div className="space-y-3">
                                    <Field label="Street address (private)"><input className={inputCls} value={street} onChange={(e) => setStreet(e.target.value)} placeholder="e.g. 18 Dovecroft" /></Field>
                                    <div className="grid grid-cols-2 gap-3">
                                        <Field label="Town (shown to guests)"><input className={inputCls} value={town} onChange={(e) => setTown(e.target.value)} placeholder="Kirkcudbright" /></Field>
                                        <Field label="Postcode (private)"><input className={inputCls} value={postcode} onChange={(e) => setPostcode(e.target.value)} placeholder="DG6 4JS" /></Field>
                                    </div>
                                    <p className="text-xs text-slate-500">Guests see <span className="font-medium text-slate-700">{town.trim() || 'your town'}</span>. The street and postcode are released only when a booking is confirmed.</p>
                                </div>
                            )}

                            {travels && (
                                <div>
                                    <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Regions you travel to</span>
                                    <p className="mt-0.5 text-xs text-slate-400">Pick the parts of Dumfries &amp; Galloway you’ll come to.</p>
                                    <div className="mt-2 space-y-2">
                                        {GUEST_REGIONS.map((rg) => {
                                            const isAll = rg.key === GUEST_COVERAGE_ALL_KEY;
                                            const on = areas.includes(rg.label);
                                            return (
                                                <button key={rg.key} type="button" onClick={() => toggleRegion(rg.label, isAll)}
                                                    className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm transition ${on ? 'border-emerald-700 ring-2 ring-emerald-700 bg-emerald-50' : 'border-slate-300 hover:border-slate-400'}`}>
                                                    <span>
                                                        <span className="block font-semibold text-slate-900">{rg.label}</span>
                                                        <span className="block text-xs text-slate-500">{rg.hint}</span>
                                                    </span>
                                                    {on && <Check className="h-4 w-4 flex-none text-emerald-700" />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </SectionCard>
                    )}

                    {active === 'booking' && (
                        <SectionCard title="Booking" hint="How guests book with you — the rules that apply however your listing is booked." saving={savingKey === 'booking'}
                            onSave={() => run('booking', { max_guests: maxGuests, lead_time_days: leadDays, booking_horizon_days: horizonDays })}>
                            <Field label="Maximum capacity" hint={p.isSlot ? 'The most people a session can take, as a default — a per-person item can set its own in “What you offer”.' : 'The most people you’ll take for one booking.'}>
                                <Stepper value={maxGuests} onChange={setMaxGuests} min={1} max={60} />
                            </Field>
                            {/* A slot or comes-to-you provider sets its notice period
                                beside the opening hours; made-to-order has no hours
                                section, so it keeps it here. */}
                            {!p.isSlot && p.shape !== 'comes_to_you' && (
                                <Field label="Notice needed" hint="How far ahead a guest has to book. The calendar won't offer a date sooner than this.">
                                    <OptionPills
                                        options={LEAD_TIME_OPTIONS.map((o) => ({ value: String(o.days), label: o.label }))}
                                        value={String(leadDays)}
                                        onChange={(v) => setLeadDays(Number(v))}
                                    />
                                </Field>
                            )}
                            <Field label="How far ahead guests can book" hint="Beyond this, dates aren’t open yet — they come into range as time passes.">
                                <OptionPills
                                    options={BOOKING_HORIZON_OPTIONS.map((o) => ({ value: String(o.days), label: o.label }))}
                                    value={String(horizonDays)}
                                    onChange={(v) => setHorizonDays(Number(v))}
                                />
                            </Field>
                            {p.shape === 'comes_to_you' && (
                                <p className="text-xs text-slate-500">
                                    Your booking times come from your weekly opening hours — set them under “Opening hours”.
                                </p>
                            )}
                        </SectionCard>
                    )}

                    {active === 'availability' && (
                        <SectionCard title={p.isSlot ? 'Availability' : 'Opening hours'} hint={p.isSlot ? 'Your weekly hours and session shape. A specific day off, or part of a day, is set in your diary.' : 'The hours you work each week — a guest picks a time within them. A specific day off is set in your diary.'} saving={savingKey === 'availability'}
                            onSave={() => run('availability', {
                                slot_length_minutes: slotLength, slot_turnaround_minutes: turnaround,
                                lead_time_days: leadDays,
                                availability: hours
                                    .map((h, d) => ({ ...h, day_of_week: d }))
                                    .filter((h) => h.on && h.open && h.close && h.open < h.close)
                                    .map((h) => ({ day_of_week: h.day_of_week, open_time: h.open, close_time: h.close })),
                            })}>
                            <div>
                                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Weekly hours</span>
                                <div className="mt-2 space-y-1.5">
                                    {DAY_NAMES.map((name, d) => (
                                        <div key={d} className="flex items-center gap-3">
                                            <button type="button" onClick={() => setHours(hours.map((h, j) => j === d ? { ...h, on: !h.on } : h))}
                                                className={`w-16 rounded-lg border px-2 py-1.5 text-sm font-medium ${hours[d].on ? 'border-emerald-700 bg-emerald-50 text-slate-900' : 'border-slate-300 text-slate-400'}`}>
                                                {name}
                                            </button>
                                            {hours[d].on ? (
                                                <>
                                                    <input type="time" value={hours[d].open} onChange={(e) => setHours(hours.map((h, j) => j === d ? { ...h, open: e.target.value } : h))} className="rounded-lg border border-slate-300 p-1.5 text-sm" />
                                                    <span className="text-slate-400">to</span>
                                                    <input type="time" value={hours[d].close} onChange={(e) => setHours(hours.map((h, j) => j === d ? { ...h, close: e.target.value } : h))} className="rounded-lg border border-slate-300 p-1.5 text-sm" />
                                                </>
                                            ) : <span className="text-sm text-slate-400">Closed</span>}
                                        </div>
                                    ))}
                                </div>
                            </div>
                            {/* The notice period sits beside the opening hours — it's
                                how soon a guest can book, and the earliest date the
                                calendar offers is today plus this. */}
                            <Field label="Notice needed" hint="How far ahead a guest has to book. The calendar won't offer a date sooner than this.">
                                <OptionPills
                                    options={LEAD_TIME_OPTIONS.map((o) => ({ value: String(o.days), label: o.label }))}
                                    value={String(leadDays)}
                                    onChange={(v) => setLeadDays(Number(v))}
                                />
                            </Field>
                            {p.isSlot && (
                                <>
                                    <Field label="Session length" hint="How long one session runs.">
                                        <OptionPills
                                            options={SESSION_LENGTH_OPTIONS.map((m) => ({ value: String(m), label: minutesLabel(m) }))}
                                            value={String(slotLength)}
                                            onChange={(v) => setSlotLength(Number(v))}
                                        />
                                    </Field>
                                    <Field label="Gap between sessions" hint="Time to reset or clean up before the next one can start.">
                                        <OptionPills
                                            options={TURNAROUND_OPTIONS.map((m) => ({ value: String(m), label: m === 0 ? 'None' : `${m} min` }))}
                                            value={String(turnaround)}
                                            onChange={(v) => setTurnaround(Number(v))}
                                        />
                                    </Field>
                                </>
                            )}
                            {/* The minimum-per-booking now lives on each per-person
                                item in "What you offer" (a whole-session provider has
                                no per-person minimum at all), so it's gone from here. */}
                            {/* Dated exceptions have one home — the diary, where a
                                provider also sees their bookings. The editor owns the
                                weekly template and points clearly to the diary rather
                                than becoming a second place to block a date. */}
                            <Link href="/services/dashboard"
                                className="flex items-center justify-between gap-3 rounded-xl border border-slate-300 bg-slate-50 p-4 transition hover:border-slate-400">
                                <div className="flex items-start gap-3">
                                    <CalendarRange className="mt-0.5 h-5 w-5 flex-none text-slate-500" />
                                    <div>
                                        <div className="text-sm font-semibold text-slate-900">Blocking a specific day, or part of one?</div>
                                        <p className="text-xs text-slate-500">Those are exceptions to your weekly hours — set them in your diary, alongside your bookings.</p>
                                    </div>
                                </div>
                                <span className="flex-none text-sm font-semibold text-emerald-700">Open diary →</span>
                            </Link>
                        </SectionCard>
                    )}

                    {active === 'cancellation' && (
                        <SectionCard title="Cancellation policy" hint="How long before the start a guest can cancel for a full refund." saving={savingKey === 'cancellation'}
                            onSave={() => run('cancellation', { cancellation_window_hours: cancelPolicy.hours, no_refund: !!cancelPolicy.noRefund })}>
                            <p className="text-xs text-slate-500">
                                After the window it’s your call. Refunds always exclude the Galloway Getaways service fee.
                            </p>
                            <div className="space-y-3">
                                {EXPERIENCE_CANCELLATION_OPTIONS.map((o) => {
                                    const on = cancelPolicy.key === o.key;
                                    return (
                                        <button key={o.key} type="button"
                                            onClick={() => { setCancelHours(o.hours); setNoRefund(!!o.noRefund); }}
                                            className={`w-full rounded-2xl border-2 p-4 text-left transition ${on ? 'border-emerald-700 bg-emerald-50' : 'border-slate-200 hover:border-slate-400'}`}>
                                            <div className="flex items-center justify-between">
                                                <span className="font-semibold text-slate-900">{o.label}</span>
                                                {on && <Check className="h-4 w-4 text-emerald-700" />}
                                            </div>
                                            <p className="mt-0.5 text-xs text-slate-500">{o.blurb}</p>
                                        </button>
                                    );
                                })}
                            </div>
                        </SectionCard>
                    )}

                    {active === 'status' && (
                        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
                            <h2 className="text-xl font-bold text-slate-900">Listing status</h2>
                            <p className="mt-1 text-sm text-slate-500">
                                {paused
                                    ? 'Your listing is taken down — guests can’t find or book it.'
                                    : 'Your listing is live and bookable.'}
                            </p>
                            <div className="mt-4 rounded-xl border border-slate-200 p-4">
                                <div className="font-semibold text-slate-900">
                                    {paused ? 'Put your listing back up' : 'Take your listing down for a while'}
                                </div>
                                <p className="mt-1 text-sm text-slate-600">
                                    {paused
                                        ? 'It goes back live immediately — no review. Guests can find and book it again.'
                                        : 'It stops taking new bookings and disappears from the marketplace. Bookings you’ve already confirmed still stand and stay in your diary — putting it back up later is instant, with no re-approval.'}
                                </p>
                                <button type="button" onClick={togglePaused} disabled={pausing}
                                    className={`mt-4 rounded-xl px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60 ${paused ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-slate-800 hover:bg-slate-900'}`}>
                                    {pausing ? '…' : paused ? 'Put it back up' : 'Take it down'}
                                </button>
                            </div>
                        </section>
                    )}
                </div>
            </div>
        </div>
    );
}
