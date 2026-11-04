'use client';

import { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import Env from '@/config/Env';
import { getImageUrl, generateRandomNumber } from '@/lib/utils';
import { compressImage } from '@/lib/compressImage';
import { AmenityGrid } from '@/components/listing-editor/AmenitiesCard';
import {
    BED_TYPES, BED_LABELS, roomTypeProblem, occupancyOf,
    type DraftRoomType, type BedConfigEntry,
} from '@/lib/hotels';
import {
    BATHROOM_TYPES, BATHROOM_FEATURES, ROOM_VIEWS, SMOKING_OPTIONS,
    ROOM_ACCESSIBILITY, IN_ROOM_AMENITY_CATEGORIES,
} from '@/lib/hotelFacilities';
import { Counter, CheckGroup, PillChoice, Toggle, bigInputCls } from '@/components/hotel-wizard/parts';

type RoomDraft = Partial<DraftRoomType> & { id?: string };

const BLANK: RoomDraft = {
    name: '', inventory_count: 1, max_adults: 2, max_children: 0,
    bed_config: [], bathroom_type: 'private', bathroom_features: [], views: [],
    smoking: 'non_smoking', accessibility: [], amenities: [], breakfast_included: false,
    images: [], price_per_night: undefined, min_nights: 1,
};

// One room type, edited in a full-height sheet. Booking.com's room-setup form:
// name, how many, occupancy, beds, size, bathroom, view, smoking, accessibility,
// in-room amenities, breakfast, price, photos. Sleeps is NOT asked — it is
// adults + children, shown live. Saving validates with roomTypeProblem (the same
// rule the server and the publish gate use).
export default function RoomEditor({ initial, onSave, onClose }: {
    initial?: RoomDraft | null;
    onSave: (room: RoomDraft) => void;
    onClose: () => void;
}) {
    const [r, setR] = useState<RoomDraft>({ ...BLANK, ...(initial || {}) });
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const set = (p: Partial<RoomDraft>) => setR((prev) => ({ ...prev, ...p }));
    const toggleIn = (key: 'bathroom_features' | 'views' | 'accessibility' | 'amenities', name: string) => {
        const cur = (r[key] as string[]) || [];
        set({ [key]: cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name] } as any);
    };

    const beds = (r.bed_config as BedConfigEntry[]) || [];
    const sleeps = occupancyOf({ max_adults: r.max_adults, max_children: r.max_children });

    async function addPhotos(files: FileList | null) {
        if (!files) return;
        setBusy(true); setError(null);
        for (const file of Array.from(files)) {
            try {
                const ready = await compressImage(file);
                const path = `hotelroom-${Date.now()}_${generateRandomNumber()}.jpg`;
                const { error: upErr } = await supabase.storage.from(Env.S3_BUCKET).upload(path, ready, { contentType: 'image/jpeg' });
                if (upErr) { setError('A photo could not be uploaded.'); continue; }
                set({ images: [...((r.images as string[]) || []), path] });
            } catch { setError('A photo could not be processed.'); }
        }
        setBusy(false);
    }

    function save() {
        const problem = roomTypeProblem(r);
        if (problem) { setError(problem); return; }
        onSave(r);
    }

    return (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-6" role="dialog" aria-modal="true" onClick={onClose}>
            <div className="flex max-h-[92vh] w-full flex-col rounded-t-3xl bg-white sm:max-w-xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                    <h3 className="text-base font-bold text-slate-900">{initial ? 'Edit room type' : 'Add a room type'}</h3>
                    <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
                </div>

                <div className="overflow-y-auto px-5 py-5 space-y-6">
                    {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}

                    <Field label="Room name"><input value={r.name || ''} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Double room" className={bigInputCls} /></Field>

                    <div className="rounded-xl border border-slate-200 p-3">
                        <Counter label="How many rooms of this type" value={Number(r.inventory_count) || 1} min={1} onChange={(v) => set({ inventory_count: v })} />
                        <Counter label="Adults" value={Number(r.max_adults) || 1} min={1} onChange={(v) => set({ max_adults: v })} />
                        <Counter label="Children" value={Number(r.max_children) || 0} min={0} onChange={(v) => set({ max_children: v })} />
                        <p className="pt-3 text-sm text-slate-500">Sleeps <span className="font-semibold text-slate-800">{sleeps}</span> — worked out from adults and children.</p>
                    </div>

                    <Section title="Beds">
                        <p className="-mt-1 mb-2 text-xs text-slate-500">Pick a bed type and how many of it this room has.</p>
                        <div className="space-y-2">
                            {beds.map((b, i) => (
                                <div key={i} className="flex items-center gap-2">
                                    {/* flex-1 + min-w-0 so the type select keeps its width; the count
                                        is a fixed box — NOT bigInputCls, whose w-full would collapse the select. */}
                                    <select value={b.type} onChange={(e) => set({ bed_config: beds.map((x, idx) => idx === i ? { ...x, type: e.target.value as any } : x) })}
                                        className="flex-1 min-w-0 rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 bg-white">
                                        {BED_TYPES.map((t) => <option key={t} value={t}>{BED_LABELS[t]}</option>)}
                                    </select>
                                    <input type="number" min={1} value={b.count} aria-label="How many"
                                        onChange={(e) => set({ bed_config: beds.map((x, idx) => idx === i ? { ...x, count: Math.max(1, Number(e.target.value)) } : x) })}
                                        className="w-16 shrink-0 rounded-lg border border-slate-300 px-2 py-2.5 text-sm text-slate-900 text-center" />
                                    <button type="button" onClick={() => set({ bed_config: beds.filter((_, idx) => idx !== i) })} className="shrink-0 text-slate-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                                </div>
                            ))}
                            <button type="button" onClick={() => set({ bed_config: [...beds, { type: 'double', count: 1 }] })} className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:text-emerald-800"><Plus className="h-4 w-4" /> Add a bed</button>
                        </div>
                    </Section>

                    <Field label="Room size (m², optional)"><input type="number" min={0} value={r.size_sqm ?? ''} onChange={(e) => set({ size_sqm: e.target.value === '' ? null : Math.floor(Number(e.target.value)) })} className={bigInputCls} /></Field>

                    <Section title="Bathroom">
                        <PillChoice options={BATHROOM_TYPES} value={r.bathroom_type || 'private'} onChange={(v) => set({ bathroom_type: v })} />
                        <div className="mt-3"><CheckGroup options={BATHROOM_FEATURES} selected={(r.bathroom_features as string[]) || []} onToggle={(n) => toggleIn('bathroom_features', n)} /></div>
                    </Section>

                    <Section title="View"><CheckGroup options={ROOM_VIEWS} selected={(r.views as string[]) || []} onToggle={(n) => toggleIn('views', n)} /></Section>

                    <Section title="Smoking"><PillChoice options={SMOKING_OPTIONS} value={r.smoking || 'non_smoking'} onChange={(v) => set({ smoking: v })} /></Section>

                    <Section title="Accessibility"><CheckGroup options={ROOM_ACCESSIBILITY} selected={(r.accessibility as string[]) || []} onToggle={(n) => toggleIn('accessibility', n)} /></Section>

                    <Section title="In-room amenities">
                        <AmenityGrid categories={IN_ROOM_AMENITY_CATEGORIES as any} selected={(r.amenities as string[]) || []} onToggle={(n: string) => toggleIn('amenities', n)} />
                    </Section>

                    <div className="rounded-xl border border-slate-200 p-3">
                        <Toggle label="Breakfast included in the price" checked={!!r.breakfast_included} onChange={(v) => set({ breakfast_included: v })} />
                    </div>

                    <Field label="Price per night (£)"><input type="number" min={1} value={r.price_per_night ?? ''} onChange={(e) => set({ price_per_night: e.target.value === '' ? (undefined as any) : Number(e.target.value) })} className={bigInputCls} /></Field>

                    <Section title="Room photos">
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-400">
                            <Plus className="h-4 w-4" /> Add photos
                            <input type="file" accept="image/*" multiple hidden onChange={(e) => { addPhotos(e.target.files); e.currentTarget.value = ''; }} />
                        </label>
                        <div className="mt-2 grid grid-cols-3 gap-2">
                            {((r.images as string[]) || []).map((p) => (
                                <div key={p} className="relative aspect-[4/3] overflow-hidden rounded-lg bg-slate-100">
                                    <img src={getImageUrl(p)} alt="" className="h-full w-full object-cover" />
                                    <button type="button" onClick={() => set({ images: ((r.images as string[]) || []).filter((x) => x !== p) })} className="absolute top-1 right-1 rounded-full bg-white/90 p-1 text-slate-700 shadow"><Trash2 className="h-3.5 w-3.5" /></button>
                                </div>
                            ))}
                        </div>
                    </Section>
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
                    <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
                    <button type="button" onClick={save} disabled={busy} className="rounded-xl bg-emerald-700 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">{busy ? 'Uploading…' : 'Save room'}</button>
                </div>
            </div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</span>{children}</label>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return <div><h4 className="mb-2 text-sm font-semibold text-slate-700">{title}</h4>{children}</div>;
}
