'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'react-toastify';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { getImageUrl } from '@/lib/utils';
import { GUEST_REGIONS, GUEST_COVERAGE_ALL_KEY } from '@/lib/strings';
import { stepHeadings } from '@/lib/experienceSteps';
import { slotAsksWhereFork, slotDurationPerItem, ACCESSIBILITY_OPTIONS, PARKING_OPTIONS, EXPERIENCE_CANCELLATION_OPTIONS, experienceCancellationOption, EXPERIENCE_AMENITY_GROUPS } from '@/lib/serviceProviders';
import AutoTextarea from '@/components/AutoTextarea';
import { cleanAmountInput, amountForBox } from '@/lib/amountInput';
import { EditorCard, EditorPanel, saved } from '@/components/listing-editor/EditorPanel';
import { AddressCard, LocationSharingCard } from '@/components/listing-editor/LocationCards';
import PropertyMap from '@/components/PropertyMap';
import PhotosEditor, { PhotosCard, type SavePhotos } from '@/components/listing-editor/PhotosEditor';
import PhoneSectionTabs, { goToEditorSection } from '@/components/listing-editor/PhoneSectionTabs';
import { OptionPills, Stepper, SESSION_LENGTH_OPTIONS, minutesLabel } from './editorControls';
import { NumberStepper, BigTextInput, ChoiceTiles, wizardAreaCls } from './wizardKit';
import { QuestionSheetContext } from '@/components/listing-editor/questionSheets';
import { Field, SheetFooter, useCardSheet, inputCls } from './editorSheet';
import { AddItemFlow, ItemDetailCard, rowFromItem, uploadImage, priceRowValid, type MenuRow, type ItemCtx } from './ExperienceItemEditor';
import { chargeUnitsFor, needsCapacity } from '@/lib/pricingUnits';
import { SinglePhotoSheet } from './SinglePhotoSheet';
import type { SupabaseClient } from '@supabase/supabase-js';
import { savePaused, TakenDownBanner } from '@/components/services/ListingPauseControl';
import {
    FileText, User, Info, Salad, Image as ImageIcon,
    ShoppingBag, MapPin, CalendarRange, Sparkles, RotateCcw,
    Eye, EyeOff, ExternalLink, Check, Trash2,
} from 'lucide-react';

// The guest-experience listing editor, on the same shape as the holiday-let
// editor (app/edit-listing): the sections grouped the way Airbnb's experience
// host editor groups them, each a raised card opening a full-screen sheet with
// Save and Cancel. EVERY CARD SAVES ITSELF through /api/services/listing/save —
// no page Save, no "Saved" pop-up, only a failure speaks. Phone: one page with
// a sticky tab bar. Desktop: the sticky left-hand list.
//
// The save route and every section payload are unchanged, so saving and booking
// behave exactly as before. Where several cards write one section, each sends it
// whole (its field from the sheet, the rest from state) so one never wipes a
// sibling.

export interface EditorProvider {
    id: string; shape: string; isSlot: boolean; isFood: boolean;
    vat_registered: boolean;
    commission_rate: number;
    business_name: string; category_label: string; category: string; description: string;
    status: string; owner_paused: boolean; admin_hidden: boolean;
    photos: string[]; headshot: string | null; logo: string | null;
    dietary_note: string; fulfilment: string; delivery_fee: number; delivery_radius_miles: number;
    collection_street: string; collection_town: string; collection_postcode: string;
    venue_lat: number | null; venue_lng: number | null; show_precise_location: boolean;
    slot_length_minutes: number | null; slot_turnaround_minutes: number;
    slot_capacity: number | null; max_guests: number | null;
    lead_time_days: number; cancellation_window_hours: number; booking_horizon_days: number;
    offered_times: string[];
    professional_title: string; years_experience: string; qualifications: string; recognition: string;
    what_to_expect: string; itinerary: Array<{ title?: string | null; detail?: string | null }>;
    min_age: number | null; activity_level: string; what_to_bring: string;
    accessibility: string; parking: string; no_refund: boolean;
    amenities: string[];
    dietary_options: string[];
    areas: string[];
    items: Array<{ id: string; name: string; description: string; price: number; group_price?: number | null; unit: string; image: string | null; duration_minutes: number | null; fulfilment: string | null; active: boolean; capacity: number | null; min_people: number | null; included_guests?: number | null; extra_adult_fee?: number | null; extra_child_fee?: number | null; max_party?: number | null; is_custom?: boolean; ingredients?: string | null; allergens?: string | null; category?: string | null; vat_treatment?: string | null }>;
    availability: Array<{ day_of_week: number; open_time: string; close_time: string }>;
}

type NavKey = 'basics' | 'photos' | 'amenities' | 'know' | 'location' | 'availability' | 'pricing' | 'cancellation' | 'host' | 'dietary' | 'status';

const BOOKING_HORIZON_OPTIONS: { days: number; label: string }[] = [
    { days: 30, label: '30 days' },
    { days: 60, label: '60 days' },
    { days: 90, label: '3 months' },
    { days: 180, label: '6 months' },
    { days: 365, label: 'A year' },
];
const horizonLabel = (days: number) => BOOKING_HORIZON_OPTIONS.find((o) => o.days === days)?.label || `${days} days`;

const LEAD_TIME_OPTIONS: { days: number; label: string }[] = [
    { days: 0, label: 'Same day' },
    { days: 1, label: '1 day' },
    { days: 2, label: '2 days' },
    { days: 3, label: '3 days' },
    { days: 7, label: '1 week' },
];
const leadLabel = (days: number) => LEAD_TIME_OPTIONS.find((o) => o.days === days)?.label || `${days} days`;

const TURNAROUND_OPTIONS = [0, 15, 30, 45, 60];
const bigAreaCls = wizardAreaCls;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Basics & guests ──────────────────────────────────────────────────────────
function TitleCard({ value, onSave }: { value: string; onSave: (v: string) => unknown }) {
    const c = useCardSheet(value, onSave);
    return (
        <>
            <EditorCard title="Title" summary={value.trim() || 'Add a title'} onClick={c.start} />
            {c.open && (
                <EditorPanel title="What’s your experience called?" onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <BigTextInput value={c.draft} onChange={c.setDraft} ariaLabel="Listing title" placeholder="e.g. Sunrise yoga above the harbour" />
                </EditorPanel>
            )}
        </>
    );
}

