'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Env from '@/config/Env';
import { getImageUrl, generateRandomNumber } from '@/lib/utils';
import { compressImage } from '@/lib/compressImage';
import EmailFirstStep from '@/components/auth/EmailFirstStep';
import AgreementTick, { recordAgreement } from '@/components/legal/AgreementTick';
import {
    HOTEL_PROPERTY_TYPES, HOTEL_FACILITIES, BED_TYPES, BED_LABELS,
    roomTypeProblem, hotelPublishProblem, type DraftRoomType, type BedConfigEntry,
} from '@/lib/hotels';
import { Trash2, Plus, Check } from 'lucide-react';

// List your hotel. Booking.com's dependency order, kept spare (one decision a
// screen), built on the same pattern as /addhome: a draft is created on the
// first save and patched through /api/hotels/save; publishing goes through
// /api/hotels/publish (the only status-setter), which sends it to review.
//
// A wizard is an editor form, so it is deliberately FLAT (not a lifted card) on
// a bg-slate-50 page — lifted is for surfaces you act on, not forms you fill.

type RoomDraft = Partial<DraftRoomType> & { id?: string };

const STEPS = ['Basics', 'Location', 'Rooms', 'Facilities', 'Photos', 'Policies', 'Review'];

export default function AddHotelPage() {
    const [userId, setUserId] = useState<string | null>(null);
    const [authReady, setAuthReady] = useState(false);

    useEffect(() => {
        supabase.auth.getUser().then(({ data }) => {
            setUserId(data?.user?.id || null);
            setAuthReady(true);
        });
    }, []);

    if (!authReady) return <main className="min-h-screen bg-slate-50" />;

    if (!userId) {
        return (
            <main className="min-h-screen bg-slate-50 flex items-start justify-center px-4 py-12">
                <div className="w-full max-w-md">
                    <EmailFirstStep
                        eyebrow="List your hotel"
                        intro="Create an account or sign in to add your hotel to Galloway Getaways."
                        exitHref="/"
                        onSignedIn={() => supabase.auth.getUser().then(({ data }) => setUserId(data?.user?.id || null))}
                    />
                </div>
            </main>
        );
    }

    return <Wizard />;
}

