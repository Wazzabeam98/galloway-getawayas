'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'react-toastify';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import Env from '@/config/Env';
import { getImageUrl, generateRandomNumber } from '@/lib/utils';
import { compressImage } from '@/lib/compressImage';
import { GUEST_REGIONS, GUEST_COVERAGE_ALL_KEY } from '@/lib/strings';
import { childrenAllowed } from '@/lib/guestAges';
import { stepHeadings } from '@/lib/experienceSteps';
import { slotAsksWhereFork, ACCESSIBILITY_OPTIONS, PARKING_OPTIONS, EXPERIENCE_CANCELLATION_OPTIONS, experienceCancellationOption, EXPERIENCE_AMENITY_GROUPS } from '@/lib/serviceProviders';
import AutoTextarea from '@/components/AutoTextarea';
import { cleanAmountInput, amountForBox } from '@/lib/amountInput';
import { EditorCard, EditorPanel, saved } from '@/components/listing-editor/EditorPanel';
import PhotosEditor, { PhotosCard, type SavePhotos } from '@/components/listing-editor/PhotosEditor';
import PhoneSectionTabs, { goToEditorSection } from '@/components/listing-editor/PhoneSectionTabs';
import { OptionPills, Stepper, SESSION_LENGTH_OPTIONS, minutesLabel } from './editorControls';
import { savePaused, TakenDownBanner, ListingStatusSection } from '@/components/services/ListingPauseControl';
import {
    FileText, User, Info, Salad, Image as ImageIcon,
    ShoppingBag, MapPin, CalendarRange, Sparkles, RotateCcw,
    Eye, EyeOff, ExternalLink, Check,
} from 'lucide-react';

// The guest-experience listing editor, brought to the same shape as the
// holiday-let editor (app/edit-listing): the sections grouped the way Airbnb's
// experience host editor groups them, each a raised card showing its answer in
// one line, opening a full-screen sheet with Save and Cancel. EVERY CARD SAVES
// ITSELF — its own POST to /api/services/listing/save — so changing a price
// never means re-running the whole thing. There is no Save for the page and no
// "Saved" pop-up (the sheet closing is the confirmation, as on Airbnb); only a
// failure says anything. Approval is one-time: an approved provider edits freely
// and changes go live immediately.
//
// On a phone the editor is one continuous page with a sticky underline tab bar
// (PhoneSectionTabs); on desktop the sticky left-hand list, click-to-section.
// The save route is untouched — the section keys and payloads below are exactly
// what it already reads, so saving and booking behave exactly as before.

export interface EditorProvider {
    id: string; shape: string; isSlot: boolean; isFood: boolean;
    business_name: string; category_label: string; category: string; description: string;
    status: string; owner_paused: boolean; admin_hidden: boolean;
    photos: string[]; headshot: string | null; logo: string | null;
    dietary_note: string; fulfilment: string; delivery_fee: number; delivery_radius_miles: number;
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
    items: Array<{ id: string; name: string; description: string; price: number; unit: string; image: string | null; duration_minutes: number | null; fulfilment: string | null; active: boolean; capacity: number | null; min_people: number | null; included_guests?: number | null; extra_adult_fee?: number | null; extra_child_fee?: number | null; max_party?: number | null; is_custom?: boolean; ingredients?: string | null; allergens?: string | null; category?: string | null }>;
    availability: Array<{ day_of_week: number; open_time: string; close_time: string }>;
}

type NavKey = 'experience' | 'photos' | 'included' | 'know' | 'where' | 'availability' | 'pricing' | 'cancellation' | 'host' | 'dietary' | 'status';

// How far ahead a guest can book — a pick from sensible windows (Airbnb's
// booking-window control). Stored as days.
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

// The gap between sessions — common picks, in minutes.
const TURNAROUND_OPTIONS = [0, 15, 30, 45, 60];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const inputCls = 'w-full rounded-xl border border-slate-300 p-3 text-sm';

// A label above a field, with an optional one-line hint beneath.
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
            <div className="mt-1">{children}</div>
            {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
        </label>
    );
}

// Every sheet's footer: Cancel on the left, Save on the right. The write is the
// sheet's own (the editor has no page Save); "Saving…" while it runs, and the
// sheet stays open if it fails.
function SheetFooter({ busy, onCancel, onSave, disabled, disabledLabel }: {
    busy: boolean; onCancel: () => void; onSave: () => void; disabled?: boolean; disabledLabel?: string;
}) {
    return (
        <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={onCancel} className="text-sm font-semibold text-slate-900 underline">Cancel</button>
            <button type="button" onClick={onSave} disabled={busy || disabled}
                className="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-40">
                {busy ? 'Saving…' : (disabled && disabledLabel) ? disabledLabel : 'Save'}
            </button>
        </div>
    );
}

// Shared open/draft/save plumbing for a card: seeds a fresh draft when the sheet
// opens, writes on Save and closes only if the write went through.
function useCardSheet<T>(current: T, onSave: (draft: T) => unknown) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<T>(current);
    const [busy, setBusy] = useState(false);
    const start = () => { setDraft(current); setOpen(true); };
    const close = () => setOpen(false);
    const save = async () => {
        if (busy) return;
        setBusy(true);
        try { if (await saved(onSave(draft))) setOpen(false); } finally { setBusy(false); }
    };
    return { open, draft, setDraft, busy, start, close, save };
}