// What happens, split: a one-sentence Description, and The flow (the three steps).
function DescriptionExpCard({ value, onSave }: { value: string; onSave: (v: string) => unknown }) {
    const c = useCardSheet(value, onSave);
    return (
        <>
            <EditorCard title="Description" summary={value.trim() || 'Add a description'} onClick={c.start} />
            {c.open && (
                <EditorPanel title="In a sentence, what is it?" onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <AutoTextarea className={bigAreaCls} rows={3} value={c.draft} onChange={(e) => c.setDraft(e.target.value)} aria-label="Description"
                        placeholder="A wood-fired lakeside sauna with cold-water dips between rounds." />
                </EditorPanel>
            )}
        </>
    );
}

function FlowCard({ phases, headings, onSave }: {
    phases: [string, string, string]; headings: { title: string }[];
    onSave: (phases: [string, string, string]) => unknown;
}) {
    const c = useCardSheet(phases, onSave);
    const ph = ['Where to meet, how to find you, what to expect first.', 'The heart of it — what you’ll actually do together.', 'How it wraps up — and anything to do after.'];
    const steps = phases.filter((d) => d.trim()).length;
    const summary = steps ? `${steps} ${steps === 1 ? 'step' : 'steps'}` : 'Add the flow';
    return (
        <>
            <EditorCard title="The flow" summary={summary} onClick={c.start} />
            {c.open && (
                <EditorPanel title="How does it go, start to finish?" onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <div className="space-y-3">
                        {headings.map((h, i) => (
                            <div key={h.title} className="flex gap-3">
                                <div className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-emerald-700 text-xs font-bold text-white">{i + 1}</div>
                                <div className="flex-1">
                                    <div className="text-base font-semibold text-slate-900">{h.title}</div>
                                    <AutoTextarea className={'mt-1 ' + bigAreaCls} rows={2}
                                        value={c.draft[i]} onChange={(e) => { const next = [...c.draft] as [string, string, string]; next[i] = e.target.value; c.setDraft(next); }}
                                        placeholder={ph[i]} />
                                </div>
                            </div>
                        ))}
                    </div>
                </EditorPanel>
            )}
        </>
    );
}

function MaxCapacityCard({ isSlot, value, onSave }: { isSlot: boolean; value: number; onSave: (v: number) => unknown }) {
    const c = useCardSheet(value, onSave);
    return (
        <>
            <EditorCard title="Maximum capacity" summary={`Up to ${value} ${value === 1 ? 'guest' : 'guests'}`} onClick={c.start} />
            {c.open && (
                <EditorPanel title={isSlot ? 'How many people can a session take?' : 'How many guests can you take?'} onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <Stepper value={c.draft} onChange={c.setDraft} min={1} max={60} />
                </EditorPanel>
            )}
        </>
    );
}

// ── Good to know ─────────────────────────────────────────────────────────────
function MinimumAgeCard({ minAge, onSave }: { minAge: string; onSave: (v: string) => unknown }) {
    const c = useCardSheet(minAge, onSave);
    return (
        <>
            <EditorCard title="Minimum age" summary={minAge ? `${minAge}+` : 'No minimum'} onClick={c.start} />
            {c.open && (
                <EditorPanel title="How old do guests need to be?" onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <OptionPills options={[{ value: '', label: 'No minimum' }, { value: '12', label: '12+' }, { value: '16', label: '16+' }, { value: '18', label: '18+' }, { value: '21', label: '21+' }]}
                        value={c.draft} onChange={c.setDraft} />
                </EditorPanel>
            )}
        </>
    );
}

function ActivityLevelCard({ activity, onSave }: { activity: string; onSave: (v: string) => unknown }) {
    const c = useCardSheet(activity, onSave);
    const label = activity ? activity.charAt(0).toUpperCase() + activity.slice(1) : 'Not set';
    return (
        <>
            <EditorCard title="Activity level" summary={label} onClick={c.start} />
            {c.open && (
                <EditorPanel title="How active is it?" onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <OptionPills options={[{ value: 'gentle', label: 'Gentle' }, { value: 'moderate', label: 'Moderate' }, { value: 'challenging', label: 'Challenging' }]}
                        value={c.draft} onChange={(v) => c.setDraft(c.draft === v ? '' : v)} />
                </EditorPanel>
            )}
        </>
    );
}

function WhatToBringCard({ whatToBring, onSave }: { whatToBring: string; onSave: (v: string) => unknown }) {
    const c = useCardSheet(whatToBring, onSave);
    return (
        <>
            <EditorCard title="What to bring" summary={whatToBring.trim() || 'Nothing listed'} onClick={c.start} />
            {c.open && (
                <EditorPanel title="What should guests bring?" onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <AutoTextarea className={bigAreaCls} rows={3} value={c.draft} onChange={(e) => c.setDraft(e.target.value)} aria-label="What to bring" placeholder="Warm layers, sturdy shoes, a towel…" />
                </EditorPanel>
            )}
        </>
    );
}

function CancellationCard({ hours, noRefund, onSave }: { hours: number; noRefund: boolean; onSave: (draft: { hours: number; noRefund: boolean }) => unknown }) {
    const c = useCardSheet({ hours, noRefund }, onSave);
    const current = experienceCancellationOption(hours, noRefund);
    const draftKey = experienceCancellationOption(c.draft.hours, c.draft.noRefund).key;
    return (
        <>
            <EditorCard title="Cancellation policy" summary={current.label} onClick={c.start} />
            {c.open && (
                <EditorPanel title="What’s your cancellation policy?" onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <div className="space-y-3">
                        {EXPERIENCE_CANCELLATION_OPTIONS.map((o) => {
                            const on = draftKey === o.key;
                            return (
                                <button key={o.key} type="button" onClick={() => c.setDraft({ hours: o.hours, noRefund: !!o.noRefund })}
                                    role="radio" aria-checked={on}
                                    className={`w-full rounded-2xl border-2 p-5 text-left transition ${on ? 'border-emerald-600 bg-emerald-50/60 shadow-sm' : 'border-slate-200 hover:border-slate-300'}`}>
                                    <div className="flex items-center justify-between">
                                        <span className="text-base font-semibold text-slate-900">{o.label}</span>
                                        {on && <Check className="h-4 w-4 text-emerald-700" />}
                                    </div>
                                    <p className="mt-1 text-sm text-slate-500">{o.blurb}</p>
                                </button>
                            );
                        })}
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
                <EditorPanel title="What dietary needs can you cater for?" onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <AutoTextarea className={bigAreaCls} rows={3} value={c.draft} onChange={(e) => c.setDraft(e.target.value)} aria-label="Dietary note" placeholder="Vegetarian and gluten-free on request; not a nut-free kitchen." />
                </EditorPanel>
            )}
        </>
    );
}