function Wizard() {
    const [step, setStep] = useState(0);
    const [hotelId, setHotelId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fields
    const [propertyType, setPropertyType] = useState('');
    const [name, setName] = useState('');
    const [star, setStar] = useState<number | ''>('');
    const [flat, setFlat] = useState('');
    const [street, setStreet] = useState('');
    const [city, setCity] = useState('');
    const [postcode, setPostcode] = useState('');
    const [facilities, setFacilities] = useState<string[]>([]);
    const [photos, setPhotos] = useState<string[]>([]);
    const [checkIn, setCheckIn] = useState('15:00');
    const [checkOut, setCheckOut] = useState('11:00');
    const [cancellation, setCancellation] = useState('Flexible');
    const [description, setDescription] = useState('');
    const [vatRegistered, setVatRegistered] = useState(false);
    const [vatNumber, setVatNumber] = useState('');
    const [rooms, setRooms] = useState<RoomDraft[]>([]);
    const [agreed, setAgreed] = useState(false);

    const streetAddress = useMemo(() => [flat, street].filter(Boolean).join(', '), [flat, street]);
    const location = useMemo(() => (city ? `${city}, Dumfries and Galloway` : ''), [city]);

    function patch() {
        return {
            name, property_type: propertyType || null,
            star_rating: star === '' ? null : Number(star),
            street_address: streetAddress || null, postcode: postcode || null, location: location || null,
            facilities, images: photos,
            check_in_time: checkIn, check_out_time: checkOut,
            cancellation_policy: cancellation, description: description || null,
            vat_registered: vatRegistered, vat_number: vatNumber || null,
        };
    }

    async function save(includeRooms = false): Promise<string | null> {
        setSaving(true); setError(null);
        try {
            const res = await fetch('/api/hotels/save', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hotelId, patch: patch(), roomTypes: includeRooms ? rooms : undefined }),
            });
            const body = await res.json().catch(() => ({}));
            if (!body.ok) { setError(body.error || 'Could not save.'); setSaving(false); return null; }
            if (body.hotelId && !hotelId) setHotelId(body.hotelId);
            setSaving(false);
            return body.hotelId || hotelId;
        } catch {
            setError('Something went wrong saving. Please try again.');
            setSaving(false);
            return null;
        }
    }

    async function next() {
        // Validate the current step, save, advance.
        if (step === 0 && (!name.trim() || !propertyType)) { setError('Give the hotel a name and choose what kind of place it is.'); return; }
        if (step === 1 && (!streetAddress || !city)) { setError('Add the address and town.'); return; }
        if (step === 2) {
            if (!rooms.length) { setError('Add at least one room type.'); return; }
            for (const r of rooms) { const p = roomTypeProblem(r); if (p) { setError(p); return; } }
        }
        if (step === 4 && photos.length < 5) { setError('Add at least 5 photos.'); return; }
        const id = await save(step === 2);
        if (!id) return;
        setError(null);
        setStep((s) => Math.min(STEPS.length - 1, s + 1));
    }

    async function uploadPhoto(file: File) {
        const id = hotelId || (await save());
        if (!id) return;
        try {
            const ready = await compressImage(file);
            const path = `hotel-${id}/${Date.now()}_${generateRandomNumber()}.jpg`;
            const { error: upErr } = await supabase.storage.from(Env.S3_BUCKET).upload(path, ready, { contentType: 'image/jpeg' });
            if (upErr) { setError('A photo could not be uploaded: ' + upErr.message); return; }
            setPhotos((prev) => [...prev, path]);
        } catch {
            setError('A photo could not be processed.');
        }
    }

    async function publish() {
        setError(null);
        const problem = hotelPublishProblem({ ...patch(), roomTypes: rooms } as any);
        if (problem) { setError(problem); return; }
        if (!agreed) { setError('Please agree to the Host Terms to publish.'); return; }
        setSaving(true);
        const id = await save(true);
        if (!id) { setSaving(false); return; }
        // Record the host-terms acceptance through the shared agreements route.
        const termsErr = await recordAgreement('host', 'hotel_publish');
        if (termsErr) { setError(termsErr); setSaving(false); return; }
        const res = await fetch('/api/hotels/publish', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hotelId: id }),
        });
        const body = await res.json().catch(() => ({}));
        setSaving(false);
        if (!body.ok) { setError(body.error || 'Could not publish.'); return; }
        window.location.href = `/hotels/${id}?submitted=1`;
    }

    return (
        <main className="min-h-screen bg-slate-50">
            <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
                {/* Progress */}
                <div className="mb-6">
                    <div className="h-1.5 w-full rounded-full bg-slate-200">
                        <div className="h-1.5 rounded-full bg-emerald-700 transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
                    </div>
                    <p className="mt-2 text-sm font-semibold text-slate-600">Step {step + 1} of {STEPS.length} · {STEPS[step]}</p>
                </div>

                {error && <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}

                {step === 0 && (
                    <section className="space-y-5">
                        <h1 className="text-2xl font-bold text-slate-900">Tell us about your place</h1>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2">What kind of place is it?</label>
                            <div className="grid sm:grid-cols-2 gap-2">
                                {HOTEL_PROPERTY_TYPES.map((t) => (
                                    <button key={t.value} type="button" onClick={() => setPropertyType(t.value)}
                                        className={`text-left rounded-xl border p-3 transition ${propertyType === t.value ? 'border-emerald-700 ring-1 ring-emerald-700 bg-emerald-50/40' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                                        <div className="font-semibold text-slate-900">{t.label}</div>
                                        <div className="text-xs text-slate-500">{t.blurb}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                        <Field label="Name">
                            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="The Harbour Hotel" className={inputCls} />
                        </Field>
                        <Field label="Star rating (optional)">
                            <select value={star} onChange={(e) => setStar(e.target.value === '' ? '' : Number(e.target.value))} className={inputCls}>
                                <option value="">No rating</option>
                                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} star</option>)}
                            </select>
                        </Field>
                    </section>
                )}

                {step === 1 && (
                    <section className="space-y-5">
                        <h1 className="text-2xl font-bold text-slate-900">Where is it?</h1>
                        <Field label="Building / flat (optional)"><input value={flat} onChange={(e) => setFlat(e.target.value)} className={inputCls} /></Field>
                        <Field label="Street"><input value={street} onChange={(e) => setStreet(e.target.value)} className={inputCls} placeholder="1 Harbour Street" /></Field>
                        <Field label="Town"><input value={city} onChange={(e) => setCity(e.target.value)} className={inputCls} placeholder="Kirkcudbright" /></Field>
                        <Field label="Postcode"><input value={postcode} onChange={(e) => setPostcode(e.target.value)} className={inputCls} placeholder="DG6 4JG" /></Field>
                    </section>
                )}

                {step === 2 && (
                    <RoomTypesStep rooms={rooms} setRooms={setRooms} />
                )}

                {step === 3 && (
                    <section className="space-y-4">
                        <h1 className="text-2xl font-bold text-slate-900">What does the hotel offer?</h1>
                        <div className="grid sm:grid-cols-2 gap-2">
                            {HOTEL_FACILITIES.map((f) => {
                                const on = facilities.includes(f);
                                return (
                                    <button key={f} type="button" onClick={() => setFacilities((prev) => on ? prev.filter((x) => x !== f) : [...prev, f])}
                                        className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm text-left transition ${on ? 'border-emerald-700 bg-emerald-50/40 text-slate-900' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}>
                                        <span className={`inline-flex h-4 w-4 items-center justify-center rounded border ${on ? 'bg-emerald-700 border-emerald-700 text-white' : 'border-slate-300'}`}>{on && <Check className="h-3 w-3" />}</span>
                                        {f}
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                )}

                {step === 4 && (
                    <section className="space-y-4">
                        <h1 className="text-2xl font-bold text-slate-900">Photos</h1>
                        <p className="text-sm text-slate-600">Add at least 5. The first is the cover.</p>
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:border-slate-400">
                            <Plus className="h-4 w-4" /> Add photos
                            <input type="file" accept="image/*" multiple hidden onChange={(e) => { Array.from(e.target.files || []).forEach(uploadPhoto); e.currentTarget.value = ''; }} />
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                            {photos.map((p, i) => (
                                <div key={p} className="relative aspect-[4/3] overflow-hidden rounded-xl bg-slate-100">
                                    <img src={getImageUrl(p)} alt="" className="h-full w-full object-cover" />
                                    <button type="button" onClick={() => setPhotos((prev) => prev.filter((x) => x !== p))} className="absolute top-1 right-1 rounded-full bg-white/90 p-1 text-slate-700 shadow"><Trash2 className="h-3.5 w-3.5" /></button>
                                    {i === 0 && <span className="absolute bottom-1 left-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">Cover</span>}
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {step === 5 && (
                    <section className="space-y-5">
                        <h1 className="text-2xl font-bold text-slate-900">Policies</h1>
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Check-in from"><input type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className={inputCls} /></Field>
                            <Field label="Check-out by"><input type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className={inputCls} /></Field>
                        </div>
                        <Field label="Cancellation policy">
                            <select value={cancellation} onChange={(e) => setCancellation(e.target.value)} className={inputCls}>
                                {['Flexible', 'Moderate', 'Firm'].map((p) => <option key={p}>{p}</option>)}
                            </select>
                        </Field>
                        <Field label="Description (optional)">
                            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className={inputCls} placeholder="A short welcome and what makes the place special." />
                        </Field>
                        <div className="rounded-xl border border-slate-200 bg-white p-3">
                            <label className="inline-flex items-center gap-2 text-sm text-slate-800">
                                <input type="checkbox" checked={vatRegistered} onChange={(e) => setVatRegistered(e.target.checked)} className="h-4 w-4 accent-emerald-700" />
                                This business is VAT registered
                            </label>
                            {vatRegistered && <input value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} placeholder="VAT number" className={`${inputCls} mt-2`} />}
                        </div>
                    </section>
                )}

                {step === 6 && (
                    <section className="space-y-5">
                        <h1 className="text-2xl font-bold text-slate-900">Review &amp; publish</h1>
                        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700 space-y-1">
                            <p><span className="font-semibold text-slate-900">{name}</span> · {HOTEL_PROPERTY_TYPES.find((t) => t.value === propertyType)?.label}</p>
                            <p>{streetAddress}, {city}</p>
                            <p>{rooms.length} room type{rooms.length === 1 ? '' : 's'} · {photos.length} photos · {facilities.length} facilities</p>
                        </div>
                        <AgreementTick doc="host" checked={agreed} onChange={setAgreed} />
                        <p className="text-sm text-slate-500">When you publish, your hotel goes to Galloway Getaways for a quick review before it appears to guests.</p>
                    </section>
                )}

                {/* Nav */}
                <div className="mt-8 flex items-center justify-between">
                    <button type="button" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || saving}
                        className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 disabled:opacity-40 hover:bg-slate-100">Back</button>
                    {step < STEPS.length - 1 ? (
                        <button type="button" onClick={next} disabled={saving}
                            className="rounded-xl bg-emerald-700 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">{saving ? 'Saving…' : 'Next'}</button>
                    ) : (
                        <button type="button" onClick={publish} disabled={saving}
                            className="rounded-xl bg-emerald-700 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">{saving ? 'Publishing…' : 'Publish'}</button>
                    )}
                </div>
            </div>
        </main>
    );
}

const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-700';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</span>
            {children}
        </label>
    );
}

function RoomTypesStep({ rooms, setRooms }: { rooms: RoomDraft[]; setRooms: (r: RoomDraft[]) => void }) {
    function add() {
        setRooms([...rooms, { name: '', inventory_count: 1, max_adults: 2, max_children: 0, max_occupancy: 2, price_per_night: undefined as any, min_nights: 1, bed_config: [] }]);
    }
    function update(i: number, p: Partial<RoomDraft>) {
        setRooms(rooms.map((r, idx) => idx === i ? { ...r, ...p } : r));
    }
    function remove(i: number) { setRooms(rooms.filter((_, idx) => idx !== i)); }

    return (
        <section className="space-y-4">
            <h1 className="text-2xl font-bold text-slate-900">Your rooms</h1>
            <p className="text-sm text-slate-600">A room type is a kind of room you have several of — for example “Double room”, with 6 of them.</p>
            {rooms.map((r, i) => (
                <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-slate-500">Room type {i + 1}</span>
                        <button type="button" onClick={() => remove(i)} className="text-slate-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                    </div>
                    <input value={r.name || ''} onChange={(e) => update(i, { name: e.target.value })} placeholder="e.g. Double room" className={inputCls} />
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <NumField label="How many rooms" value={r.inventory_count} min={1} onChange={(v) => update(i, { inventory_count: v })} />
                        <NumField label="Price / night £" value={r.price_per_night} min={1} onChange={(v) => update(i, { price_per_night: v })} />
                        <NumField label="Size m² (optional)" value={r.size_sqm ?? ('' as any)} min={0} onChange={(v) => update(i, { size_sqm: v })} />
                        <NumField label="Max adults" value={r.max_adults} min={1} onChange={(v) => update(i, { max_adults: v })} />
                        <NumField label="Max children" value={r.max_children} min={0} onChange={(v) => update(i, { max_children: v })} />
                        <NumField label="Sleeps (total)" value={r.max_occupancy} min={1} onChange={(v) => update(i, { max_occupancy: v })} />
                    </div>
                    <BedEditor beds={(r.bed_config as BedConfigEntry[]) || []} onChange={(b) => update(i, { bed_config: b })} />
                </div>
            ))}
            <button type="button" onClick={add} className="inline-flex items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-400">
                <Plus className="h-4 w-4" /> Add a room type
            </button>
        </section>
    );
}

function NumField({ label, value, min, onChange }: { label: string; value: any; min: number; onChange: (v: number) => void }) {
    return (
        <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>
            <input type="number" min={min} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? (undefined as any) : Number(e.target.value))} className={inputCls} />
        </label>
    );
}

function BedEditor({ beds, onChange }: { beds: BedConfigEntry[]; onChange: (b: BedConfigEntry[]) => void }) {
    return (
        <div>
            <span className="mb-1 block text-xs font-semibold text-slate-600">Beds</span>
            <div className="space-y-2">
                {beds.map((b, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <select value={b.type} onChange={(e) => onChange(beds.map((x, idx) => idx === i ? { ...x, type: e.target.value as any } : x))} className={`${inputCls} flex-1`}>
                            {BED_TYPES.map((t) => <option key={t} value={t}>{BED_LABELS[t]}</option>)}
                        </select>
                        <input type="number" min={1} value={b.count} onChange={(e) => onChange(beds.map((x, idx) => idx === i ? { ...x, count: Number(e.target.value) } : x))} className={`${inputCls} w-20`} />
                        <button type="button" onClick={() => onChange(beds.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                    </div>
                ))}
                <button type="button" onClick={() => onChange([...beds, { type: 'double', count: 1 }])} className="text-sm font-semibold text-emerald-700 hover:text-emerald-800">+ Add a bed</button>
            </div>
        </div>
    );
}