async function uploadImage(supabase: SupabaseClient, file: File, prefix: string): Promise<string | null> {
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

// ── Cards ──────────────────────────────────────────────────────────────────

function TitleCard({ value, onSave }: { value: string; onSave: (v: string) => unknown }) {
    const c = useCardSheet(value, onSave);
    return (
        <>
            <EditorCard title="Title" summary={value.trim() || 'Add a title'} onClick={c.start} />
            {c.open && (
                <EditorPanel title="Title" onClose={c.close}
                    footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <Field label="Listing title" hint="The name at the top of your listing.">
                        <input className={inputCls} value={c.draft} maxLength={80} onChange={(e) => c.setDraft(e.target.value)} aria-label="Listing title" />
                    </Field>
                </EditorPanel>
            )}
        </>
    );
}

function WhatHappensCard({ whatToExpect, phases, headings, onSave }: {
    whatToExpect: string;
    phases: [string, string, string];
    headings: { title: string }[];
    onSave: (draft: { whatToExpect: string; phases: [string, string, string] }) => unknown;
}) {
    const c = useCardSheet({ whatToExpect, phases }, onSave);
    const ph = (['Where to meet, how to find you, what to expect first.', 'The heart of it — what you’ll actually do together.', 'How it wraps up — and anything to do after.']);
    return (
        <>
            <EditorCard title="What happens" summary={whatToExpect.trim() || 'Add what happens'} onClick={c.start} />
            {c.open && (
                <EditorPanel title="What happens" onClose={c.close}
                    footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <div className="space-y-4">
                        <Field label="In a sentence, what is it?">
                            <AutoTextarea className={inputCls} rows={3} value={c.draft.whatToExpect}
                                onChange={(e) => c.setDraft({ ...c.draft, whatToExpect: e.target.value })}
                                placeholder="A wood-fired lakeside sauna with cold-water dips between rounds." />
                        </Field>
                        <div>
                            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">The flow</span>
                            <p className="mt-0.5 text-xs text-slate-400">Take a guest through it, start to finish. Leave a step blank to skip it.</p>
                            <div className="mt-3 space-y-3">
                                {headings.map((h, i) => (
                                    <div key={h.title} className="flex gap-3">
                                        <div className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-emerald-700 text-xs font-bold text-white">{i + 1}</div>
                                        <div className="flex-1">
                                            <div className="text-sm font-semibold text-slate-900">{h.title}</div>
                                            <AutoTextarea className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm" rows={2}
                                                value={c.draft.phases[i]}
                                                onChange={(e) => { const next = [...c.draft.phases] as [string, string, string]; next[i] = e.target.value; c.setDraft({ ...c.draft, phases: next }); }}
                                                placeholder={ph[i]} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </EditorPanel>
            )}
        </>
    );
}

// What's included — the ticked "what's provided / on site" set that drives the
// guest listing's "What's included" list, with the venue's access and parking
// (what's there when a guest arrives). One save: the amenities section.
function WhatsIncludedCard({ amenities, accessibility, parking, onSave }: {
    amenities: string[]; accessibility: string; parking: string;
    onSave: (draft: { amenities: string[]; accessibility: string; parking: string }) => unknown;
}) {
    const c = useCardSheet({ amenities, accessibility, parking }, onSave);
    const toggle = (key: string) => c.setDraft({ ...c.draft, amenities: c.draft.amenities.includes(key) ? c.draft.amenities.filter((k) => k !== key) : [...c.draft.amenities, key] });
    const labels = EXPERIENCE_AMENITY_GROUPS.flatMap((g) => g.items).filter((i) => amenities.includes(i.key)).map((i) => i.label);
    const summary = labels.length ? `${labels.length} included · ${labels.slice(0, 3).join(', ')}` : 'Add what’s included';
    return (
        <>
            <EditorCard title="What’s included" summary={summary} onClick={c.start} />
            {c.open && (
                <EditorPanel title="What’s included" onClose={c.close}
                    footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <div className="space-y-4">
                        {EXPERIENCE_AMENITY_GROUPS.map((grp) => (
                            <div key={grp.group}>
                                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{grp.group}</span>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {grp.items.map((a) => {
                                        const on = c.draft.amenities.includes(a.key);
                                        return (
                                            <button key={a.key} type="button" onClick={() => toggle(a.key)} aria-pressed={on}
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
                            <Field label="Accessibility" hint="The nearest option — a guest who needs it wants a clear answer.">
                                <OptionPills options={ACCESSIBILITY_OPTIONS.map((o) => ({ value: o.key, label: o.label }))}
                                    value={c.draft.accessibility} onChange={(v) => c.setDraft({ ...c.draft, accessibility: c.draft.accessibility === v ? '' : v })} />
                            </Field>
                        </div>
                        <Field label="Parking">
                            <OptionPills options={PARKING_OPTIONS.map((o) => ({ value: o.key, label: o.label }))}
                                value={c.draft.parking} onChange={(v) => c.setDraft({ ...c.draft, parking: c.draft.parking === v ? '' : v })} />
                        </Field>
                    </div>
                </EditorPanel>
            )}
        </>
    );
}

// Good to know — the practical facts a guest wants before booking: who it's
// for (minimum age), how hard it is, and what to bring. One save: the things
// section.
function GoodToKnowCard({ minAge, activity, whatToBring, onSave }: {
    minAge: string; activity: string; whatToBring: string;
    onSave: (draft: { minAge: string; activity: string; whatToBring: string }) => unknown;
}) {
    const c = useCardSheet({ minAge, activity, whatToBring }, onSave);
    const parts = [
        minAge ? `${minAge}+` : null,
        activity ? activity.charAt(0).toUpperCase() + activity.slice(1) : null,
    ].filter(Boolean);
    const summary = parts.length ? parts.join(' · ') : (whatToBring.trim() ? whatToBring.trim() : 'Add the details');
    return (
        <>
            <EditorCard title="Good to know" summary={summary} onClick={c.start} />
            {c.open && (
                <EditorPanel title="Good to know" onClose={c.close}
                    footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <div className="space-y-4">
                        <Field label="Minimum age" hint="The youngest a guest can be to take part.">
                            <OptionPills
                                options={[{ value: '', label: 'No minimum' }, { value: '12', label: '12+' }, { value: '16', label: '16+' }, { value: '18', label: '18+' }, { value: '21', label: '21+' }]}
                                value={c.draft.minAge} onChange={(v) => c.setDraft({ ...c.draft, minAge: v })} />
                        </Field>
                        <Field label="Activity level">
                            <OptionPills
                                options={[{ value: 'gentle', label: 'Gentle' }, { value: 'moderate', label: 'Moderate' }, { value: 'challenging', label: 'Challenging' }]}
                                value={c.draft.activity} onChange={(v) => c.setDraft({ ...c.draft, activity: c.draft.activity === v ? '' : v })} />
                        </Field>
                        <Field label="What to bring">
                            <AutoTextarea className={inputCls} rows={3} value={c.draft.whatToBring}
                                onChange={(e) => c.setDraft({ ...c.draft, whatToBring: e.target.value })} placeholder="Warm layers, sturdy shoes…" />
                        </Field>
                    </div>
                </EditorPanel>
            )}
        </>
    );
}

function CancellationCard({ hours, noRefund, onSave }: {
    hours: number; noRefund: boolean;
    onSave: (draft: { hours: number; noRefund: boolean }) => unknown;
}) {
    const c = useCardSheet({ hours, noRefund }, onSave);
    const current = experienceCancellationOption(hours, noRefund);
    const draftKey = experienceCancellationOption(c.draft.hours, c.draft.noRefund).key;
    return (
        <>
            <EditorCard title="Cancellation policy" summary={current.label} onClick={c.start} />
            {c.open && (
                <EditorPanel title="Cancellation policy" onClose={c.close}
                    footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <p className="mb-3 text-xs text-slate-500">After the window it’s your call. Refunds always exclude the Galloway Getaways service fee.</p>
                    <div className="space-y-3">
                        {EXPERIENCE_CANCELLATION_OPTIONS.map((o) => {
                            const on = draftKey === o.key;
                            return (
                                <button key={o.key} type="button" onClick={() => c.setDraft({ hours: o.hours, noRefund: !!o.noRefund })}
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
                </EditorPanel>
            )}
        </>
    );
}

function HostProfileCard({ supabase, profTitle, years, quals, recognition, headshot, onSave }: {
    supabase: SupabaseClient;
    profTitle: string; years: string; quals: string; recognition: string; headshot: string | null;
    onSave: (draft: { profTitle: string; years: string; quals: string; recognition: string; headshot: string | null }) => unknown;
}) {
    const c = useCardSheet({ profTitle, years, quals, recognition, headshot }, onSave);
    const [uploading, setUploading] = useState(false);
    const change = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = (e.target.files || [])[0];
        e.target.value = '';
        if (!file) return;
        setUploading(true);
        const k = await uploadImage(supabase, file, 'headshot');
        if (k) c.setDraft({ ...c.draft, headshot: k });
        setUploading(false);
    };
    const summary = profTitle.trim() || (headshot ? 'Photo added' : 'Add your profile');
    return (
        <>
            <EditorCard title="Host profile" summary={summary} onClick={c.start} />
            {c.open && (
                <EditorPanel title="Host profile" onClose={c.close}
                    footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <div className="space-y-4">
                        <div>
                            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Your photo</span>
                            <p className="mt-0.5 text-xs text-slate-400">The person a guest is meeting — shown beside your name.</p>
                            <div className="mt-2 flex items-center gap-3">
                                {c.draft.headshot ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={getImageUrl(c.draft.headshot)} alt="" className="h-16 w-16 rounded-full object-cover ring-1 ring-slate-200" />
                                ) : (
                                    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400"><User className="h-6 w-6" /></span>
                                )}
                                <label className="cursor-pointer rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-500">
                                    {c.draft.headshot ? 'Replace' : 'Add a photo'}
                                    <input type="file" accept="image/png, image/jpeg" onChange={change} className="hidden" disabled={uploading} />
                                </label>
                                {c.draft.headshot && <button type="button" onClick={() => c.setDraft({ ...c.draft, headshot: null })} className="text-sm text-slate-500 hover:text-red-600">Remove</button>}
                            </div>
                        </div>
                        <Field label="Professional title"><input className={inputCls} value={c.draft.profTitle} onChange={(e) => c.setDraft({ ...c.draft, profTitle: e.target.value })} /></Field>
                        <Field label="Years of experience"><input className={inputCls} value={c.draft.years} onChange={(e) => c.setDraft({ ...c.draft, years: cleanAmountInput(e.target.value, false) })} placeholder="5" inputMode="numeric" /></Field>
                        <Field label="Qualifications"><AutoTextarea className={inputCls} rows={2} value={c.draft.quals} onChange={(e) => c.setDraft({ ...c.draft, quals: e.target.value })} /></Field>
                        <Field label="Recognition (optional)"><AutoTextarea className={inputCls} rows={2} value={c.draft.recognition} onChange={(e) => c.setDraft({ ...c.draft, recognition: e.target.value })} /></Field>
                    </div>
                </EditorPanel>
            )}
        </>
    );
}

function DietaryCard({ dietaryNote, onSave }: { dietaryNote: string; onSave: (v: string) => unknown }) {
    const c = useCardSheet(dietaryNote, onSave);
    return (
        <>
            <EditorCard title="Food & dietary" summary={dietaryNote.trim() || 'Add what you cater for'} onClick={c.start} />
            {c.open && (
                <EditorPanel title="Food & dietary" onClose={c.close}
                    footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <Field label="Dietary note" hint="What you can cater for.">
                        <AutoTextarea className={inputCls} rows={3} value={c.draft} onChange={(e) => c.setDraft(e.target.value)}
                            placeholder="Vegetarian and gluten-free on request; not a nut-free kitchen." />
                    </Field>
                </EditorPanel>
            )}
        </>
    );
}

function BookingCard({ isSlot, shape, maxGuests, leadDays, horizonDays, onSave }: {
    isSlot: boolean; shape: string;
    maxGuests: number; leadDays: number; horizonDays: number;
    onSave: (draft: { maxGuests: number; leadDays: number; horizonDays: number }) => unknown;
}) {
    const c = useCardSheet({ maxGuests, leadDays, horizonDays }, onSave);
    const hoursElsewhere = isSlot || shape === 'comes_to_you';
    const horizonLabel = BOOKING_HORIZON_OPTIONS.find((o) => o.days === horizonDays)?.label || `${horizonDays} days`;
    return (
        <>
            <EditorCard title="Booking" summary={`Up to ${maxGuests} · books ${horizonLabel.toLowerCase()} ahead`} onClick={c.start} />
            {c.open && (
                <EditorPanel title="Booking" onClose={c.close}
                    footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <div className="space-y-4">
                        <Field label="Maximum capacity" hint={isSlot ? 'The most people a session can take, as a default — a per-person item can set its own in “What you offer”.' : 'The most people you’ll take for one booking.'}>
                            <Stepper value={c.draft.maxGuests} onChange={(v) => c.setDraft({ ...c.draft, maxGuests: v })} min={1} max={60} />
                        </Field>
                        {!hoursElsewhere && (
                            <Field label="Notice needed" hint="How far ahead a guest has to book. The calendar won’t offer a date sooner than this.">
                                <OptionPills options={LEAD_TIME_OPTIONS.map((o) => ({ value: String(o.days), label: o.label }))}
                                    value={String(c.draft.leadDays)} onChange={(v) => c.setDraft({ ...c.draft, leadDays: Number(v) })} />
                            </Field>
                        )}
                        <Field label="How far ahead guests can book" hint="Beyond this, dates aren’t open yet — they come into range as time passes.">
                            <OptionPills options={BOOKING_HORIZON_OPTIONS.map((o) => ({ value: String(o.days), label: o.label }))}
                                value={String(c.draft.horizonDays)} onChange={(v) => c.setDraft({ ...c.draft, horizonDays: Number(v) })} />
                        </Field>
                        {hoursElsewhere && (
                            <p className="text-xs text-slate-500">Your booking times come from your weekly hours — set them under “{isSlot ? 'Availability' : 'Opening hours'}”.</p>
                        )}
                    </div>
                </EditorPanel>
            )}
        </>
    );
}

function AvailabilityCard({ isSlot, hours, slotLength, turnaround, leadDays, onSave }: {
    isSlot: boolean;
    hours: { on: boolean; open: string; close: string }[];
    slotLength: number; turnaround: number; leadDays: number;
    onSave: (draft: { hours: { on: boolean; open: string; close: string }[]; slotLength: number; turnaround: number; leadDays: number }) => unknown;
}) {
    const c = useCardSheet({ hours, slotLength, turnaround, leadDays }, onSave);
    const title = isSlot ? 'Availability' : 'Opening hours';
    const openDays = hours.map((h, d) => (h.on ? DAY_NAMES[d] : null)).filter(Boolean);
    const summary = openDays.length ? openDays.join(', ') : 'No hours set';
    const setHour = (d: number, patch: Partial<{ on: boolean; open: string; close: string }>) =>
        c.setDraft({ ...c.draft, hours: c.draft.hours.map((h, j) => (j === d ? { ...h, ...patch } : h)) });
    return (
        <>
            <EditorCard title={title} summary={summary} onClick={c.start} />
            {c.open && (
                <EditorPanel title={title} onClose={c.close}
                    footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <div className="space-y-4">
                        <div>
                            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Weekly hours</span>
                            <p className="mt-0.5 text-xs text-slate-400">A specific day off is set in your diary.</p>
                            <div className="mt-2 space-y-1.5">
                                {DAY_NAMES.map((name, d) => (
                                    <div key={d} className="flex items-center gap-3">
                                        <button type="button" onClick={() => setHour(d, { on: !c.draft.hours[d].on })}
                                            className={`w-16 rounded-lg border px-2 py-1.5 text-sm font-medium ${c.draft.hours[d].on ? 'border-emerald-700 bg-emerald-50 text-slate-900' : 'border-slate-300 text-slate-400'}`}>
                                            {name}
                                        </button>
                                        {c.draft.hours[d].on ? (
                                            <>
                                                <input type="time" value={c.draft.hours[d].open} onChange={(e) => setHour(d, { open: e.target.value })} className="rounded-lg border border-slate-300 p-1.5 text-sm" />
                                                <span className="text-slate-400">to</span>
                                                <input type="time" value={c.draft.hours[d].close} onChange={(e) => setHour(d, { close: e.target.value })} className="rounded-lg border border-slate-300 p-1.5 text-sm" />
                                            </>
                                        ) : <span className="text-sm text-slate-400">Closed</span>}
                                    </div>
                                ))}
                            </div>
                        </div>
                        <Field label="Notice needed" hint="How far ahead a guest has to book. The calendar won’t offer a date sooner than this.">
                            <OptionPills options={LEAD_TIME_OPTIONS.map((o) => ({ value: String(o.days), label: o.label }))}
                                value={String(c.draft.leadDays)} onChange={(v) => c.setDraft({ ...c.draft, leadDays: Number(v) })} />
                        </Field>
                        {isSlot && (
                            <>
                                <Field label="Session length" hint="How long one session runs.">
                                    <OptionPills options={SESSION_LENGTH_OPTIONS.map((m) => ({ value: String(m), label: minutesLabel(m) }))}
                                        value={String(c.draft.slotLength)} onChange={(v) => c.setDraft({ ...c.draft, slotLength: Number(v) })} />
                                </Field>
                                <Field label="Gap between sessions" hint="Time to reset before the next one can start.">
                                    <OptionPills options={TURNAROUND_OPTIONS.map((m) => ({ value: String(m), label: m === 0 ? 'None' : `${m} min` }))}
                                        value={String(c.draft.turnaround)} onChange={(v) => c.setDraft({ ...c.draft, turnaround: Number(v) })} />
                                </Field>
                            </>
                        )}
                        <Link href="/services/dashboard"
                            className="flex items-center justify-between gap-3 rounded-xl border border-slate-300 bg-slate-50 p-4 transition hover:border-slate-400">
                            <div className="flex items-start gap-3">
                                <CalendarRange className="mt-0.5 h-5 w-5 flex-none text-slate-500" />
                                <div>
                                    <div className="text-sm font-semibold text-slate-900">Blocking a specific day, or part of one?</div>
                                    <p className="text-xs text-slate-500">Those are exceptions to your weekly hours — set them in your diary.</p>
                                </div>
                            </div>
                            <span className="flex-none text-sm font-semibold text-emerald-700">Open diary →</span>
                        </Link>
                    </div>
                </EditorPanel>
            )}
        </>
    );
}

// Where it happens — how a guest reaches the experience, the private venue
// address (a guest only ever sees the town) and the regions a travelling
// provider covers. One save: the where section.
type WhereDraft = { fulfilment: string; street: string; town: string; postcode: string; deliveryFee: string; deliveryRadius: string; areas: string[] };
function WhereCard({ fixedInPlace, canTravel, current, onSave }: {
    fixedInPlace: boolean; canTravel: boolean; current: WhereDraft;
    onSave: (draft: WhereDraft) => unknown;
}) {
    const c = useCardSheet(current, onSave);
    const d = c.draft;
    const collects = d.fulfilment === 'collection' || d.fulfilment === 'both';
    const travels = d.fulfilment === 'delivery' || d.fulfilment === 'both';
    const ALL = GUEST_REGIONS.find((r) => r.key === GUEST_COVERAGE_ALL_KEY)!.label;
    const toggleRegion = (label: string, isAll: boolean) => {
        if (isAll) { c.setDraft({ ...d, areas: d.areas.includes(ALL) ? [] : [ALL] }); return; }
        const withoutAll = d.areas.filter((a) => a !== ALL);
        c.setDraft({ ...d, areas: withoutAll.includes(label) ? withoutAll.filter((a) => a !== label) : [...withoutAll, label] });
    };
    const title = fixedInPlace ? 'Address' : 'Where it happens';
    const summary = current.town.trim()
        ? current.town.trim()
        : (current.fulfilment === 'delivery' ? 'You travel to guests' : 'Add where it happens');
    const disabled = travels && Number(d.deliveryRadius) > 0 && !d.postcode.trim();
    return (
        <>
            <EditorCard title={title} summary={summary} onClick={c.start} />
            {c.open && (
                <EditorPanel title={title} onClose={c.close}
                    footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} disabled={disabled}
                        disabledLabel="Add your base postcode" />}>
                    <div className="space-y-4">
                        <p className="text-sm text-slate-500">Guests only ever see the town — the street and postcode stay private until a booking is confirmed.</p>
                        {canTravel ? (
                            <Field label="How guests get it">
                                <div className="space-y-2">
                                    {[
                                        { key: 'collection', label: 'Guests come to me', note: 'At your studio, sauna, kitchen — one place.' },
                                        { key: 'delivery', label: 'I travel to the guest', note: 'You go to where they’re staying.' },
                                        { key: 'both', label: 'Both', note: 'Guests can come to you, or you travel to them.' },
                                    ].map((o) => (
                                        <button key={o.key} type="button" onClick={() => c.setDraft({ ...d, fulfilment: o.key })}
                                            className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition ${d.fulfilment === o.key ? 'border-emerald-700 ring-2 ring-emerald-700 bg-emerald-50' : 'border-slate-300 hover:border-slate-400'}`}>
                                            <div className="font-semibold text-slate-900">{o.label}</div>
                                            <div className="text-xs text-slate-500">{o.note}</div>
                                        </button>
                                    ))}
                                </div>
                            </Field>
                        ) : (
                            <p className="text-sm text-slate-600">Guests come to you — this kind of experience happens in one place.</p>
                        )}

                        {collects && (
                            <div className="space-y-3">
                                <Field label="Street address (private)"><input className={inputCls} value={d.street} onChange={(e) => c.setDraft({ ...d, street: e.target.value })} placeholder="e.g. 18 Dovecroft" /></Field>
                                <div className="grid grid-cols-2 gap-3">
                                    <Field label="Town (shown to guests)"><input className={inputCls} value={d.town} onChange={(e) => c.setDraft({ ...d, town: e.target.value })} placeholder="Kirkcudbright" /></Field>
                                    <Field label="Postcode (private)"><input className={inputCls} value={d.postcode} onChange={(e) => c.setDraft({ ...d, postcode: e.target.value })} placeholder="DG6 4JS" /></Field>
                                </div>
                                <p className="text-xs text-slate-500">Guests see <span className="font-medium text-slate-700">{d.town.trim() || 'your town'}</span>. The street and postcode are released only when a booking is confirmed.</p>
                            </div>
                        )}

                        {travels && !collects && (
                            <Field label="Base postcode (private)" hint="A delivery distance is measured from here. Never shown to guests.">
                                <input className={inputCls} value={d.postcode} onChange={(e) => c.setDraft({ ...d, postcode: e.target.value })} placeholder="DG6 4JS" />
                            </Field>
                        )}

                        {travels && (
                            <div>
                                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Regions you travel to</span>
                                <p className="mt-0.5 text-xs text-slate-400">Pick the parts of Dumfries &amp; Galloway you’ll come to.</p>
                                <div className="mt-2 space-y-2">
                                    {GUEST_REGIONS.map((rg) => {
                                        const isAll = rg.key === GUEST_COVERAGE_ALL_KEY;
                                        const on = d.areas.includes(rg.label);
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

                        {travels && (
                            <Field label="Delivery fee" hint="A flat fee added once to a delivery order. Blank is free. Collection is always free.">
                                <div className="flex items-center gap-2">
                                    <span className="text-slate-500">£</span>
                                    <input className="w-28 rounded-lg border border-slate-300 p-2 text-sm" inputMode="decimal" placeholder="0.00"
                                        value={d.deliveryFee} onChange={(e) => c.setDraft({ ...d, deliveryFee: cleanAmountInput(e.target.value) })} />
                                </div>
                            </Field>
                        )}
                        {travels && (
                            <Field label="Delivery distance" hint="How far you’ll travel from your base. An order further than this is turned away before payment. Blank is no limit.">
                                <div className="flex items-center gap-2">
                                    <input className="w-28 rounded-lg border border-slate-300 p-2 text-sm" inputMode="decimal" placeholder="e.g. 10"
                                        value={d.deliveryRadius} onChange={(e) => c.setDraft({ ...d, deliveryRadius: cleanAmountInput(e.target.value) })} />
                                    <span className="text-slate-500">miles</span>
                                </div>
                            </Field>
                        )}
                    </div>
                </EditorPanel>
            )}
        </>
    );
}

// ── What you offer (the menu) ────────────────────────────────────────────────
type MenuRow = { id?: string; name: string; description: string; price: string; unit: string; image: string | null; duration: string; fulfilment: string | null; active: boolean; capacity: string; minPeople: string; includedGuests: string; extraAdultFee: string; extraChildFee: string; maxParty: string; isCustom: boolean; ingredients: string; allergens: string; category: string };

function rowFromItem(it: EditorProvider['items'][number]): MenuRow {
    return {
        id: it.id, name: it.name, description: it.description, price: amountForBox(it.price),
        unit: it.unit, image: it.image, duration: it.duration_minutes != null ? String(it.duration_minutes) : '',
        fulfilment: it.fulfilment, active: it.active,
        capacity: it.capacity != null ? String(it.capacity) : '',
        minPeople: it.min_people != null ? String(it.min_people) : '',
        includedGuests: it.included_guests != null ? String(it.included_guests) : '',
        extraAdultFee: amountForBox(it.extra_adult_fee ?? null),
        extraChildFee: amountForBox(it.extra_child_fee ?? null),
        maxParty: it.max_party != null ? String(it.max_party) : '',
        isCustom: !!it.is_custom,
        ingredients: it.ingredients || '',
        allergens: it.allergens || '',
        category: it.category || '',
    };
}

function MenuCard({ supabase, isSlot, shape, fulfilment, minAge, maxGuests, items, onSave }: {
    supabase: SupabaseClient;
    isSlot: boolean; shape: string; fulfilment: string; minAge: string; maxGuests: number;
    items: EditorProvider['items'];
    onSave: (rows: MenuRow[]) => unknown;
}) {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [menu, setMenu] = useState<MenuRow[]>(items.map(rowFromItem));
    const start = () => { setMenu(items.map(rowFromItem)); setOpen(true); };
    const close = () => setOpen(false);
    const save = async () => {
        if (busy) return;
        setBusy(true);
        try { if (await saved(onSave(menu))) setOpen(false); } finally { setBusy(false); }
    };
    const setRow = (i: number, patch: Partial<MenuRow>) => setMenu((m) => m.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    const changeImage = async (i: number, e: React.ChangeEvent<HTMLInputElement>) => {
        const file = (e.target.files || [])[0];
        e.target.value = '';
        if (!file) return;
        setUploading(true);
        const k = await uploadImage(supabase, file, 'item');
        if (k) setRow(i, { image: k });
        setUploading(false);
    };
    const priced = items.filter((it) => it.active && it.name.trim() && Number(it.price) > 0);
    const summary = items.length
        ? `${priced.length || items.length} ${(priced.length || items.length) === 1 ? 'item' : 'items'}${priced[0] ? ' · ' + priced[0].name : ''}`
        : 'Add what guests book';
    const perItemLocation = isSlot && fulfilment === 'both';

    return (
        <>
            <EditorCard title="What you offer" summary={summary} onClick={start} />
            {open && (
                <EditorPanel title="What you offer" onClose={close}
                    footer={<SheetFooter busy={busy} onCancel={close} onSave={save} />}>
                    <div className="space-y-4">
                        <p className="text-sm text-slate-500">What a guest books, with a price.{isSlot ? ' A slot prices per person or as a whole session.' : ''}</p>
                        {!menu.some((r) => r.active && r.name.trim() && Number(r.price) > 0) && (
                            <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                                <Check className="mt-0.5 h-4 w-4 flex-none" />
                                You have no priced item. Until you add one, your listing can’t be booked and won’t appear.
                            </div>
                        )}
                        {menu.map((r, i) => (
                            <div key={r.id || `new-${i}`} className="rounded-xl border border-slate-200 p-4">
                                <div className="flex items-start gap-4">
                                    <label className="group relative flex-none cursor-pointer">
                                        {r.image ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={getImageUrl(r.image)} alt="" className="h-24 w-24 rounded-2xl object-cover ring-1 ring-slate-200" />
                                        ) : (
                                            <span className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-slate-300 text-slate-400">
                                                <ImageIcon className="h-6 w-6" />
                                                <span className="text-xs font-medium">Add photo</span>
                                            </span>
                                        )}
                                        {r.image && <span className="absolute inset-x-0 bottom-0 rounded-b-2xl bg-black/45 py-1 text-center text-[11px] font-semibold text-white opacity-0 transition group-hover:opacity-100">Change</span>}
                                        <input type="file" accept="image/png, image/jpeg" onChange={(e) => changeImage(i, e)} className="hidden" disabled={uploading} />
                                    </label>
                                    <div className="flex-1 space-y-3">
                                        <input className={inputCls} placeholder="Name (e.g. 90-minute private sauna)" value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} />
                                        {perItemLocation && (
                                            <div>
                                                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">This one happens</span>
                                                <div className="mt-1 flex gap-2">
                                                    <button type="button" onClick={() => setRow(i, { fulfilment: 'collection' })}
                                                        className={`rounded-xl border px-3 py-2 text-sm transition ${(r.fulfilment || 'collection') === 'collection' ? 'border-emerald-700 bg-emerald-50 text-slate-900' : 'border-slate-300 text-slate-700 hover:border-slate-400'}`}>At my place</button>
                                                    <button type="button" onClick={() => setRow(i, { fulfilment: 'delivery', unit: 'flat' })}
                                                        className={`rounded-xl border px-3 py-2 text-sm transition ${r.fulfilment === 'delivery' ? 'border-emerald-700 bg-emerald-50 text-slate-900' : 'border-slate-300 text-slate-700 hover:border-slate-400'}`}>I travel to them</button>
                                                </div>
                                            </div>
                                        )}
                                        <div className="flex flex-wrap gap-3">
                                            <label className="flex items-center gap-1 rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus-within:border-slate-500">
                                                <span className="text-slate-500">£</span>
                                                <input className="w-20 border-0 bg-transparent p-0 text-sm outline-none" type="text" inputMode="decimal" placeholder="0"
                                                    value={r.price} onChange={(e) => setRow(i, { price: cleanAmountInput(e.target.value) })} />
                                            </label>
                                            {perItemLocation && r.fulfilment === 'delivery' ? (
                                                <span className="flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500">Whole session — private, you travel</span>
                                            ) : (
                                                <select className="rounded-xl border border-slate-300 p-2.5 text-sm" value={r.unit} onChange={(e) => setRow(i, { unit: e.target.value })}>
                                                    <option value="flat">whole session</option>
                                                    <option value="person">per person</option>
                                                    {!isSlot && <option value="hour">per hour</option>}
                                                    {!isSlot && <option value="night">per night</option>}
                                                    {!isSlot && <option value="ticket">per ticket</option>}
                                                    {!isSlot && <option value="item">per item</option>}
                                                </select>
                                            )}
                                            {isSlot && (
                                                <label className="flex items-center gap-1 text-sm text-slate-500">
                                                    <input className="w-20 rounded-xl border border-slate-300 p-2.5 text-sm" type="text" inputMode="numeric" placeholder="mins" value={r.duration} onChange={(e) => setRow(i, { duration: cleanAmountInput(e.target.value, false) })} />
                                                    <span>min</span>
                                                </label>
                                            )}
                                        </div>
                                        {isSlot && r.unit === 'person' && (
                                            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-3">
                                                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Capacity</span>
                                                <span className="flex items-center gap-1">
                                                    <input className="w-20 rounded-lg border border-slate-300 p-2 text-sm" type="text" inputMode="numeric" placeholder={String(maxGuests)} value={r.capacity} onChange={(e) => setRow(i, { capacity: cleanAmountInput(e.target.value, false) })} />
                                                    <span className="text-slate-500 text-sm">people</span>
                                                </span>
                                                <span className="w-full text-xs text-slate-400">Blank uses your default of {maxGuests}.</span>
                                            </div>
                                        )}
                                        {!isSlot && r.unit === 'person' && (
                                            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-3">
                                                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Smallest party</span>
                                                <span className="flex items-center gap-1">
                                                    <input className="w-20 rounded-lg border border-slate-300 p-2 text-sm" type="text" inputMode="numeric" placeholder="1" value={r.minPeople} onChange={(e) => setRow(i, { minPeople: cleanAmountInput(e.target.value, false) })} />
                                                    <span className="text-slate-500 text-sm">guests</span>
                                                </span>
                                                <span className="w-full text-xs text-slate-400">The fewest you’ll take for this. Blank means one is fine.</span>
                                            </div>
                                        )}
                                        {r.unit === 'flat' && (
                                            <div className="space-y-2 rounded-xl bg-slate-50 p-3">
                                                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Extra guests (optional)</span>
                                                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-600">
                                                    <label className="flex items-center gap-1">Includes
                                                        <input className="w-16 rounded-lg border border-slate-300 p-2 text-sm" type="text" inputMode="numeric" placeholder="—" value={r.includedGuests} onChange={(e) => setRow(i, { includedGuests: cleanAmountInput(e.target.value, false) })} /> guests</label>
                                                    <label className="flex items-center gap-1">+£
                                                        <input className="w-16 rounded-lg border border-slate-300 p-2 text-sm" type="text" inputMode="decimal" placeholder="0" value={r.extraAdultFee} onChange={(e) => setRow(i, { extraAdultFee: cleanAmountInput(e.target.value) })} /> per extra adult</label>
                                                    {childrenAllowed(Number(minAge) || null) && (
                                                        <label className="flex items-center gap-1">+£
                                                            <input className="w-16 rounded-lg border border-slate-300 p-2 text-sm" type="text" inputMode="decimal" placeholder="0" value={r.extraChildFee} onChange={(e) => setRow(i, { extraChildFee: cleanAmountInput(e.target.value) })} /> per extra child</label>
                                                    )}
                                                    <label className="flex items-center gap-1">Max party
                                                        <input className="w-16 rounded-lg border border-slate-300 p-2 text-sm" type="text" inputMode="numeric" placeholder="—" value={r.maxParty} onChange={(e) => setRow(i, { maxParty: cleanAmountInput(e.target.value, false) })} /></label>
                                                </div>
                                                <span className="block text-xs text-slate-400">Leave blank for one flat price. The price never drops below the base.</span>
                                            </div>
                                        )}
                                        {shape === 'made_to_order' && (
                                            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3">
                                                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">This item is</span>
                                                <button type="button" onClick={() => setRow(i, { isCustom: false })}
                                                    className={`rounded-full border px-3 py-1.5 text-sm transition ${!r.isCustom ? 'border-emerald-700 bg-emerald-50 text-slate-900' : 'border-slate-300 text-slate-600 hover:border-slate-400'}`}>Standard — books instantly</button>
                                                <button type="button" onClick={() => setRow(i, { isCustom: true })}
                                                    className={`rounded-full border px-3 py-1.5 text-sm transition ${r.isCustom ? 'border-emerald-700 bg-emerald-50 text-slate-900' : 'border-slate-300 text-slate-600 hover:border-slate-400'}`}>Custom — you approve first</button>
                                            </div>
                                        )}
                                        {shape === 'made_to_order' && (
                                            <label className="block">
                                                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Menu section <span className="font-normal normal-case tracking-normal text-slate-400">(optional, e.g. Cakes)</span></span>
                                                <input className={inputCls} maxLength={60} placeholder="e.g. Cakes" value={r.category} onChange={(e) => setRow(i, { category: e.target.value })} />
                                            </label>
                                        )}
                                        <AutoTextarea className={inputCls} rows={2} placeholder="Description (optional)" value={r.description} onChange={(e) => setRow(i, { description: e.target.value })} />
                                        {shape === 'made_to_order' && (
                                            <div className="space-y-2 rounded-xl bg-slate-50 p-3">
                                                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Ingredients &amp; allergens <span className="font-normal normal-case tracking-normal text-slate-400">(optional — shown on the menu’s info icon)</span></span>
                                                <AutoTextarea className={inputCls} rows={2} placeholder="Ingredients, e.g. Wheat flour, butter, eggs, sugar, Galloway raspberries" value={r.ingredients} onChange={(e) => setRow(i, { ingredients: e.target.value })} />
                                                <AutoTextarea className={inputCls} rows={2} placeholder="Allergens, e.g. Contains wheat, egg, milk. Made in a kitchen that handles nuts." value={r.allergens} onChange={(e) => setRow(i, { allergens: e.target.value })} />
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="mt-3 flex items-center justify-between">
                                    <button type="button" onClick={() => setRow(i, { active: !r.active })}
                                        className={`text-xs font-semibold ${r.active ? 'text-emerald-700' : 'text-slate-400'}`}>{r.active ? 'Active' : 'Hidden'}</button>
                                    <button type="button" onClick={() => setMenu((m) => m.filter((_, j) => j !== i))} className="text-xs text-slate-500 hover:text-red-600">Remove</button>
                                </div>
                            </div>
                        ))}
                        <button type="button" onClick={() => setMenu((m) => [...m, { name: '', description: '', price: '', unit: 'flat', image: null, duration: isSlot ? '60' : '', fulfilment: (isSlot && fulfilment === 'both') ? 'collection' : null, active: true, capacity: '', minPeople: '', includedGuests: '', extraAdultFee: '', extraChildFee: '', maxParty: '', isCustom: false, ingredients: '', allergens: '', category: '' }])}
                            className="text-sm font-semibold text-emerald-700 hover:text-emerald-800">+ Add an item</button>
                    </div>
                </EditorPanel>
            )}
        </>
    );
}

// ── The editor ───────────────────────────────────────────────────────────────

export default function ProviderListingEditor({ provider }: { provider: EditorProvider }) {
    const [p] = useState(provider);
    const supabase = createClientComponentClient();
    const [active, setActive] = useState<NavKey>('experience');
    const [paused, setPaused] = useState(provider.owner_paused);
    const [pausing, setPausing] = useState(false);

    // On a phone the editor is one continuous page with a sticky tab bar; on
    // desktop the chosen section only, beside a sticky list. Decided in JS so a
    // card is mounted once.
    const [isPhone, setIsPhone] = useState(false);
    useEffect(() => {
        const mq = window.matchMedia('(max-width: 767px)');
        const sync = () => setIsPhone(mq.matches);
        sync();
        mq.addEventListener('change', sync);
        return () => mq.removeEventListener('change', sync);
    }, []);
    const shows = (key: NavKey) => isPhone || active === key;

    // Committed values. Each card holds its own draft and, on Save, writes the
    // section then applies the draft here.
    const [businessName, setBusinessName] = useState(p.business_name);
    const [profTitle, setProfTitle] = useState(p.professional_title);
    const [years, setYears] = useState(p.years_experience);
    const [quals, setQuals] = useState(p.qualifications);
    const [recognition, setRecognition] = useState(p.recognition);
    const [headshot, setHeadshot] = useState<string | null>(p.headshot);
    const [whatToExpect, setWhatToExpect] = useState(p.what_to_expect);
    const phaseDetail = (i: number) => (p.itinerary[i]?.detail) || '';
    const [phases, setPhases] = useState<[string, string, string]>([phaseDetail(0), phaseDetail(1), phaseDetail(2)]);
    const [minAge, setMinAge] = useState(p.min_age != null ? String(p.min_age) : '');
    const [activity, setActivity] = useState(p.activity_level);
    const [whatToBring, setWhatToBring] = useState(p.what_to_bring);
    const [accessibility, setAccessibility] = useState(p.accessibility);
    const [parking, setParking] = useState(p.parking);
    const [amenities, setAmenities] = useState<string[]>(p.amenities || []);
    const [dietaryNote, setDietaryNote] = useState(p.dietary_note);
    const [cancelHours, setCancelHours] = useState(Number(p.cancellation_window_hours ?? 48));
    const [noRefund, setNoRefund] = useState(p.no_refund);

    const [hours, setHours] = useState(() => DAY_NAMES.map((_, d) => {
        const row = p.availability.find((a) => a.day_of_week === d);
        return { on: !!row, open: row?.open_time || '09:00', close: row?.close_time || '17:00' };
    }));
    const [slotLength, setSlotLength] = useState(p.slot_length_minutes != null ? Number(p.slot_length_minutes) : 60);
    const [turnaround, setTurnaround] = useState(Number(p.slot_turnaround_minutes || 0));
    const [leadDays, setLeadDays] = useState(Math.max(0, Number(p.lead_time_days || 0)));
    const [horizonDays, setHorizonDays] = useState(Math.max(1, Number(p.booking_horizon_days || 90)));

    // Where it happens. Fixed-in-place categories (a sauna, a tasting) never
    // offer travel; only the yoga/massage/painting kind genuinely goes either way.
    const fixedInPlace = p.isSlot && !!p.category && p.category !== 'other' && !slotAsksWhereFork(p.category);
    const canTravel = !fixedInPlace;
    const [fulfilment, setFulfilment] = useState(fixedInPlace ? 'collection' : (p.fulfilment || 'collection'));
    const [street, setStreet] = useState(p.collection_street);
    const [town, setTown] = useState(p.collection_town);
    const [postcode, setPostcode] = useState(p.collection_postcode);
    const [deliveryFee, setDeliveryFee] = useState(amountForBox(p.delivery_fee));
    const [deliveryRadius, setDeliveryRadius] = useState(amountForBox(p.delivery_radius_miles));
    const [areas, setAreas] = useState<string[]>(p.areas);

    const initialMaxGroup = p.isSlot ? p.slot_capacity : p.max_guests;
    const [maxGuests, setMaxGuests] = useState<number>(initialMaxGroup && initialMaxGroup > 0 ? initialMaxGroup : (p.isSlot ? 8 : 6));

    const [items, setItems] = useState<EditorProvider['items']>(p.items);
    const [photos, setPhotos] = useState<string[]>(p.photos);
    const photosRef = useRef<string[]>(p.photos);
    const [logo] = useState<string | null>(p.logo);

    // One write of one section. No "Saved" pop-up — the sheet closing is the
    // confirmation (Airbnb's way); only a failure says anything.
    const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
    const write = async (section: string, data: any): Promise<boolean> => {
        try {
            const res = await fetch('/api/services/listing/save', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ providerId: p.id, section, data }),
            });
            const json = await res.json().catch(() => null);
            if (!json || !json.ok) { toast.error((json && json.error) || 'Could not save', { theme: 'colored' }); return false; }
            return true;
        } catch (err: any) {
            toast.error(err?.message || 'Could not save', { theme: 'colored' });
            return false;
        }
    };
    const run = (section: string, data: any): Promise<boolean> => {
        const next = saveQueue.current.then(() => write(section, data), () => write(section, data));
        saveQueue.current = next;
        return next;
    };
    // Write a section, and apply the draft to committed state only if it went through.
    const runThen = (section: string, data: any, apply: () => void) =>
        run(section, data).then((ok) => { if (ok) apply(); return ok; });

    // Photos save as Airbnb's do — each add / reorder / delete is written at
    // once and put back if the write fails (reusing the holiday editor's flow).
    const savePhotos: SavePhotos = (change) => {
        const before = photosRef.current;
        const next = change(before);
        photosRef.current = next;
        setPhotos(next);
        return run('photos', { photos: next, logo }).then((ok) => {
            if (!ok && photosRef.current === next) { photosRef.current = before; setPhotos(before); }
            return ok;
        });
    };

    async function togglePaused() {
        setPausing(true);
        const next = !paused;
        const ok = await savePaused(p.id, next);
        if (ok) setPaused(next);
        setPausing(false);
    }

    const headings = stepHeadings(p.shape, fulfilment);

    // What's still empty — surfaced, never blocking. Read from live state so it
    // clears as sections are filled in.
    const missing: string[] = [];
    if (!headshot) missing.push('a photo of yourself');
    if (!photos.length) missing.push('photos of the experience');
    if (!whatToExpect.trim()) missing.push('what happens');
    if (!phases.some((d) => d.trim())) missing.push('the flow');
    if (!whatToBring.trim()) missing.push('what to bring');
    if (!minAge) missing.push('a minimum age');
    if (!activity.trim()) missing.push('the activity level');

    const hasHours = p.isSlot || p.shape === 'comes_to_you';
    const SECTIONS: { key: NavKey; label: string; short: string; icon: any }[] = [
        { key: 'experience', label: 'The experience', short: 'Experience', icon: FileText },
        { key: 'photos', label: 'Photos', short: 'Photos', icon: ImageIcon },
        { key: 'included', label: 'What’s included', short: 'Included', icon: Sparkles },
        { key: 'know', label: 'Good to know', short: 'Good to know', icon: Info },
        { key: 'where', label: fixedInPlace ? 'Address' : 'Location', short: fixedInPlace ? 'Address' : 'Location', icon: MapPin },
        ...(hasHours ? [{ key: 'availability' as NavKey, label: p.isSlot ? 'Availability' : 'Opening hours', short: p.isSlot ? 'Availability' : 'Hours', icon: CalendarRange }] : []),
        { key: 'pricing', label: 'Pricing & booking', short: 'Pricing', icon: ShoppingBag },
        { key: 'cancellation', label: 'Cancellation', short: 'Cancellation', icon: RotateCcw },
        { key: 'host', label: 'Host profile', short: 'Host', icon: User },
        ...(p.isFood ? [{ key: 'dietary' as NavKey, label: 'Food & dietary', short: 'Food', icon: Salad }] : []),
        { key: 'status', label: 'Listing status', short: 'Status', icon: (paused || p.admin_hidden) ? EyeOff : Eye },
    ];

    // On a phone each section is a block the tab bar can scroll to, under its
    // heading. Photos and Status carry their own heading, so they don't get one.
    // A plain function (not a component) so a parent re-render never remounts an
    // open card's sheet.
    const OWN_HEADING = new Set<NavKey>(['photos', 'status']);
    const sec = (id: NavKey, children: React.ReactNode) => {
        if (!shows(id)) return null;
        const label = SECTIONS.find((s) => s.key === id)?.label;
        const heading = !OWN_HEADING.has(id) && <h2 className="text-xl font-bold text-slate-900">{label}</h2>;
        return isPhone
            ? <div data-editor-section={id} className="mt-14 space-y-4 first:mt-0">{heading}{children}</div>
            : <div className="space-y-4">{heading}{children}</div>;
    };

    return (
        <div className="mx-auto w-full max-w-5xl px-5 py-8">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-extrabold text-emerald-800">Edit your listing</h1>
                    <p className="mt-1 text-sm text-slate-500">Change a section and it saves itself — no need to run through everything again.</p>
                </div>
                <Link href={`/experiences/browse/${p.id}`} target="_blank"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:border-slate-500">
                    <ExternalLink className="h-4 w-4" /> View listing
                </Link>
            </div>

            <TakenDownBanner paused={paused} adminHidden={p.admin_hidden} pausing={pausing} onPutBack={togglePaused} who="guests" />

            {hasHours && p.availability.length === 0 && !paused && (
                <div className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 p-4">
                    <div className="font-semibold text-amber-900">You’re not bookable yet — add your weekly hours</div>
                    <p className="mt-1 text-sm text-amber-900/80">
                        Guests book a time from your weekly hours. Until you set them, your listing generates no times and won’t appear in the marketplace.
                    </p>
                    <button type="button" onClick={() => (isPhone ? goToEditorSection('availability') : setActive('availability'))}
                        className="mt-3 rounded-md bg-amber-700 px-3 py-2 text-sm font-medium text-white">Set your hours</button>
                </div>
            )}

            {missing.length > 0 && (
                <div className="mb-6 rounded-2xl border border-sky-200 bg-sky-50 p-4">
                    <div className="text-sm font-semibold text-sky-900">Your listing is missing a few things</div>
                    <p className="mt-1 text-sm text-sky-800">None of these stop it going live, but a fuller listing gets booked more. Still to add: {missing.join(', ')}.</p>
                </div>
            )}

            {isPhone && <PhoneSectionTabs sections={SECTIONS.map(({ key, short }) => ({ key, label: short }))} initial={active} />}

            <div className="grid grid-cols-1 gap-8 md:grid-cols-[220px_1fr]">
                {!isPhone && (
                    <nav className="space-y-1 md:sticky md:top-24 md:self-start">
                        {SECTIONS.map(({ key, label, icon: Icon }) => (
                            <button key={key} type="button" onClick={() => { setActive(key); requestAnimationFrame(() => window.scrollTo({ top: 0 })); }}
                                className={`flex w-full items-center rounded-xl px-3 py-2.5 text-sm font-medium transition ${active === key ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}>
                                <Icon className="mr-3 h-4 w-4" /> {label}
                            </button>
                        ))}
                    </nav>
                )}

                <div className="min-w-0 space-y-6">
                    {sec('experience', (<>
                        <TitleCard value={businessName}
                            onSave={(v) => runThen('title', { business_name: v }, () => setBusinessName(v))} />
                        <WhatHappensCard whatToExpect={whatToExpect} phases={phases} headings={headings}
                            onSave={(d) => runThen('happens', {
                                what_to_expect: d.whatToExpect,
                                itinerary: headings.map((h, i) => ({ title: h.title, detail: d.phases[i] })),
                            }, () => { setWhatToExpect(d.whatToExpect); setPhases(d.phases); })} />
                    </>))}

                    {sec('photos', (
                        isPhone
                            ? <PhotosCard photos={photos} savePhotos={savePhotos} />
                            : <PhotosEditor photos={photos} savePhotos={savePhotos} isPhone={false} />
                    ))}

                    {sec('included', (
                        <WhatsIncludedCard amenities={amenities} accessibility={accessibility} parking={parking}
                            onSave={(d) => runThen('amenities', { amenities: d.amenities, accessibility: d.accessibility, parking: d.parking },
                                () => { setAmenities(d.amenities); setAccessibility(d.accessibility); setParking(d.parking); })} />
                    ))}

                    {sec('know', (
                        <GoodToKnowCard minAge={minAge} activity={activity} whatToBring={whatToBring}
                            onSave={(d) => runThen('things', { min_age: d.minAge, activity_level: d.activity, what_to_bring: d.whatToBring },
                                () => { setMinAge(d.minAge); setActivity(d.activity); setWhatToBring(d.whatToBring); })} />
                    ))}

                    {sec('where', (
                        <WhereCard fixedInPlace={fixedInPlace} canTravel={canTravel}
                            current={{ fulfilment, street, town, postcode, deliveryFee, deliveryRadius, areas }}
                            onSave={(d) => {
                                const travels = d.fulfilment === 'delivery' || d.fulfilment === 'both';
                                return runThen('where', {
                                    fulfilment: d.fulfilment,
                                    collection_street: d.street, collection_town: d.town, collection_postcode: d.postcode,
                                    delivery_fee: travels ? d.deliveryFee : 0,
                                    delivery_radius_miles: travels ? d.deliveryRadius : 0,
                                    areas: travels ? d.areas : [],
                                }, () => { setFulfilment(d.fulfilment); setStreet(d.street); setTown(d.town); setPostcode(d.postcode); setDeliveryFee(d.deliveryFee); setDeliveryRadius(d.deliveryRadius); setAreas(d.areas); });
                            }} />
                    ))}

                    {hasHours && sec('availability', (
                        <AvailabilityCard isSlot={p.isSlot} hours={hours} slotLength={slotLength} turnaround={turnaround} leadDays={leadDays}
                            onSave={(d) => runThen('availability', {
                                slot_length_minutes: d.slotLength, slot_turnaround_minutes: d.turnaround, lead_time_days: d.leadDays,
                                availability: d.hours.map((h, day) => ({ ...h, day_of_week: day }))
                                    .filter((h) => h.on && h.open && h.close && h.open < h.close)
                                    .map((h) => ({ day_of_week: h.day_of_week, open_time: h.open, close_time: h.close })),
                            }, () => { setHours(d.hours); setSlotLength(d.slotLength); setTurnaround(d.turnaround); setLeadDays(d.leadDays); })} />
                    ))}

                    {sec('pricing', (<>
                        <MenuCard supabase={supabase} isSlot={p.isSlot} shape={p.shape} fulfilment={fulfilment} minAge={minAge} maxGuests={maxGuests} items={items}
                            onSave={(rows) => runThen('menu', {
                                items: rows.map((r) => ({
                                    id: r.id, name: r.name, description: r.description, price: r.price,
                                    unit: r.unit, image: r.image, duration_minutes: r.duration,
                                    fulfilment: r.fulfilment, active: r.active,
                                    capacity: r.capacity, min_people: r.minPeople,
                                    included_guests: r.includedGuests, extra_adult_fee: r.extraAdultFee,
                                    extra_child_fee: r.extraChildFee, max_party: r.maxParty,
                                    is_custom: r.isCustom, ingredients: r.ingredients, allergens: r.allergens, category: r.category,
                                })),
                            }, () => setItems(rows.filter((r) => r.name.trim() && Number(r.price) > 0).map((r) => ({
                                id: r.id || `tmp-${generateRandomNumber()}`, name: r.name, description: r.description,
                                price: Number(r.price) || 0, unit: r.unit, image: r.image,
                                duration_minutes: r.duration ? Number(r.duration) : null, fulfilment: r.fulfilment, active: r.active,
                                capacity: r.capacity ? Number(r.capacity) : null, min_people: r.minPeople ? Number(r.minPeople) : null,
                                included_guests: r.includedGuests ? Number(r.includedGuests) : null,
                                extra_adult_fee: r.extraAdultFee ? Number(r.extraAdultFee) : null,
                                extra_child_fee: r.extraChildFee ? Number(r.extraChildFee) : null,
                                max_party: r.maxParty ? Number(r.maxParty) : null,
                                is_custom: r.isCustom, ingredients: r.ingredients || null, allergens: r.allergens || null, category: r.category || null,
                            })))) } />
                        <BookingCard isSlot={p.isSlot} shape={p.shape} maxGuests={maxGuests} leadDays={leadDays} horizonDays={horizonDays}
                            onSave={(d) => runThen('booking', { max_guests: d.maxGuests, lead_time_days: d.leadDays, booking_horizon_days: d.horizonDays },
                                () => { setMaxGuests(d.maxGuests); setLeadDays(d.leadDays); setHorizonDays(d.horizonDays); })} />
                    </>))}

                    {sec('cancellation', (
                        <CancellationCard hours={cancelHours} noRefund={noRefund}
                            onSave={(d) => runThen('cancellation', { cancellation_window_hours: d.hours, no_refund: !!d.noRefund },
                                () => { setCancelHours(d.hours); setNoRefund(d.noRefund); })} />
                    ))}

                    {sec('host', (
                        <HostProfileCard supabase={supabase} profTitle={profTitle} years={years} quals={quals} recognition={recognition} headshot={headshot}
                            onSave={(d) => runThen('about', {
                                professional_title: d.profTitle, years_experience: d.years, qualifications: d.quals, recognition: d.recognition, headshot: d.headshot,
                            }, () => { setProfTitle(d.profTitle); setYears(d.years); setQuals(d.quals); setRecognition(d.recognition); setHeadshot(d.headshot); })} />
                    ))}

                    {p.isFood && sec('dietary', (
                        <DietaryCard dietaryNote={dietaryNote}
                            onSave={(v) => runThen('dietary', { dietary_note: v, dietary_options: p.dietary_options }, () => setDietaryNote(v))} />
                    ))}

                    {sec('status', (
                        <ListingStatusSection paused={paused} adminHidden={p.admin_hidden} pausing={pausing} onToggle={togglePaused} who="guests" />
                    ))}
                </div>
            </div>
        </div>
    );
}
