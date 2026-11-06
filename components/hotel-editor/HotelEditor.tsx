'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Plus, Trash2, Pencil, Check, ArrowLeft, Eye } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import Env from '@/config/Env';
import { getImageUrl, generateRandomNumber } from '@/lib/utils';
import { compressImage, readImageDimensions } from '@/lib/compressImage';
import { tinyImageProblem } from '@/lib/photoRules';
import { HOTEL_PROPERTY_TYPES, MIN_HOTEL_PHOTOS, occupancyOf, type DraftRoomType } from '@/lib/hotels';
import { HOTEL_FACILITY_CATEGORIES, PARKING_OPTIONS } from '@/lib/hotelFacilities';
import { AmenityGrid } from '@/components/listing-editor/AmenitiesCard';
import { PillChoice, bigInputCls } from '@/components/hotel-wizard/parts';
import RoomEditor from '@/components/hotel-wizard/RoomEditor';
import RestaurantHours, { restaurantSummary, type RestaurantSchedule } from '@/components/hotel-wizard/RestaurantHours';
import { HouseRulesCard, type HouseRules } from '@/components/listing-editor/ArrivalCards';
import { cancellationDisplay, CLEANING_FEE_NOTE } from '@/lib/cancellationDisplay';
import { CUSTOM_MIN_DAYS, CUSTOM_MAX_DAYS } from '@/lib/cancellation';
import { EditorCard, EditorPanel, PanelSave, saved } from '@/components/listing-editor/EditorPanel';

type RoomDraft = Partial<DraftRoomType> & { id?: string };
const CANCELLATION_KEYS = ['Flexible', 'Moderate', 'Limited', 'Firm', 'Custom'] as const;

