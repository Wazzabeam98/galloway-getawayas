'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'react-toastify';
import {
    FileText, User, Info, Salad, Image as ImageIcon,
    ShoppingBag, MapPin, CalendarRange, Eye, EyeOff, ExternalLink, Check,
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
    id: string; shape: string; isSlot: boolean;
    business_name: string; category_label: string; description: string;
    status: string; owner_paused: boolean;
    photos: string[]; headshot: string | null; logo: string | null;
    dietary_note: string; fulfilment: string;
    collection_street: string; collection_town: string; collection_postcode: string;
    slot_length_minutes: number | null; slot_turnaround_minutes: number;
    slot_capacity: number | null; slot_min_people: number;
    lead_time_days: number; cancellation_window_hours: number;
    professional_title: string; years_experience: string; qualifications: string; recognition: string;
    what_to_expect: string; itinerary: Array<{ title?: string | null; detail?: string | null }>;
    min_age: number | null; activity_level: string; what_to_bring: string;
    dietary_options: string[];
    areas: string[];
    items: Array<{ id: string; name: string; description: string; price: number; unit: string; hasImage: boolean; active: boolean }>;
    availability: Array<{ day_of_week: number; open_time: string; close_time: string }>;
}

type SectionKey = 'title' | 'about' | 'happens' | 'things' | 'dietary' | 'photos' | 'menu' | 'where' | 'availability';