function HorizonCard({ horizonDays, onSave }: { horizonDays: number; onSave: (v: number) => unknown }) {
    const c = useCardSheet(horizonDays, onSave);
    return (
        <>
            <EditorCard title="How far ahead guests can book" summary={`${horizonLabel(horizonDays).toLowerCase()} ahead`} onClick={c.start} />
            {c.open && (
                <EditorPanel title="How far ahead can guests book?" onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <OptionPills options={BOOKING_HORIZON_OPTIONS.map((o) => ({ value: String(o.days), label: o.label }))}
                        value={String(c.draft)} onChange={(v) => c.setDraft(Number(v))} />
                </EditorPanel>
            )}
        </>
    );
}

function NoticeCard({ leadDays, onSave }: { leadDays: number; onSave: (v: number) => unknown }) {
    const c = useCardSheet(leadDays, onSave);
    return (
        <>
            <EditorCard title="Notice needed" summary={leadLabel(leadDays)} onClick={c.start} />
            {c.open && (
                <EditorPanel title="How much notice do you need?" onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <OptionPills options={LEAD_TIME_OPTIONS.map((o) => ({ value: String(o.days), label: o.label }))}
                        value={String(c.draft)} onChange={(v) => c.setDraft(Number(v))} />
                </EditorPanel>
            )}
        </>
    );
}