// The hotel editor: the holiday-let editor's shape (a page of lifted cards, each
// opening a panel — EditorCard/EditorPanel/PanelSave, the same components) over
// the fields a hotel actually has. Every panel Save writes the whole hotel
// through /api/hotels/save (the one write authority; the browser has SELECT
// only), so there is no partial-save hole. Rooms & prices is the one section
// with no cottage equivalent — it reuses the wizard's RoomEditor sheet.
export default function HotelEditor({ hotel, rooms: initialRooms }: { hotel: any; rooms: RoomDraft[] }) {
    const hotelId: string = hotel.id;

    const sa = String(hotel.street_address || '').split(', ');
    const [name, setName] = useState(hotel.name || '');
    const [propertyType, setPropertyType] = useState(hotel.property_type || '');
    const [star, setStar] = useState<number | ''>(hotel.star_rating ?? '');
    const [flat, setFlat] = useState(sa.length > 1 ? sa[0] : '');
    const [street, setStreet] = useState(sa.length > 1 ? sa.slice(1).join(', ') : (hotel.street_address || ''));
    const [city, setCity] = useState(String(hotel.location || '').replace(/, Dumfries and Galloway$/, ''));
    const [postcode, setPostcode] = useState(hotel.postcode || '');
    const [description, setDescription] = useState(hotel.description || '');
    const [facilities, setFacilities] = useState<string[]>(hotel.facilities || []);
    const [parkingType, setParkingType] = useState(hotel.parking_type || 'none');
    const [parkingPrice, setParkingPrice] = useState<number | ''>(hotel.parking_price ?? '');
    const [restaurantSchedule, setRestaurantSchedule] = useState<RestaurantSchedule>((hotel.restaurant_schedule as any) || {});
    const [photos, setPhotos] = useState<string[]>((hotel.images || []).filter(Boolean));
    const [checkIn, setCheckIn] = useState((hotel.check_in_time || '15:00').slice(0, 5));
    const [checkInEnd, setCheckInEnd] = useState((hotel.check_in_end_time || '').slice(0, 5));
    const [checkOut, setCheckOut] = useState((hotel.check_out_time || '11:00').slice(0, 5));
    const [cancellation, setCancellation] = useState(hotel.cancellation_policy || 'Flexible');
    const [customDays, setCustomDays] = useState(hotel.cancellation_custom_days ?? 30);
    const [houseRules, setHouseRules] = useState<HouseRules>({
        petsAllowed: (hotel.facilities || []).includes('Pets allowed'),
        maxPets: hotel.max_pets ?? 2,
        eventsAllowed: !!hotel.events_allowed,
        smokingAllowed: !!hotel.smoking_allowed,
        commercialPhotographyAllowed: !!hotel.commercial_photography_allowed,
        quietHoursEnabled: !!hotel.quiet_hours_enabled,
        quietHoursStart: (hotel.quiet_hours_start || '22:00').slice(0, 5),
        quietHoursEnd: (hotel.quiet_hours_end || '07:00').slice(0, 5),
        additionalRules: hotel.additional_rules || '',
    });
    const [rooms, setRooms] = useState<RoomDraft[]>(initialRooms || []);

    const [open, setOpen] = useState<string | null>(null);
    const [roomEditor, setRoomEditor] = useState<{ index: number | null } | null>(null);
    const [error, setError] = useState<string | null>(null);

    const streetAddress = [flat, street].filter(Boolean).join(', ');
    const location = city ? `${city}, Dumfries and Galloway` : '';
    const facilitiesOut = [...facilities.filter((f) => f !== 'Pets allowed'), ...(houseRules.petsAllowed ? ['Pets allowed'] : [])];

    function patch() {
        return {
            name, property_type: propertyType || null, star_rating: star === '' ? null : Number(star),
            street_address: streetAddress || null, postcode: postcode || null, location: location || null,
            facilities: facilitiesOut, parking_type: parkingType, parking_price: parkingPrice === '' ? null : Number(parkingPrice),
            restaurant_schedule: restaurantSchedule, restaurant_hours: restaurantSummary(restaurantSchedule) || null,
            images: photos,
            check_in_time: checkIn, check_in_end_time: checkInEnd || null, check_out_time: checkOut,
            cancellation_policy: cancellation,
            cancellation_custom_days: cancellation === 'Custom' ? customDays : null,
            description: description || null,
            events_allowed: houseRules.eventsAllowed, smoking_allowed: houseRules.smokingAllowed,
            commercial_photography_allowed: houseRules.commercialPhotographyAllowed,
            quiet_hours_enabled: houseRules.quietHoursEnabled, quiet_hours_start: houseRules.quietHoursStart,
            quiet_hours_end: houseRules.quietHoursEnd, additional_rules: houseRules.additionalRules || null,
            max_pets: houseRules.petsAllowed ? houseRules.maxPets : null,
            house_rules: houseRules.additionalRules || null,
        };
    }

    // One writer, serialised, so two quick saves never race. Returns false on
    // failure, which keeps the panel open (PanelSave's contract).
    const writeLock = useRef<Promise<unknown>>(Promise.resolve());
    async function saveNow(extraRooms?: RoomDraft[] | null): Promise<boolean> {
        setError(null);
        const body: any = { hotelId, patch: patch() };
        if (extraRooms) body.roomTypes = extraRooms;
        const res = await fetch('/api/hotels/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => ({}));
        if (!data.ok) { setError(data.error || 'Could not save. Please try again.'); return false; }
        if (extraRooms && Array.isArray(data.roomIds)) {
            setRooms((prev) => prev.map((r, i) => (data.roomIds[i] ? { ...r, id: data.roomIds[i] } : r)));
        }
        return true;
    }
    function save(extraRooms?: RoomDraft[] | null): Promise<boolean> {
        const run = writeLock.current.then(() => saveNow(extraRooms), () => saveNow(extraRooms));
        writeLock.current = run;
        return run;
    }

    async function addPhotos(files: FileList | null) {
        if (!files) return;
        setError(null);
        for (const file of Array.from(files)) {
            try {
                const dim = await readImageDimensions(file);
                const problem = tinyImageProblem(dim.width, dim.height);
                if (problem) { setError(problem); continue; }
                const ready = await compressImage(file);
                const path = `hotel-${Date.now()}_${generateRandomNumber()}.jpg`;
                const { error: upErr } = await supabase.storage.from(Env.S3_BUCKET).upload(path, ready, { contentType: 'image/jpeg' });
                if (upErr) { setError('A photo could not be uploaded.'); continue; }
                setPhotos((prev) => [...prev, path]);
            } catch { setError('A photo could not be processed.'); }
        }
    }

    async function commitRooms(next: RoomDraft[]) {
        setRooms(next);
        await save(next);
    }
    function onRoomSaved(room: RoomDraft) {
        const next = roomEditor && roomEditor.index !== null
            ? rooms.map((r, i) => (i === roomEditor.index ? { ...r, ...room } : r))
            : [...rooms, room];
        setRoomEditor(null);
        commitRooms(next);
    }

    const propertyLabel = HOTEL_PROPERTY_TYPES.find((t) => t.value === propertyType)?.label;
    const roomsSummary = useMemo(() => {
        if (!rooms.length) return 'No room types yet';
        const prices = rooms.map((r) => Number(r.price_per_night)).filter((n) => Number.isFinite(n));
        const from = prices.length ? Math.min(...prices) : null;
        return `${rooms.length} room type${rooms.length === 1 ? '' : 's'}${from != null ? ` · from £${from.toFixed(0)}` : ''}`;
    }, [rooms]);

    const panelSave = (close: () => void) => <PanelSave onClick={async () => { if (await save()) close(); }} />;

    return (
        <main className="min-h-screen bg-slate-50">
            <div className="mx-auto max-w-2xl px-4 sm:px-6 py-8">
                <div className="flex items-center justify-between gap-3 mb-6">
                    <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900">
                        <ArrowLeft className="h-4 w-4" /> Dashboard
                    </Link>
                    <Link href={`/hotels/${hotelId}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:text-emerald-800">
                        <Eye className="h-4 w-4" /> View
                    </Link>
                </div>

                <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-1">{name || 'Your hotel'}</h1>
                <p className="text-slate-500 mb-6">Edit your hotel. Changes save as you go.</p>

                {error && <p className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}

                <div className="space-y-4">
                    {/* Name */}
                    <EditorCard title="Name" summary={name || 'Add a name'} onClick={() => setOpen('name')} />
                    {open === 'name' && (
                        <EditorPanel title="What's your hotel called?" onClose={() => setOpen(null)} footer={panelSave(() => setOpen(null))}>
                            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={bigInputCls} autoFocus />
                        </EditorPanel>
                    )}

                    {/* Property type + star rating */}
                    <EditorCard title="Property type" summary={[propertyLabel, star ? `${star}★` : null].filter(Boolean).join(' · ') || 'Choose a type'} onClick={() => setOpen('type')} />
                    {open === 'type' && (
                        <EditorPanel title="What kind of place is it?" onClose={() => setOpen(null)} footer={panelSave(() => setOpen(null))}>
                            <div className="space-y-2">
                                {HOTEL_PROPERTY_TYPES.map((t) => (
                                    <button key={t.value} type="button" onClick={() => setPropertyType(t.value)}
                                        className={`w-full text-left rounded-2xl border-2 p-4 transition ${propertyType === t.value ? 'border-emerald-700 bg-emerald-50/40' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                                        <div className="flex items-center justify-between">
                                            <span className="font-semibold text-slate-900">{t.label}</span>
                                            {propertyType === t.value && <Check className="h-5 w-5 text-emerald-700" />}
                                        </div>
                                        <p className="mt-0.5 text-sm text-slate-500">{t.blurb}</p>
                                    </button>
                                ))}
                            </div>
                            <div className="mt-5">
                                <label className="text-sm font-semibold text-slate-700">Star rating (optional)</label>
                                <div className="mt-2 flex gap-2">
                                    {[1, 2, 3, 4, 5].map((n) => (
                                        <button key={n} type="button" onClick={() => setStar(star === n ? '' : n)}
                                            className={`h-10 w-10 rounded-lg border text-sm font-semibold ${star === n ? 'border-emerald-700 bg-emerald-50 text-emerald-800' : 'border-slate-300 text-slate-600'}`}>{n}</button>
                                    ))}
                                </div>
                            </div>
                        </EditorPanel>
                    )}

                    {/* Description */}
                    <EditorCard title="Description" summary={description || 'Describe your hotel'} onClick={() => setOpen('description')} />
                    {open === 'description' && (
                        <EditorPanel title="Describe your hotel" onClose={() => setOpen(null)} footer={panelSave(() => setOpen(null))}>
                            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={8} maxLength={2000}
                                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" autoFocus />
                        </EditorPanel>
                    )}

                    {/* Address */}
                    <EditorCard title="Address" summary={[streetAddress, city, postcode].filter(Boolean).join(', ') || 'Add the address'} onClick={() => setOpen('address')} />
                    {open === 'address' && (
                        <EditorPanel title="Where is it?" onClose={() => setOpen(null)} footer={panelSave(() => setOpen(null))}>
                            <div className="space-y-3">
                                <Field label="Building / flat (optional)"><input value={flat} onChange={(e) => setFlat(e.target.value)} className={bigInputCls} /></Field>
                                <Field label="Street"><input value={street} onChange={(e) => setStreet(e.target.value)} className={bigInputCls} /></Field>
                                <Field label="Town"><input value={city} onChange={(e) => setCity(e.target.value)} className={bigInputCls} /></Field>
                                <Field label="Postcode"><input value={postcode} onChange={(e) => setPostcode(e.target.value)} className={bigInputCls} /></Field>
                            </div>
                        </EditorPanel>
                    )}

                    {/* Photos */}
                    <EditorCard title="Photos" summary={photos.length ? `${photos.length} photo${photos.length === 1 ? '' : 's'}` : 'Add photos'} onClick={() => setOpen('photos')} />
                    {open === 'photos' && (
                        <EditorPanel title="Photos" onClose={() => setOpen(null)} footer={panelSave(() => setOpen(null))}>
                            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:border-slate-400">
                                <Plus className="h-4 w-4" /> Add photos
                                <input type="file" accept="image/*" multiple hidden onChange={(e) => { addPhotos(e.target.files); e.currentTarget.value = ''; }} />
                            </label>
                            <p className="mt-2 text-xs text-slate-500">Add at least {MIN_HOTEL_PHOTOS}. The first is the cover.</p>
                            <div className="mt-4 grid grid-cols-3 gap-2">
                                {photos.map((p, i) => (
                                    <div key={p} className="relative aspect-[4/3] overflow-hidden rounded-xl bg-slate-100">
                                        <img src={getImageUrl(p)} alt="" className="h-full w-full object-cover" />
                                        <button type="button" onClick={() => setPhotos((prev) => prev.filter((x) => x !== p))} className="absolute top-1 right-1 rounded-full bg-white/90 p-1 text-slate-700 shadow"><Trash2 className="h-3.5 w-3.5" /></button>
                                        {i === 0 && <span className="absolute bottom-1 left-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">Cover</span>}
                                    </div>
                                ))}
                            </div>
                        </EditorPanel>
                    )}

                    {/* Facilities, parking & restaurant */}
                    <EditorCard title="Facilities" summary={facilities.filter((f) => f !== 'Pets allowed').length ? `${facilities.filter((f) => f !== 'Pets allowed').length} selected` : 'Add facilities'} onClick={() => setOpen('facilities')} />
                    {open === 'facilities' && (
                        <EditorPanel title="Facilities &amp; parking" onClose={() => setOpen(null)} footer={panelSave(() => setOpen(null))}>
                            <AmenityGrid categories={HOTEL_FACILITY_CATEGORIES as any} selected={facilities}
                                onToggle={(n: string) => setFacilities((prev) => prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n])} />
                            <div className="mt-6 space-y-3">
                                <Field label="Parking">
                                    <PillChoice options={PARKING_OPTIONS} value={parkingType} onChange={setParkingType} />
                                </Field>
                                {parkingType !== 'none' && (
                                    <Field label="Parking price per night (£, leave blank if free)">
                                        <input type="number" min={0} value={parkingPrice} onChange={(e) => setParkingPrice(e.target.value === '' ? '' : Number(e.target.value))} className={bigInputCls} />
                                    </Field>
                                )}
                            </div>
                            <div className="mt-6">
                                <h3 className="text-sm font-semibold text-slate-700 mb-2">Restaurant hours (optional)</h3>
                                <RestaurantHours value={restaurantSchedule} onChange={setRestaurantSchedule} />
                            </div>
                        </EditorPanel>
                    )}

                    {/* Check-in / checkout times */}
                    <EditorCard title="Check-in and checkout" summary={`Check-in from ${checkIn}${checkInEnd ? ` until ${checkInEnd}` : ''} · Checkout by ${checkOut}`} onClick={() => setOpen('times')} />
                    {open === 'times' && (
                        <EditorPanel title="Check-in and checkout" onClose={() => setOpen(null)} footer={panelSave(() => setOpen(null))}>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div>
                                    <label className="text-xs text-slate-500">Check-in from</label>
                                    <input type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className="w-full p-2.5 border rounded-lg text-sm mt-1" />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-500">Check-in until</label>
                                    <input type="time" value={checkInEnd} onChange={(e) => setCheckInEnd(e.target.value)} className="w-full p-2.5 border rounded-lg text-sm mt-1" />
                                    <p className="text-xs text-slate-400 mt-1">Optional.</p>
                                </div>
                                <div>
                                    <label className="text-xs text-slate-500">Checkout by</label>
                                    <input type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className="w-full p-2.5 border rounded-lg text-sm mt-1" />
                                </div>
                            </div>
                        </EditorPanel>
                    )}

                    {/* House rules — the holiday-let card, its own panel and save. */}
                    <HouseRulesCard rules={houseRules} onSave={async (r) => { setHouseRules(r); return await save(); }} />

                    {/* Cancellation policy */}
                    <EditorCard title="Cancellation policy" summary={cancellation === 'Custom' ? `Custom · ${customDays} days` : cancellation} onClick={() => setOpen('cancellation')} />
                    {open === 'cancellation' && (
                        <EditorPanel title="Cancellation policy" onClose={() => setOpen(null)} footer={panelSave(() => setOpen(null))}>
                            <div className="space-y-3">
                                {CANCELLATION_KEYS.map((key) => {
                                    const d = cancellationDisplay(key, key === 'Custom' ? customDays : undefined);
                                    const on = cancellation === key;
                                    return (
                                        <button key={key} type="button" onClick={() => setCancellation(key)}
                                            className={`w-full text-left rounded-2xl border-2 p-4 transition ${on ? 'border-emerald-700 bg-emerald-50/40' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                                            <div className="flex items-center justify-between">
                                                <span className="font-semibold text-slate-900">{key}</span>
                                                {on && <Check className="h-5 w-5 text-emerald-700" />}
                                            </div>
                                            <ul className="mt-1 space-y-0.5">
                                                {d.bullets.map((b) => <li key={b} className="text-sm text-slate-600">· {b}</li>)}
                                            </ul>
                                            {key === 'Custom' && on && (
                                                <div className="mt-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                                    <span className="text-sm text-slate-600">Full refund up to</span>
                                                    <input type="number" min={CUSTOM_MIN_DAYS} max={CUSTOM_MAX_DAYS} value={customDays}
                                                        onChange={(e) => setCustomDays(Math.max(CUSTOM_MIN_DAYS, Math.min(CUSTOM_MAX_DAYS, Number(e.target.value))))}
                                                        className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                                                    <span className="text-sm text-slate-600">days before check-in</span>
                                                </div>
                                            )}
                                        </button>
                                    );
                                })}
                                <p className="text-xs text-slate-500">{CLEANING_FEE_NOTE}</p>
                            </div>
                        </EditorPanel>
                    )}

                    {/* Rooms & prices — the hotel-specific section. */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="font-semibold text-slate-900">Rooms &amp; prices</div>
                                <div className="mt-0.5 text-sm text-slate-500">{roomsSummary}</div>
                            </div>
                            <button type="button" onClick={() => setRoomEditor({ index: null })}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-black">
                                <Plus className="h-4 w-4" /> Add
                            </button>
                        </div>
                        {rooms.length > 0 && (
                            <ul className="mt-4 divide-y divide-slate-100">
                                {rooms.map((r, i) => (
                                    <li key={r.id || i} className="flex items-center justify-between gap-3 py-3">
                                        <div className="min-w-0">
                                            <div className="truncate font-medium text-slate-900">{r.name || 'Room type'}</div>
                                            <div className="text-sm text-slate-500">
                                                {r.inventory_count} room{Number(r.inventory_count) === 1 ? '' : 's'} · sleeps {occupancyOf({ max_adults: r.max_adults, max_children: r.max_children })} · £{Number(r.price_per_night || 0).toFixed(0)}/night
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <button type="button" onClick={() => setRoomEditor({ index: i })} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Edit room"><Pencil className="h-4 w-4" /></button>
                                            <button type="button" onClick={() => commitRooms(rooms.filter((_, idx) => idx !== i))} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50" aria-label="Remove room"><Trash2 className="h-4 w-4" /></button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            </div>

            {roomEditor && (
                <RoomEditor
                    initial={roomEditor.index !== null ? rooms[roomEditor.index] : null}
                    onSave={onRoomSaved}
                    onClose={() => setRoomEditor(null)}
                />
            )}
        </main>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</span>
            {children}
        </label>
    );
}
