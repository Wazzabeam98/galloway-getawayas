'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'react-toastify';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import Env from '@/config/Env';
import { getImageUrl, generateRandomNumber } from '@/lib/utils';
import { compressImage } from '@/lib/compressImage';
import { PhotoEditorGrid } from './PhotoEditorGrid';
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
    items: Array<{ id: string; name: string; description: string; price: number; unit: string; image: string | null; duration_minutes: number | null; active: boolean }>;
    availability: Array<{ day_of_week: number; open_time: string; close_time: string }>;
}

type SectionKey = 'title' | 'about' | 'happens' | 'things' | 'dietary' | 'photos' | 'menu' | 'where' | 'availability';

const BUILT: Record<string, boolean> = { title: true, about: true, photos: true, menu: true, happens: true, things: true, dietary: true, where: true, availability: true };

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
    type MenuRow = { id?: string; name: string; description: string; price: string; unit: string; image: string | null; duration: string; active: boolean };
    const [menu, setMenu] = useState<MenuRow[]>(p.items.map((it) => ({
        id: it.id, name: it.name, description: it.description, price: String(it.price),
        unit: it.unit, image: it.image, duration: it.duration_minutes != null ? String(it.duration_minutes) : '', active: it.active,
    })));
    const setRow = (i: number, patch: Partial<MenuRow>) => setMenu(menu.map((r, j) => j === i ? { ...r, ...patch } : r));

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
    const [fulfilment, setFulfilment] = useState(p.fulfilment || 'collection');
    const [street, setStreet] = useState(p.collection_street);
    const [town, setTown] = useState(p.collection_town);
    const [postcode, setPostcode] = useState(p.collection_postcode);
    const [areas, setAreas] = useState<string[]>(p.areas);
    const collects = fulfilment === 'collection' || fulfilment === 'both';
    const travels = fulfilment === 'delivery' || fulfilment === 'both';

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

                    {active === 'photos' && (
                        <SectionCard title="Photos" hint="Your gallery leads the listing. The first photo is the cover — drag to reorder." saving={savingKey === 'photos'}
                            onSave={() => run('photos', { photos, headshot, logo })}>
                            {/* Last-photo guard: removing every photo hides the listing
                                from the homepage and both marketplace grids (they filter
                                on a hero). Said, never blocked. */}
                            {photos.length === 0 && !p.items.some((i) => i.image) && (
                                <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                                    <Check className="mt-0.5 h-4 w-4 flex-none" />
                                    With no photo, your listing is hidden from the homepage and both marketplace grids. Add at least one to appear.
                                </div>
                            )}
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
                            <div>
                                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">A photo of yourself</span>
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
                        </SectionCard>
                    )}

                    {active === 'menu' && (
                        <SectionCard title="What you offer" hint="What a guest books, with a price. A slot prices per person or as a whole session." saving={savingKey === 'menu'}
                            onSave={() => run('menu', {
                                items: menu.map((r) => ({
                                    id: r.id, name: r.name, description: r.description, price: r.price,
                                    unit: r.unit, image: r.image, duration_minutes: r.duration, active: r.active,
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
                                        <div className="flex items-start gap-3">
                                            <div className="flex-1 space-y-3">
                                                <input className={inputCls} placeholder="Name (e.g. 90-minute private sauna)" value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} />
                                                <div className="flex flex-wrap gap-3">
                                                    <label className="flex items-center gap-1 text-sm">
                                                        <span className="text-slate-500">£</span>
                                                        <input className="w-24 rounded-xl border border-slate-300 p-2.5 text-sm" type="number" min={0} step="0.01" value={r.price} onChange={(e) => setRow(i, { price: e.target.value })} />
                                                    </label>
                                                    <select className="rounded-xl border border-slate-300 p-2.5 text-sm" value={r.unit} onChange={(e) => setRow(i, { unit: e.target.value })}>
                                                        <option value="flat">whole session</option>
                                                        <option value="person">per person</option>
                                                        {!p.isSlot && <option value="hour">per hour</option>}
                                                        {!p.isSlot && <option value="night">per night</option>}
                                                        {!p.isSlot && <option value="ticket">per ticket</option>}
                                                        {!p.isSlot && <option value="item">per item</option>}
                                                    </select>
                                                    {p.isSlot && (
                                                        <label className="flex items-center gap-1 text-sm text-slate-500">
                                                            <input className="w-20 rounded-xl border border-slate-300 p-2.5 text-sm" type="number" min={1} placeholder="mins" value={r.duration} onChange={(e) => setRow(i, { duration: e.target.value })} />
                                                            <span>min</span>
                                                        </label>
                                                    )}
                                                </div>
                                                <textarea className={inputCls} rows={2} placeholder="Description (optional)" value={r.description} onChange={(e) => setRow(i, { description: e.target.value })} />
                                            </div>
                                            <div className="flex flex-col items-center gap-2">
                                                {r.image ? (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img src={getImageUrl(r.image)} alt="" className="h-16 w-16 rounded-lg object-cover ring-1 ring-slate-200" />
                                                ) : (
                                                    <span className="flex h-16 w-16 items-center justify-center rounded-lg bg-slate-100 text-slate-300"><ImageIcon className="h-5 w-5" /></span>
                                                )}
                                                <label className="cursor-pointer text-xs font-semibold text-emerald-700 hover:text-emerald-800">
                                                    {r.image ? 'Change' : 'Photo'}
                                                    <input type="file" accept="image/png, image/jpeg" onChange={(e) => changeItemImage(i, e)} className="hidden" disabled={uploading} />
                                                </label>
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
                            <button type="button" onClick={() => setMenu([...menu, { name: '', description: '', price: '', unit: p.isSlot ? 'flat' : 'flat', image: null, duration: '', active: true }])}
                                className="text-sm font-semibold text-emerald-700 hover:text-emerald-800">+ Add an item</button>
                        </SectionCard>
                    )}

                    {active === 'where' && (
                        <SectionCard title="Where it happens" hint="How guests reach you. They only ever see the town — the street and postcode stay private until a booking is confirmed." saving={savingKey === 'where'}
                            onSave={() => run('where', {
                                fulfilment,
                                collection_street: street, collection_town: town, collection_postcode: postcode,
                                areas: travels ? areas : [],
                            })}>
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
                                    <div className="mt-2 space-y-2">
                                        {areas.map((a, i) => (
                                            <div key={i} className="flex gap-2">
                                                <input className="flex-1 rounded-xl border border-slate-300 p-2.5 text-sm" value={a} placeholder="e.g. The Stewartry" onChange={(e) => setAreas(areas.map((x, j) => j === i ? e.target.value : x))} />
                                                <button type="button" onClick={() => setAreas(areas.filter((_, j) => j !== i))} className="px-2 text-slate-400 hover:text-red-600">&times;</button>
                                            </div>
                                        ))}
                                        <button type="button" onClick={() => setAreas([...areas, ''])} className="text-sm font-semibold text-emerald-700 hover:text-emerald-800">+ Add a region</button>
                                    </div>
                                </div>
                            )}
                        </SectionCard>
                    )}

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