// ── Amenities ────────────────────────────────────────────────────────────────
type AmenityDraft = { amenities: string[]; accessibility: string; parking: string };
function AmenityTiles({ draft, set }: { draft: AmenityDraft; set: (d: AmenityDraft) => void }) {
    const toggle = (key: string) => set({ ...draft, amenities: draft.amenities.includes(key) ? draft.amenities.filter((k) => k !== key) : [...draft.amenities, key] });
    return (
        <div className="space-y-5">
            {EXPERIENCE_AMENITY_GROUPS.map((grp) => (
                <div key={grp.group}>
                    <h3 className="mb-2 text-sm font-semibold text-slate-800">{grp.group}</h3>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                        {grp.items.map((a) => {
                            const on = draft.amenities.includes(a.key);
                            return (
                                <button key={a.key} type="button" onClick={() => toggle(a.key)} aria-pressed={on}
                                    className={`relative rounded-2xl border-2 p-3 text-left text-sm transition ${on ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}>
                                    <span className="font-semibold text-slate-900">{a.label}</span>
                                    {on && <Check className="absolute right-3 top-3 h-4 w-4 text-slate-900" />}
                                </button>
                            );
                        })}
                    </div>
                </div>
            ))}
            {/* Accessibility and Parking: the same tiles, one choice per group —
                tapping the chosen tile again clears it. */}
            {([
                ['Accessibility', ACCESSIBILITY_OPTIONS, draft.accessibility, (v: string) => set({ ...draft, accessibility: v })],
                ['Parking', PARKING_OPTIONS, draft.parking, (v: string) => set({ ...draft, parking: v })],
            ] as const).map(([title, options, chosen, choose]) => (
                <div key={title}>
                    <h3 className="mb-2 text-sm font-semibold text-slate-800">{title}</h3>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3" role="radiogroup" aria-label={title}>
                        {options.map((o) => {
                            const on = chosen === o.key;
                            return (
                                <button key={o.key} type="button" role="radio" aria-checked={on} onClick={() => choose(on ? '' : o.key)}
                                    className={`relative rounded-2xl border-2 p-3 text-left text-sm transition ${on ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}>
                                    <span className="font-semibold text-slate-900">{o.label}</span>
                                    {on && <Check className="absolute right-3 top-3 h-4 w-4 text-slate-900" />}
                                </button>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}

function amenitiesSummary(amenities: string[]): string {
    const labels = EXPERIENCE_AMENITY_GROUPS.flatMap((g) => g.items).filter((i) => amenities.includes(i.key)).map((i) => i.label);
    return labels.length ? `${labels.length} added · ${labels.slice(0, 3).join(', ')}` : 'None added yet';
}

function AmenitiesPhoneCard({ current, onSave }: { current: AmenityDraft; onSave: (d: AmenityDraft) => unknown }) {
    const c = useCardSheet(current, onSave);
    return (
        <>
            <EditorCard title="Amenities" summary={amenitiesSummary(current.amenities)} onClick={c.start} />
            {c.open && (
                <EditorPanel title="What’s included?" onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <AmenityTiles draft={c.draft} set={c.setDraft} />
                </EditorPanel>
            )}
        </>
    );
}

// ── Availability ─────────────────────────────────────────────────────────────
function AvailabilityCard({ isSlot, comesToYou, hours, slotLength, turnaround, leadDays, onSave }: {
    isSlot: boolean;
    comesToYou: boolean;
    hours: { on: boolean; open: string; close: string }[];
    slotLength: number; turnaround: number; leadDays: number;
    onSave: (draft: { hours: { on: boolean; open: string; close: string }[]; slotLength: number; turnaround: number; leadDays: number }) => unknown;
}) {
    const c = useCardSheet({ hours, slotLength, turnaround, leadDays }, onSave);
    const title = isSlot ? 'Availability' : 'Opening hours';
    const openDays = hours.map((h, d) => (h.on ? DAY_NAMES[d] : null)).filter(Boolean);
    const setHour = (d: number, patch: Partial<{ on: boolean; open: string; close: string }>) =>
        c.setDraft({ ...c.draft, hours: c.draft.hours.map((h, j) => (j === d ? { ...h, ...patch } : h)) });
    return (
        <>
            <EditorCard title={title} summary={openDays.length ? openDays.join(', ') : 'No hours set'} onClick={c.start} />
            {c.open && (
                <EditorPanel title={isSlot ? 'When can guests book?' : 'When are you open?'} onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <div className="space-y-6">
                        <div>
                            <span className="block text-base font-semibold text-slate-800">Weekly hours</span>
                            <div className="mt-2 space-y-2">
                                {DAY_NAMES.map((name, d) => (
                                    <div key={d} className="flex items-center gap-3">
                                        <button type="button" onClick={() => setHour(d, { on: !c.draft.hours[d].on })} aria-pressed={c.draft.hours[d].on}
                                            className={`w-20 rounded-xl border-2 px-2 py-2.5 text-base font-semibold ${c.draft.hours[d].on ? 'border-emerald-600 bg-emerald-50/60 text-slate-900' : 'border-slate-200 text-slate-400'}`}>{name}</button>
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
                        <Field label="Notice needed">
                            <OptionPills options={LEAD_TIME_OPTIONS.map((o) => ({ value: String(o.days), label: o.label }))}
                                value={String(c.draft.leadDays)} onChange={(v) => c.setDraft({ ...c.draft, leadDays: Number(v) })} />
                        </Field>
                        {isSlot && (
                            <>
                                <Field label="Session length">
                                    <OptionPills options={SESSION_LENGTH_OPTIONS.map((m) => ({ value: String(m), label: minutesLabel(m) }))}
                                        value={String(c.draft.slotLength)} onChange={(v) => c.setDraft({ ...c.draft, slotLength: Number(v) })} />
                                </Field>
                                <Field label="Gap between sessions">
                                    <OptionPills options={TURNAROUND_OPTIONS.map((m) => ({ value: String(m), label: m === 0 ? 'None' : `${m} min` }))}
                                        value={String(c.draft.turnaround)} onChange={(v) => c.setDraft({ ...c.draft, turnaround: Number(v) })} />
                                </Field>
                            </>
                        )}
                        {/* The diary. A slot provider can block a whole day or part
                            of one; a comes-to-you provider has no sessions, so it
                            blocks whole days it can't travel. Both reach the same
                            calendar page, which renders the right tool for the shape. */}
                        {(isSlot || comesToYou) && (
                        <Link href="/services/dashboard/calendar" className="flex items-center justify-between gap-3 rounded-xl border border-slate-300 bg-slate-50 p-4 transition hover:border-slate-400">
                            <div className="flex items-start gap-3">
                                <CalendarRange className="mt-0.5 h-5 w-5 flex-none text-slate-500" />
                                <div>
                                    <div className="text-sm font-semibold text-slate-900">
                                        {isSlot ? 'Blocking a specific day, or part of one?' : 'Need to block a day you can’t take?'}
                                    </div>
                                </div>
                            </div>
                            <span className="flex-none text-sm font-semibold text-emerald-700">Open calendar →</span>
                        </Link>
                        )}
                    </div>
                </EditorPanel>
            )}
        </>
    );
}

// ── Location: how guests reach you (travelling) ──────────────────────────────
type WhereExtra = { fulfilment: string; deliveryFee: string; deliveryRadius: string; areas: string[] };
function HowGuestsReachCard({ current, onSave }: { current: WhereExtra; onSave: (d: WhereExtra) => unknown }) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<WhereExtra>(current);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const d = draft;
    const travels = d.fulfilment === 'delivery' || d.fulfilment === 'both';
    const noArea = travels && d.areas.length === 0;
    const ALL = GUEST_REGIONS.find((r) => r.key === GUEST_COVERAGE_ALL_KEY)!.label;
    const start = () => { setDraft(current); setError(''); setOpen(true); };
    const toggleRegion = (label: string, isAll: boolean) => {
        setError('');
        if (isAll) { setDraft({ ...d, areas: d.areas.includes(ALL) ? [] : [ALL] }); return; }
        const withoutAll = d.areas.filter((a) => a !== ALL);
        setDraft({ ...d, areas: withoutAll.includes(label) ? withoutAll.filter((a) => a !== label) : [...withoutAll, label] });
    };
    const save = async () => {
        // A traveller must say where they go — refused here, and again on the
        // server so it can't be bypassed.
        if (noArea) { setError('Pick at least one area you travel to'); return; }
        if (busy) return;
        setBusy(true);
        try { if (await saved(onSave(draft))) setOpen(false); } finally { setBusy(false); }
    };
    const summary = { collection: 'Guests come to you', delivery: 'You travel to guests', both: 'Guests come to you, or you travel' }[current.fulfilment] || 'Set how guests reach you';
    const needsAreaPrompt = (current.fulfilment === 'delivery' || current.fulfilment === 'both') && current.areas.length === 0;
    return (
        <>
            <EditorCard title="How guests reach you" summary={needsAreaPrompt ? 'Pick at least one area you travel to' : summary} onClick={start} />
            {open && (
                <EditorPanel title="How do guests reach you?" onClose={() => setOpen(false)}
                    footer={<SheetFooter busy={busy} onCancel={() => setOpen(false)} onSave={save} />}>
                    <div className="space-y-4">
                        <Field label="How guests get it">
                            <div className="space-y-2">
                                {[
                                    { key: 'collection', label: 'Guests come to me', note: 'At your studio, sauna, kitchen — one place.' },
                                    { key: 'delivery', label: 'I travel to the guest', note: 'You go to where they’re staying.' },
                                    { key: 'both', label: 'Both', note: 'Guests can come to you, or you travel to them.' },
                                ].map((o) => (
                                    <button key={o.key} type="button" onClick={() => { setError(''); setDraft({ ...d, fulfilment: o.key }); }}
                                        role="radio" aria-checked={d.fulfilment === o.key}
                                        className={`w-full rounded-2xl border-2 p-5 text-left transition ${d.fulfilment === o.key ? 'border-emerald-600 bg-emerald-50/60 shadow-sm' : 'border-slate-200 hover:border-slate-300'}`}>
                                        <div className="text-base font-semibold text-slate-900">{o.label}</div>
                                        <div className="mt-1 text-sm text-slate-500">{o.note}</div>
                                    </button>
                                ))}
                            </div>
                        </Field>
                        {travels && (
                            <div>
                                <span className="block text-base font-semibold text-slate-800">Regions you travel to</span>
                                {error && <p className="mt-1 text-sm font-semibold text-rose-600">{error}</p>}
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
                                <div className="flex items-center gap-2"><span className="text-slate-500">£</span>
                                    <input className="w-28 rounded-lg border border-slate-300 p-2 text-sm" inputMode="decimal" placeholder="0.00" value={d.deliveryFee} onChange={(e) => setDraft({ ...d, deliveryFee: cleanAmountInput(e.target.value) })} /></div>
                            </Field>
                        )}
                        {travels && (
                            <Field label="Delivery distance" hint="How far you’ll travel from your base. Further than this is turned away before payment. Blank is no limit.">
                                <div className="flex items-center gap-2">
                                    <input className="w-28 rounded-lg border border-slate-300 p-2 text-sm" inputMode="decimal" placeholder="e.g. 10" value={d.deliveryRadius} onChange={(e) => setDraft({ ...d, deliveryRadius: cleanAmountInput(e.target.value) })} />
                                    <span className="text-slate-500">miles</span></div>
                            </Field>
                        )}
                    </div>
                </EditorPanel>
            )}
        </>
    );
}

// ── Host profile, as cards (one per detail) ──────────────────────────────────
function HostPhotoCard({ supabase, headshot, onSave }: { supabase: SupabaseClient; headshot: string | null; onSave: (v: string | null) => unknown }) {
    // The same single-photo sheet as an offering's Photo: + to add or replace,
    // a bin to remove, saved as it goes.
    const [open, setOpen] = useState(false);
    return (
        <>
            <EditorCard title="Your photo" summary={headshot ? 'Photo added' : 'None yet'} onClick={() => setOpen(true)} />
            {open && (
                <SinglePhotoSheet emptyTitle="Add a photo of yourself" title="Your photo" image={headshot} round onClose={() => setOpen(false)}
                    upload={(file) => uploadImage(supabase, file, 'headshot')}
                    onSave={onSave} />
            )}
        </>
    );
}

function HostTextCard({ title, question, value, empty, placeholder, multiline, onSave }: { title: string; question: string; value: string; empty: string; placeholder?: string; multiline?: boolean; onSave: (v: string) => unknown }) {
    const c = useCardSheet(value, onSave);
    return (
        <>
            <EditorCard title={title} summary={value.trim() || empty} onClick={c.start} />
            {c.open && (
                <EditorPanel title={question} onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    {multiline
                        ? <AutoTextarea className={bigAreaCls} rows={3} value={c.draft} placeholder={placeholder} aria-label={title} onChange={(e) => c.setDraft(e.target.value)} />
                        : <BigTextInput value={c.draft} placeholder={placeholder} ariaLabel={title} onChange={c.setDraft} />}
                </EditorPanel>
            )}
        </>
    );
}

function HostYearsCard({ years, onSave }: { years: string; onSave: (v: string) => unknown }) {
    const c = useCardSheet(years, onSave);
    return (
        <>
            <EditorCard title="Years of experience" summary={years.trim() ? `${years} years` : 'Not added'} onClick={c.start} />
            {c.open && (
                <EditorPanel title="How many years’ experience do you have?" onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <div className="flex justify-center py-4">
                        <NumberStepper value={c.draft} onChange={c.setDraft} min={0} max={70} suggestion={5} size="lg" />
                    </div>
                </EditorPanel>
            )}
        </>
    );
}

// A "+ Add an offering" launcher that opens the stepped add flow.

// Listing status as a card like the rest: "Is your listing live?". When we took
// it down the provider can't lift it, so the sheet says so with nothing to save.
function ListingStatusCard({ paused, adminHidden, onSave }: { paused: boolean; adminHidden: boolean; onSave: (paused: boolean) => Promise<boolean> }) {
    const c = useCardSheet(paused, async (v) => (v === paused ? true : onSave(v)));
    const summary = adminHidden ? 'Taken down by us' : paused ? 'Taken down — guests can’t find or book it' : 'Live and bookable';
    return (
        <>
            <EditorCard title="Listing status" summary={summary} onClick={c.start} />
            {c.open && (
                <EditorPanel title="Is your listing live?" onClose={c.close}
                    footer={adminHidden ? undefined : <SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    {adminHidden ? (
                        <p className="text-base text-slate-700">We’ve taken your listing down, so only we can put it back up. If you think this is a mistake, reply to any email from us and we’ll look at it.</p>
                    ) : (
                        <ChoiceTiles cols={1} value={c.draft ? 'down' : 'live'} onChange={(v) => c.setDraft(v === 'down')}
                            options={[
                                { value: 'live', label: 'Live', hint: 'Guests can find and book it. Putting it back up is instant, with no review.' },
                                { value: 'down', label: 'Taken down', hint: 'It stops taking new bookings and leaves the marketplace. Bookings you’ve confirmed still stand.' },
                            ]} />
                    )}
                </EditorPanel>
            )}
        </>
    );
}

function AddItemLauncher({ ctx, onAdd }: { ctx: ItemCtx; onAdd: (row: MenuRow) => unknown }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold text-emerald-700 hover:text-emerald-800">+ Add an offering</button>
            {open && <AddItemFlow ctx={ctx} onClose={() => setOpen(false)} onAdd={onAdd} />}
        </>
    );
}

// ── The editor ───────────────────────────────────────────────────────────────
export default function ProviderListingEditor({ provider }: { provider: EditorProvider }) {
    const [p] = useState(provider);
    const supabase = createClientComponentClient();
    const [active, setActive] = useState<NavKey>('basics');
    const [paused, setPaused] = useState(provider.owner_paused);
    const [pausing, setPausing] = useState(false);

    const [isPhone, setIsPhone] = useState(false);
    useEffect(() => {
        const mq = window.matchMedia('(max-width: 767px)');
        const sync = () => setIsPhone(mq.matches);
        sync();
        mq.addEventListener('change', sync);
        return () => mq.removeEventListener('change', sync);
    }, []);
    const shows = (key: NavKey) => isPhone || active === key;

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

    const fixedInPlace = p.isSlot && !!p.category && p.category !== 'other' && !slotAsksWhereFork(p.category);
    const canTravel = !fixedInPlace;
    const [fulfilment, setFulfilment] = useState(fixedInPlace ? 'collection' : (p.fulfilment || 'collection'));
    const [street, setStreet] = useState(p.collection_street);
    const [town, setTown] = useState(p.collection_town);
    const [postcode, setPostcode] = useState(p.collection_postcode);
    const [deliveryFee, setDeliveryFee] = useState(amountForBox(p.delivery_fee));
    const [deliveryRadius, setDeliveryRadius] = useState(amountForBox(p.delivery_radius_miles));
    const [areas, setAreas] = useState<string[]>(p.areas);
    const [showPrecise, setShowPrecise] = useState(p.show_precise_location);

    const initialMaxGroup = p.isSlot ? p.slot_capacity : p.max_guests;
    const [maxGuests, setMaxGuests] = useState<number>(initialMaxGroup && initialMaxGroup > 0 ? initialMaxGroup : (p.isSlot ? 8 : 6));

    const [menu, setMenu] = useState<MenuRow[]>(p.items.map(rowFromItem));
    const [photos, setPhotos] = useState<string[]>(p.photos);
    const photosRef = useRef<string[]>(p.photos);
    const [logo] = useState<string | null>(p.logo);

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
    const runThen = (section: string, data: any, apply: () => void) =>
        run(section, data).then((ok) => { if (ok) apply(); return ok; });

    const happensPayload = (o: Partial<{ whatToExpect: string; phases: [string, string, string] }> = {}) => {
        const ph = o.phases ?? phases;
        return { what_to_expect: o.whatToExpect ?? whatToExpect, itinerary: headings.map((h, i) => ({ title: h.title, detail: ph[i] })) };
    };
    const thingsPayload = (o: Partial<{ minAge: string; activity: string; whatToBring: string }> = {}) => ({
        min_age: o.minAge ?? minAge, activity_level: o.activity ?? activity, what_to_bring: o.whatToBring ?? whatToBring,
    });
    const amenitiesPayload = (o: Partial<AmenityDraft> = {}) => ({
        amenities: o.amenities ?? amenities, accessibility: o.accessibility ?? accessibility, parking: o.parking ?? parking,
    });
    const bookingPayload = (o: Partial<{ maxGuests: number; leadDays: number; horizonDays: number }> = {}) => ({
        max_guests: o.maxGuests ?? maxGuests, lead_time_days: o.leadDays ?? leadDays, booking_horizon_days: o.horizonDays ?? horizonDays,
    });
    const aboutPayload = (o: Partial<{ profTitle: string; years: string; quals: string; recognition: string; headshot: string | null }> = {}) => ({
        professional_title: o.profTitle ?? profTitle, years_experience: o.years ?? years,
        qualifications: o.quals ?? quals, recognition: o.recognition ?? recognition,
        headshot: o.headshot !== undefined ? o.headshot : headshot,
    });
    const wherePayload = (o: Partial<{ fulfilment: string; street: string; town: string; postcode: string; deliveryFee: string; deliveryRadius: string; areas: string[]; showPrecise: boolean }> = {}) => {
        const f = o.fulfilment ?? fulfilment;
        const travels = f === 'delivery' || f === 'both';
        return {
            fulfilment: f,
            collection_street: o.street ?? street, collection_town: o.town ?? town, collection_postcode: o.postcode ?? postcode,
            delivery_fee: travels ? (o.deliveryFee ?? deliveryFee) : 0,
            delivery_radius_miles: travels ? (o.deliveryRadius ?? deliveryRadius) : 0,
            areas: travels ? (o.areas ?? areas) : [],
            show_precise_location: o.showPrecise ?? showPrecise,
        };
    };

    const menuPayload = (rows: MenuRow[]) => ({
        items: rows.map((r) => ({
            id: r.id, name: r.name, description: r.description, price: r.price, group_price: r.groupPrice,
            unit: r.unit, image: r.image,
            duration_minutes: r.duration, fulfilment: r.fulfilment, active: r.active,
            capacity: r.capacity, min_people: r.minPeople,
            is_custom: r.isCustom, ingredients: r.ingredients, allergens: r.allergens, category: r.category,
            vat_treatment: r.vatTreatment,
        })),
    });
    const saveMenu = (rows: MenuRow[]) => runThen('menu', menuPayload(rows), () => setMenu(rows));
    const saveItemAt = (i: number, row: MenuRow) => saveMenu(menu.map((r, j) => (j === i ? row : r)));
    const addItem = (row: MenuRow) => saveMenu([...menu, row]);
    const deleteItemAt = (i: number) => saveMenu(menu.filter((_, j) => j !== i));

    // What you offer's Edit mode: tick offerings, delete them in one save. It
    // won't take away the last bookable one (or leave none at all) — there'd be
    // nothing for a guest to book.
    const [selecting, setSelecting] = useState(false);
    const [picked, setPicked] = useState<Set<number>>(new Set());
    const [confirmBulk, setConfirmBulk] = useState(false);
    const [bulkBusy, setBulkBusy] = useState(false);
    const bookable = (r: MenuRow) => r.active && !!r.name.trim() && Number(r.price) > 0;
    const keptRows = menu.filter((_, j) => !picked.has(j));
    const bulkRefusal = keptRows.length === 0
        ? 'You can’t delete every offering — guests would have nothing to book. Keep at least one.'
        : menu.some(bookable) && !keptRows.some(bookable)
            ? 'That would remove every offering guests can book. Keep at least one bookable offering.'
            : null;
    const stopSelecting = () => { setSelecting(false); setPicked(new Set()); setConfirmBulk(false); };
    const togglePicked = (i: number) => setPicked((prev) => { const next = new Set(prev); if (next.has(i)) next.delete(i); else next.add(i); return next; });
    // Leaving What you offer (desktop's section list) leaves Edit mode too.
    useEffect(() => { if (active !== 'pricing') stopSelecting(); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
    const deletePicked = async () => {
        if (bulkBusy || bulkRefusal) return;
        setBulkBusy(true);
        const ok = await saveMenu(keptRows);
        setBulkBusy(false);
        if (ok) stopSelecting();
    };

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

    const toggleAmenityNow = (next: string[]) => {
        const before = amenities;
        setAmenities(next);
        run('amenities', amenitiesPayload({ amenities: next })).then((ok) => { if (!ok) setAmenities(before); });
    };
    const setAccessibilityNow = (next: string) => {
        const before = accessibility;
        setAccessibility(next);
        run('amenities', amenitiesPayload({ accessibility: next })).then((ok) => { if (!ok) setAccessibility(before); });
    };
    const setParkingNow = (next: string) => {
        const before = parking;
        setParking(next);
        run('amenities', amenitiesPayload({ parking: next })).then((ok) => { if (!ok) setParking(before); });
    };

    async function setPausedTo(next: boolean) {
        setPausing(true);
        const ok = await savePaused(p.id, next);
        if (ok) setPaused(next);
        setPausing(false);
        return ok;
    }
    const togglePaused = () => { setPausedTo(!paused); };

    const headings = stepHeadings(p.shape, fulfilment);
    // The one-at-a-time treatment shape (massage) has one unit and is never asked.
    const timed = p.isSlot && slotDurationPerItem(p.category);
    const itemCtx: ItemCtx = {
        isSlot: p.isSlot, shape: p.shape, fulfilment, minAge, maxGuests, supabase, vatRegistered: p.vat_registered,
        timed, units: chargeUnitsFor(p.shape, { timed }), commissionRate: p.commission_rate,
    };
    // A maximum capacity only means something when an offering is priced per
    // person or per group. A provider charging only per event (a bouncy castle)
    // or per item isn't asked for one. A slot always keeps it — it sizes sessions.
    const showCapacity = p.isSlot || needsCapacity(menu.filter((r) => r.active).map((r) => r.unit));

    const missing: string[] = [];
    if (!headshot) missing.push('a photo of yourself');
    if (!photos.length) missing.push('photos of the experience');
    if (!whatToExpect.trim()) missing.push('a description');
    if (!phases.some((d) => d.trim())) missing.push('the flow');
    if (!whatToBring.trim()) missing.push('what to bring');
    if (!minAge) missing.push('a minimum age');
    if (!activity.trim()) missing.push('the activity level');

    const hasHours = p.isSlot || p.shape === 'comes_to_you';
    const hasVenue = p.venue_lat != null && p.venue_lng != null;
    const SECTIONS: { key: NavKey; label: string; short: string; icon: any }[] = [
        { key: 'basics', label: 'Basics & guests', short: 'Basics', icon: FileText },
        { key: 'photos', label: 'Photos', short: 'Photos', icon: ImageIcon },
        { key: 'amenities', label: 'Amenities', short: 'Amenities', icon: Sparkles },
        { key: 'know', label: 'Good to know', short: 'Good to know', icon: Info },
        { key: 'location', label: fixedInPlace ? 'Location' : 'Location', short: 'Location', icon: MapPin },
        ...(hasHours ? [{ key: 'availability' as NavKey, label: p.isSlot ? 'Availability' : 'Opening hours', short: p.isSlot ? 'Availability' : 'Hours', icon: CalendarRange }] : []),
        { key: 'pricing', label: 'What you offer', short: 'Offerings', icon: ShoppingBag },
        { key: 'cancellation', label: 'Cancellation', short: 'Cancellation', icon: RotateCcw },
        { key: 'host', label: 'Host profile', short: 'Host', icon: User },
        ...(p.isFood ? [{ key: 'dietary' as NavKey, label: 'Food & dietary', short: 'Food', icon: Salad }] : []),
        { key: 'status', label: 'Listing status', short: 'Status', icon: (paused || p.admin_hidden) ? EyeOff : Eye },
    ];

    const OWN_HEADING = new Set<NavKey>(['photos']);
    const sec = (key: NavKey, children: React.ReactNode, action?: React.ReactNode) => {
        if (!shows(key)) return null;
        const label = SECTIONS.find((s) => s.key === key)?.label;
        const title = <h2 className="text-xl font-bold text-slate-900">{label}</h2>;
        const heading = !OWN_HEADING.has(key) && (action ? <div className="flex items-center justify-between gap-3">{title}{action}</div> : title);
        return isPhone
            ? <div data-editor-section={key} className="mt-14 space-y-4 first:mt-0">{heading}{children}</div>
            : <div className="space-y-4">{heading}{children}</div>;
    };

    // A showable offering: a name and a price.
    const hasPricedItem = menu.some((r) => r.active && r.name.trim() && priceRowValid(r));

    return (
        <QuestionSheetContext.Provider value={true}>
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
                    <p className="mt-1 text-sm text-amber-900/80">Guests book a time from your weekly hours. Until you set them, your listing generates no times and won’t appear in the marketplace.</p>
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
                    {sec('basics', (<>
                        <TitleCard value={businessName} onSave={(v) => runThen('title', { business_name: v }, () => setBusinessName(v))} />
                        <DescriptionExpCard value={whatToExpect}
                            onSave={(v) => runThen('happens', happensPayload({ whatToExpect: v }), () => setWhatToExpect(v))} />
                        <FlowCard phases={phases} headings={headings}
                            onSave={(ph) => runThen('happens', happensPayload({ phases: ph }), () => setPhases(ph))} />
                        {showCapacity && (
                            <MaxCapacityCard isSlot={p.isSlot} value={maxGuests}
                                onSave={(v) => runThen('booking', bookingPayload({ maxGuests: v }), () => setMaxGuests(v))} />
                        )}
                    </>))}

                    {sec('photos', (
                        isPhone ? <PhotosCard photos={photos} savePhotos={savePhotos} question="Show guests what it’s like" /> : <PhotosEditor photos={photos} savePhotos={savePhotos} isPhone={false} />
                    ))}

                    {sec('amenities', (
                        isPhone
                            ? <AmenitiesPhoneCard current={{ amenities, accessibility, parking }}
                                onSave={(d) => runThen('amenities', amenitiesPayload(d), () => { setAmenities(d.amenities); setAccessibility(d.accessibility); setParking(d.parking); })} />
                            : <AmenityTiles draft={{ amenities, accessibility, parking }}
                                set={(d) => {
                                    if (d.amenities !== amenities) toggleAmenityNow(d.amenities);
                                    else if (d.accessibility !== accessibility) setAccessibilityNow(d.accessibility);
                                    else if (d.parking !== parking) setParkingNow(d.parking);
                                }} />
                    ))}

                    {sec('know', (<>
                        <MinimumAgeCard minAge={minAge} onSave={(v) => runThen('things', thingsPayload({ minAge: v }), () => setMinAge(v))} />
                        <ActivityLevelCard activity={activity} onSave={(v) => runThen('things', thingsPayload({ activity: v }), () => setActivity(v))} />
                        <WhatToBringCard whatToBring={whatToBring} onSave={(v) => runThen('things', thingsPayload({ whatToBring: v }), () => setWhatToBring(v))} />
                    </>))}

                    {sec('location', (<>
                        {hasVenue && <PropertyMap variant="host" latitude={p.venue_lat!} longitude={p.venue_lng!} />}
                        <AddressCard town={town} street={street} postcode={postcode} propertyType=""
                            onSave={(t, st, pc) => runThen('where', wherePayload({ town: t, street: st, postcode: pc }),
                                () => { setTown(t); setStreet(st); setPostcode(pc); })} />
                        {canTravel && (
                            <HowGuestsReachCard current={{ fulfilment, deliveryFee, deliveryRadius, areas }}
                                onSave={(d) => runThen('where', wherePayload({ fulfilment: d.fulfilment, deliveryFee: d.deliveryFee, deliveryRadius: d.deliveryRadius, areas: d.areas }),
                                    () => { setFulfilment(d.fulfilment); setDeliveryFee(d.deliveryFee); setDeliveryRadius(d.deliveryRadius); setAreas(d.areas); })} />
                        )}
                        <LocationSharingCard precise={showPrecise}
                            onSave={(v) => runThen('where', wherePayload({ showPrecise: v }), () => setShowPrecise(v))} />
                    </>))}

                    {hasHours && sec('availability', (<>
                        <AvailabilityCard isSlot={p.isSlot} comesToYou={p.shape === 'comes_to_you'} hours={hours} slotLength={slotLength} turnaround={turnaround} leadDays={leadDays}
                            onSave={(d) => runThen('availability', {
                                slot_length_minutes: d.slotLength, slot_turnaround_minutes: d.turnaround, lead_time_days: d.leadDays,
                                availability: d.hours.map((h, day) => ({ ...h, day_of_week: day }))
                                    .filter((h) => h.on && h.open && h.close && h.open < h.close)
                                    .map((h) => ({ day_of_week: h.day_of_week, open_time: h.open, close_time: h.close })),
                            }, () => { setHours(d.hours); setSlotLength(d.slotLength); setTurnaround(d.turnaround); setLeadDays(d.leadDays); })} />
                        <HorizonCard horizonDays={horizonDays} onSave={(v) => runThen('booking', bookingPayload({ horizonDays: v }), () => setHorizonDays(v))} />
                    </>))}

                    {sec('pricing', (<>
                        {/* One account, several offerings — made explicit so a
                            provider (a caterer with a buffet and a hog roast) adds
                            them here rather than signing up a second time. */}
                        <p className="text-sm text-slate-500">
                            You can offer several different things under this one listing — add each as its own offering below, with its own name and price.
                        </p>
                        {!hasPricedItem && (
                            <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                                <Info className="mt-0.5 h-4 w-4 flex-none" />
                                You have no priced offering. Until you add one, your listing can’t be booked and won’t appear.
                            </div>
                        )}
                        {menu.map((row, i) => (
                            <ItemDetailCard key={row.id || `new-${i}`} ctx={itemCtx} row={row}
                                onSave={(r) => saveItemAt(i, r)} onDelete={() => deleteItemAt(i)}
                                selecting={selecting} selected={picked.has(i)} onToggle={() => togglePicked(i)} />
                        ))}
                        {!selecting && <AddItemLauncher ctx={itemCtx} onAdd={addItem} />}
                        {selecting && <div className="h-20" aria-hidden />}
                        {!hasHours && (
                            <div className="space-y-4 pt-2">
                                <NoticeCard leadDays={leadDays} onSave={(v) => runThen('booking', bookingPayload({ leadDays: v }), () => setLeadDays(v))} />
                                <HorizonCard horizonDays={horizonDays} onSave={(v) => runThen('booking', bookingPayload({ horizonDays: v }), () => setHorizonDays(v))} />
                            </div>
                        )}
                    </>), menu.length > 0 && (
                        <button type="button" onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
                            className="rounded-full px-3 py-1.5 text-sm font-semibold text-slate-900 underline underline-offset-2 hover:bg-slate-100">
                            {selecting ? 'Done' : 'Edit'}
                        </button>
                    ))}

                    {sec('cancellation', (
                        <CancellationCard hours={cancelHours} noRefund={noRefund}
                            onSave={(d) => runThen('cancellation', { cancellation_window_hours: d.hours, no_refund: !!d.noRefund }, () => { setCancelHours(d.hours); setNoRefund(d.noRefund); })} />
                    ))}

                    {sec('host', (<>
                        <HostPhotoCard supabase={supabase} headshot={headshot} onSave={(v) => runThen('about', aboutPayload({ headshot: v }), () => setHeadshot(v))} />
                        <HostTextCard title="Professional title" question="What’s your professional title?" value={profTitle} empty="Not added" onSave={(v) => runThen('about', aboutPayload({ profTitle: v }), () => setProfTitle(v))} />
                        <HostYearsCard years={years} onSave={(v) => runThen('about', aboutPayload({ years: v }), () => setYears(v))} />
                        <HostTextCard title="Qualifications" question="What qualifications do you have?" value={quals} empty="Not added" multiline onSave={(v) => runThen('about', aboutPayload({ quals: v }), () => setQuals(v))} />
                        <HostTextCard title="Recognition" question="Any awards or recognition?" value={recognition} empty="Not added yet" multiline onSave={(v) => runThen('about', aboutPayload({ recognition: v }), () => setRecognition(v))} />
                    </>))}

                    {p.isFood && sec('dietary', (
                        <DietaryCard dietaryNote={dietaryNote} onSave={(v) => runThen('dietary', { dietary_note: v, dietary_options: p.dietary_options }, () => setDietaryNote(v))} />
                    ))}

                    {sec('status', (
                        <ListingStatusCard paused={paused} adminHidden={p.admin_hidden} onSave={setPausedTo} />
                    ))}
                </div>
            </div>

            {selecting && (
                <div role="region" aria-label="Selected offerings" className="fixed inset-x-0 bottom-0 z-[60] border-t border-slate-200 bg-white px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
                    <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
                        <span className="text-base font-semibold text-slate-900">{picked.size} selected</span>
                        <div className="flex items-center gap-4">
                            <button type="button" onClick={stopSelecting} className="text-sm font-semibold text-slate-900 underline underline-offset-2">Cancel</button>
                            <button type="button" disabled={picked.size === 0} onClick={() => setConfirmBulk(true)}
                                className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-40">
                                <Trash2 className="h-4 w-4" /> Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {confirmBulk && (
                <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setConfirmBulk(false)}>
                    <div role="alertdialog" aria-modal="true" aria-label={bulkRefusal ? 'Can’t delete these' : `Delete ${picked.size} ${picked.size === 1 ? 'offering' : 'offerings'}?`}
                        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
                        {bulkRefusal ? (
                            <>
                                <div className="text-lg font-bold text-slate-900">Can’t delete these</div>
                                <p className="mt-2 text-sm text-slate-600">{bulkRefusal}</p>
                                <div className="mt-6 flex justify-end">
                                    <button type="button" onClick={() => setConfirmBulk(false)} className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white">OK</button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="text-lg font-bold text-slate-900">Delete {picked.size} {picked.size === 1 ? 'offering' : 'offerings'}?</div>
                                <p className="mt-2 text-sm text-slate-600">{picked.size === 1 ? 'It comes' : 'They come'} off your listing straight away.</p>
                                <div className="mt-6 flex items-center justify-end gap-4">
                                    <button type="button" onClick={() => setConfirmBulk(false)} className="text-sm font-semibold text-slate-900 underline underline-offset-2">Cancel</button>
                                    <button type="button" disabled={bulkBusy} onClick={deletePicked}
                                        className="rounded-full bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60">{bulkBusy ? 'Deleting…' : 'Delete'}</button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
        </QuestionSheetContext.Provider>
    );
}