const BUILT: Record<string, boolean> = { title: true, about: true, happens: true, things: true, dietary: true, availability: true };

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
function SectionCard({ title, hint, children, onSave, saving }: {
    title: string; hint?: string; children: React.ReactNode; onSave: () => void; saving: boolean;
}) {
    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
            <h2 className="text-xl font-bold text-slate-900">{title}</h2>
            {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
            <div className="mt-4 space-y-4">{children}</div>
            <button type="button" onClick={onSave} disabled={saving}
                className="mt-5 rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-60">
                {saving ? 'Saving…' : 'Save'}
            </button>
        </section>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
            <div className="mt-1">{children}</div>
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
    const [itinerary, setItinerary] = useState(p.itinerary.map((s) => ({ title: s.title || '', detail: s.detail || '' })));
    const [minAge, setMinAge] = useState(p.min_age != null ? String(p.min_age) : '');
    const [activity, setActivity] = useState(p.activity_level);
    const [whatToBring, setWhatToBring] = useState(p.what_to_bring);
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
    const [slotLength, setSlotLength] = useState(p.slot_length_minutes != null ? String(p.slot_length_minutes) : '');
    const [turnaround, setTurnaround] = useState(String(p.slot_turnaround_minutes || 0));
    const [capacity, setCapacity] = useState(p.slot_capacity != null ? String(p.slot_capacity) : '');
    const [minPeople, setMinPeople] = useState(String(p.slot_min_people || 1));
    const [leadDays, setLeadDays] = useState(String(p.lead_time_days || 0));
    const [cancelHours, setCancelHours] = useState(String(p.cancellation_window_hours ?? 48));

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

    // The two hard visibility facts, shown as gentle guards (never blocks).
    const noPhotoWillVanish = !p.photos.length && !p.items.some((i) => i.hasImage);
    const noPricedItem = !p.items.some((i) => i.active && i.price > 0);

    const SECTIONS: { key: SectionKey; label: string; icon: any }[] = [
        { key: 'title', label: 'Title & category', icon: FileText },
        { key: 'about', label: 'About you', icon: User },
        { key: 'photos', label: 'Photos', icon: ImageIcon },
        { key: 'menu', label: 'What you offer', icon: ShoppingBag },
        { key: 'happens', label: 'What happens', icon: FileText },
        { key: 'things', label: 'Things to know', icon: Info },
        { key: 'dietary', label: 'Food & dietary', icon: Salad },
        { key: 'where', label: 'Where it happens', icon: MapPin },
        ...(p.isSlot ? [{ key: 'availability' as SectionKey, label: 'Availability', icon: CalendarRange }] : []),
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
                    <ExternalLink className="h-4 w-4" /> See it as a guest
                </Link>
            </div>

            {/* Take-down banner */}
            <div className={`mb-6 rounded-2xl border p-4 ${paused ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                        {paused ? <EyeOff className="mt-0.5 h-5 w-5 text-amber-700" /> : <Eye className="mt-0.5 h-5 w-5 text-emerald-700" />}
                        <div>
                            <div className="font-semibold text-slate-900">
                                {paused ? 'Your listing is taken down' : 'Your listing is live'}
                            </div>
                            <p className="text-sm text-slate-600">
                                {paused
                                    ? 'Guests can’t find or book it. Bookings you’ve already confirmed still stand — put it back up whenever you’re ready.'
                                    : 'Take it down to stop new bookings for a while. Bookings already confirmed are unaffected, and putting it back up is instant — no review.'}
                            </p>
                        </div>
                    </div>
                    <button type="button" onClick={togglePaused} disabled={pausing}
                        className={`rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-60 ${paused ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-slate-800 hover:bg-slate-900'}`}>
                        {pausing ? '…' : paused ? 'Put it back up' : 'Take it down'}
                    </button>
                </div>
            </div>

            {/* Go-live gate for a slot provider with no weekly hours: a slot with
                no availability generates no sessions and is dropped from the
                marketplace, so it's the one thing that keeps a new provider
                invisible. Said loudly, with a jump to fix it — never a hard block. */}
            {p.isSlot && p.availability.length === 0 && !paused && (
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
                        <SectionCard title="Title & category" hint="The name at the top of your listing." saving={savingKey === 'title'}
                            onSave={() => run('title', { business_name: businessName })}>
                            <Field label="Listing title">
                                <input className={inputCls} value={businessName} onChange={(e) => setBusinessName(e.target.value)} maxLength={80} />
                            </Field>
                            <p className="text-xs text-slate-500">Category: {p.category_label || 'set at review'}</p>
                        </SectionCard>
                    )}

                    {active === 'about' && (
                        <SectionCard title="About you" hint="Your credibility — shown beneath your listing name." saving={savingKey === 'about'}
                            onSave={() => run('about', { professional_title: profTitle, years_experience: years, qualifications: quals, recognition })}>
                            <Field label="Professional title"><input className={inputCls} value={profTitle} onChange={(e) => setProfTitle(e.target.value)} placeholder="Chef and restaurant owner" /></Field>
                            <Field label="Years of experience"><input className={inputCls} value={years} onChange={(e) => setYears(e.target.value)} placeholder="30" /></Field>
                            <Field label="Qualifications"><textarea className={inputCls} rows={2} value={quals} onChange={(e) => setQuals(e.target.value)} /></Field>
                            <Field label="Recognition (optional)"><textarea className={inputCls} rows={2} value={recognition} onChange={(e) => setRecognition(e.target.value)} /></Field>
                        </SectionCard>
                    )}

                    {active === 'happens' && (
                        <SectionCard title="What happens" hint="Walk a guest through the experience." saving={savingKey === 'happens'}
                            onSave={() => run('happens', { what_to_expect: whatToExpect, itinerary })}>
                            <Field label="What happens"><textarea className={inputCls} rows={5} value={whatToExpect} onChange={(e) => setWhatToExpect(e.target.value)} /></Field>
                            <div>
                                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Itinerary (optional)</span>
                                <p className="mt-0.5 text-xs text-slate-400">The steps of the experience, in order.</p>
                                <div className="mt-2 space-y-2">
                                    {itinerary.map((step, i) => (
                                        <div key={i} className="flex gap-2">
                                            <input className="w-40 rounded-xl border border-slate-300 p-2.5 text-sm" placeholder="Step" value={step.title}
                                                onChange={(e) => setItinerary(itinerary.map((s, j) => j === i ? { ...s, title: e.target.value } : s))} />
                                            <input className="flex-1 rounded-xl border border-slate-300 p-2.5 text-sm" placeholder="What happens in it" value={step.detail}
                                                onChange={(e) => setItinerary(itinerary.map((s, j) => j === i ? { ...s, detail: e.target.value } : s))} />
                                            <button type="button" onClick={() => setItinerary(itinerary.filter((_, j) => j !== i))} className="px-2 text-slate-400 hover:text-red-600">&times;</button>
                                        </div>
                                    ))}
                                    <button type="button" onClick={() => setItinerary([...itinerary, { title: '', detail: '' }])} className="text-sm font-semibold text-emerald-700 hover:text-emerald-800">+ Add a step</button>
                                </div>
                            </div>
                        </SectionCard>
                    )}

                    {active === 'things' && (
                        <SectionCard title="Things to know" hint="Practical facts a guest wants before booking." saving={savingKey === 'things'}
                            onSave={() => run('things', { min_age: minAge, activity_level: activity, what_to_bring: whatToBring })}>
                            <Field label="Minimum age"><input className={inputCls} type="number" min={0} value={minAge} onChange={(e) => setMinAge(e.target.value)} placeholder="No minimum" /></Field>
                            <Field label="Activity level">
                                <div className="flex gap-2">
                                    {['gentle', 'moderate', 'challenging'].map((lvl) => (
                                        <button key={lvl} type="button" onClick={() => setActivity(activity === lvl ? '' : lvl)}
                                            className={`rounded-xl border px-4 py-2 text-sm capitalize transition ${activity === lvl ? 'border-emerald-700 bg-emerald-50 text-slate-900' : 'border-slate-300 text-slate-700 hover:border-slate-400'}`}>
                                            {lvl}
                                        </button>
                                    ))}
                                </div>
                            </Field>
                            <Field label="What to bring"><textarea className={inputCls} rows={3} value={whatToBring} onChange={(e) => setWhatToBring(e.target.value)} placeholder="Warm layers, sturdy shoes…" /></Field>
                        </SectionCard>
                    )}

                    {active === 'dietary' && (
                        <SectionCard title="Food & dietary" hint="What you can cater for." saving={savingKey === 'dietary'}
                            onSave={() => run('dietary', { dietary_note: dietaryNote, dietary_options: p.dietary_options })}>
                            <Field label="Dietary note"><textarea className={inputCls} rows={3} value={dietaryNote} onChange={(e) => setDietaryNote(e.target.value)} placeholder="Vegetarian and gluten-free on request; not a nut-free kitchen." /></Field>
                        </SectionCard>
                    )}

                    {/* Sections landing next — shown so the shape is honest. */}
                    {active === 'photos' && <ComingSection title="Photos" note={noPhotoWillVanish ? 'Heads up: with no photo here your listing is hidden from the homepage and both marketplace grids.' : undefined} />}
                    {active === 'menu' && <ComingSection title="What you offer" note={noPricedItem ? 'Heads up: with no priced item your listing can’t be booked and won’t be shown.' : undefined} />}
                    {active === 'where' && <ComingSection title="Where it happens" />}

                    {active === 'availability' && (
                        <SectionCard title="Availability" hint="Your weekly hours and booking rules. A specific day off, or part of a day, is set in your diary." saving={savingKey === 'availability'}
                            onSave={() => run('availability', {
                                slot_length_minutes: slotLength, slot_turnaround_minutes: turnaround,
                                slot_capacity: capacity, slot_min_people: minPeople,
                                lead_time_days: leadDays, cancellation_window_hours: cancelHours,
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
                            <div className="grid grid-cols-2 gap-4">
                                <Field label="Session length (min)"><input className={inputCls} type="number" min={15} value={slotLength} onChange={(e) => setSlotLength(e.target.value)} /></Field>
                                <Field label="Turnaround / gap (min)"><input className={inputCls} type="number" min={0} value={turnaround} onChange={(e) => setTurnaround(e.target.value)} /></Field>
                                <Field label="Group size (max)"><input className={inputCls} type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></Field>
                                <Field label="Minimum per booking"><input className={inputCls} type="number" min={1} value={minPeople} onChange={(e) => setMinPeople(e.target.value)} /></Field>
                                <Field label="Lead time (days)"><input className={inputCls} type="number" min={0} value={leadDays} onChange={(e) => setLeadDays(e.target.value)} /></Field>
                                <Field label="Cancellation window (hrs)"><input className={inputCls} type="number" min={0} value={cancelHours} onChange={(e) => setCancelHours(e.target.value)} /></Field>
                            </div>
                            <p className="text-xs text-slate-500">To close a specific day, or part of one, use your diary — those are exceptions to these weekly hours.</p>
                        </SectionCard>
                    )}
                </div>
            </div>
        </div>
    );
}

function ComingSection({ title, note }: { title: string; note?: string }) {
    return (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6">
            <h2 className="text-xl font-bold text-slate-900">{title}</h2>
            <p className="mt-1 text-sm text-slate-500">This section is being wired into the new editor next.</p>
            {note && (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                    <Check className="mt-0.5 h-4 w-4 flex-none" /> {note}
                </div>
            )}
        </section>
    );
}
