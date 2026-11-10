'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Env from '@/config/Env';
import { getImageUrl, generateRandomNumber } from '@/lib/utils';
import { compressImage, readImageDimensions } from '@/lib/compressImage';
import { tinyImageProblem } from '@/lib/photoRules';
import EmailFirstStep from '@/components/auth/EmailFirstStep';
import { requireName } from '@/components/auth/FinishSignUpGate';
import AgreementTick, { recordAgreement } from '@/components/legal/AgreementTick';
import { AmenityGrid } from '@/components/listing-editor/AmenitiesCard';
import { cancellationDisplay, CLEANING_FEE_NOTE } from '@/lib/cancellationDisplay';
import {
    HOTEL_PROPERTY_TYPES, HOTEL_STEPS, HOTEL_TOTAL_STEPS, hotelProblemAtStep,
    firstHotelProblem, roomTypeProblem, occupancyOf, MIN_HOTEL_PHOTOS,
    type DraftRoomType, type PublishableHotel,
} from '@/lib/hotels';
import { HOTEL_FACILITY_CATEGORIES, PARKING_OPTIONS } from '@/lib/hotelFacilities';
import { PillChoice, bigInputCls } from '@/components/hotel-wizard/parts';
import RoomEditor from '@/components/hotel-wizard/RoomEditor';
import RestaurantHours, { restaurantSummary, type RestaurantSchedule } from '@/components/hotel-wizard/RestaurantHours';
import AddressLookup from '@/components/address/AddressLookup';
import { HouseRulesCard, type HouseRules } from '@/components/listing-editor/ArrivalCards';
import { CUSTOM_MIN_DAYS, CUSTOM_MAX_DAYS } from '@/lib/cancellation';
import { Trash2, Plus, Star, Pencil, Check, ChevronLeft } from 'lucide-react';

type RoomDraft = Partial<DraftRoomType> & { id?: string };
const CANCELLATION_KEYS = ['Flexible', 'Moderate', 'Limited', 'Firm', 'Custom'] as const;

const EMPTY_HOUSE_RULES: HouseRules = {
    petsAllowed: false, maxPets: 2, eventsAllowed: false, smokingAllowed: false,
    commercialPhotographyAllowed: false, quietHoursEnabled: false,
    quietHoursStart: '22:00', quietHoursEnd: '07:00', additionalRules: '',
};

export default function AddHotelPage() {
    const [userId, setUserId] = useState<string | null>(null);
    const [authReady, setAuthReady] = useState(false);

    useEffect(() => {
        supabase.auth.getUser().then(({ data }) => { setUserId(data?.user?.id || null); setAuthReady(true); });
    }, []);
    // Any signed-in host needs a name on record (guests see "Hosted by"); the gate
    // mirrors /addhome.
    useEffect(() => { if (userId) requireName(); }, [userId]);

    if (!authReady) return <main className="min-h-screen bg-slate-50" />;

    if (!userId) {
        return (
            <main className="min-h-screen bg-slate-50 flex items-start justify-center px-4 py-12">
                <div className="w-full max-w-md">
                    <EmailFirstStep
                        eyebrow="List your hotel"
                        intro="Create an account or sign in to add your hotel to Galloway Getaways."
                        exitHref="/"
                        collectGuestTerms={false}
                        onSignedIn={() => {
                            // Re-run so an owner-only ?draft load picks up, as /addhome does.
                            if (new URLSearchParams(window.location.search).get('draft')) window.location.reload();
                            else supabase.auth.getUser().then(({ data }) => setUserId(data?.user?.id || null));
                        }}
                    />
                </div>
            </main>
        );
    }
    return <Wizard userId={userId} />;
}

function Wizard({ userId }: { userId: string }) {
    const router = useRouter();
    const searchParams = useSearchParams();

    const [step, setStep] = useState(1);
    const [hotelId, setHotelId] = useState<string | null>(null);
    const [autosave, setAutosave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [formError, setFormError] = useState<string | null>(null);
    const [publishing, setPublishing] = useState(false);

    // Hotel-level fields
    const [propertyType, setPropertyType] = useState('');
    const [name, setName] = useState('');
    const [star, setStar] = useState<number | ''>('');
    const [flat, setFlat] = useState('');
    const [street, setStreet] = useState('');
    const [city, setCity] = useState('');
    const [postcode, setPostcode] = useState('');
    const [facilities, setFacilities] = useState<string[]>([]);
    const [parkingType, setParkingType] = useState('none');
    const [parkingPrice, setParkingPrice] = useState<number | ''>('');
    const [restaurantSchedule, setRestaurantSchedule] = useState<RestaurantSchedule>({});
    const [photos, setPhotos] = useState<string[]>([]);
    const [checkIn, setCheckIn] = useState('15:00');
    const [checkInEnd, setCheckInEnd] = useState('');
    const [checkOut, setCheckOut] = useState('11:00');
    const [cancellation, setCancellation] = useState('Flexible');
    const [customDays, setCustomDays] = useState(30);
    const [description, setDescription] = useState('');
    const [vatRegistered, setVatRegistered] = useState(false);
    const [vatNumber, setVatNumber] = useState('');
    const [houseRules, setHouseRules] = useState<HouseRules>(EMPTY_HOUSE_RULES);
    const [agreed, setAgreed] = useState(false);
    const [rooms, setRooms] = useState<RoomDraft[]>([]);
    const [roomEditor, setRoomEditor] = useState<{ index: number | null } | null>(null);

    const streetAddress = [flat, street].filter(Boolean).join(', ');
    const location = city ? `${city}, Dumfries and Galloway` : '';

    // Pets are a house rule (asked once); store it as the 'Pets allowed' facility
    // so the public page lists it, keeping the facilities array the single home
    // for the chips the grid shows.
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
            vat_registered: vatRegistered, vat_number: vatNumber || null,
            // House rules (parity with the holiday-let HouseRulesCard).
            events_allowed: houseRules.eventsAllowed, smoking_allowed: houseRules.smokingAllowed,
            commercial_photography_allowed: houseRules.commercialPhotographyAllowed,
            quiet_hours_enabled: houseRules.quietHoursEnabled, quiet_hours_start: houseRules.quietHoursStart,
            quiet_hours_end: houseRules.quietHoursEnd, additional_rules: houseRules.additionalRules || null,
            max_pets: houseRules.petsAllowed ? houseRules.maxPets : null,
            house_rules: houseRules.additionalRules || null,
        };
    }
    function hotelForRules(): PublishableHotel {
        return {
            property_type: propertyType, name, street_address: streetAddress, location,
            images: photos, roomTypes: rooms, check_in_time: checkIn, check_out_time: checkOut,
        };
    }

    // ---- resume via ?draft=<id> ------------------------------------------------
    const loadedRef = useRef(false);
    useEffect(() => {
        if (loadedRef.current) return;
        const draft = searchParams?.get('draft');
        if (!draft) { loadedRef.current = true; return; }
        loadedRef.current = true;
        // Read the saved step BEFORE setHotelId below — setting hotelId fires the
        // step-memory write effect, which would otherwise overwrite this with the
        // initial step 1 before we get to restore it.
        let savedStep = 0;
        try { savedStep = Number(window.localStorage.getItem('gg.addhotel.step.' + draft)); } catch { /* ignore */ }
        (async () => {
            const { data: h } = await supabase.from('hotels')
                .select('name, property_type, star_rating, street_address, postcode, location, facilities, parking_type, parking_price, restaurant_schedule, images, check_in_time, check_in_end_time, check_out_time, cancellation_policy, cancellation_custom_days, description, vat_registered, additional_rules, events_allowed, smoking_allowed, commercial_photography_allowed, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, max_pets')
                .eq('id', draft).maybeSingle();
            if (!h) return;
            setHotelId(draft);
            setName(h.name || ''); setPropertyType(h.property_type || ''); setStar(h.star_rating ?? '');
            // street_address was stored as "flat, street" — split back loosely.
            const sa = (h.street_address || '').split(', ');
            if (sa.length > 1) { setFlat(sa[0]); setStreet(sa.slice(1).join(', ')); } else setStreet(h.street_address || '');
            setCity((h.location || '').replace(/, Dumfries and Galloway$/, ''));
            setPostcode(h.postcode || '');
            const loadedFacilities: string[] = h.facilities || [];
            setFacilities(loadedFacilities);
            setParkingType(h.parking_type || 'none'); setParkingPrice(h.parking_price ?? '');
            setRestaurantSchedule((h.restaurant_schedule as any) || {}); setPhotos((h.images || []).filter(Boolean));
            setCheckIn((h.check_in_time || '15:00').slice(0, 5)); setCheckInEnd((h.check_in_end_time || '').slice(0, 5)); setCheckOut((h.check_out_time || '11:00').slice(0, 5));
            setCancellation(h.cancellation_policy || 'Flexible'); setCustomDays(h.cancellation_custom_days ?? 30); setDescription(h.description || '');
            setVatRegistered(!!h.vat_registered);
            setHouseRules({
                petsAllowed: loadedFacilities.includes('Pets allowed'), maxPets: h.max_pets ?? 2,
                eventsAllowed: !!h.events_allowed, smokingAllowed: !!h.smoking_allowed,
                commercialPhotographyAllowed: !!h.commercial_photography_allowed,
                quietHoursEnabled: !!h.quiet_hours_enabled, quietHoursStart: (h.quiet_hours_start || '22:00').slice(0, 5),
                quietHoursEnd: (h.quiet_hours_end || '07:00').slice(0, 5), additionalRules: h.additional_rules || '',
            });
            const { data: rt } = await supabase.from('hotel_room_types').select('*').eq('hotel_id', draft).order('sort_order', { ascending: true });
            if (rt) setRooms(rt as any);
            if (savedStep >= 1 && savedStep <= HOTEL_TOTAL_STEPS) setStep(savedStep);
        })();
    }, [searchParams]);

    // ---- autosave (hotel-level fields; rooms save explicitly) ------------------
    const draftIdRef = useRef<string | null>(null);
    draftIdRef.current = hotelId;
    const writeLock = useRef<Promise<unknown>>(Promise.resolve());
    const dirty = useRef(false);

    async function writeDraftNow(extraRooms?: RoomDraft[] | null): Promise<string | null> {
        const body: any = { hotelId: draftIdRef.current, patch: patch() };
        if (extraRooms) body.roomTypes = extraRooms;
        const res = await fetch('/api/hotels/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => ({}));
        if (!data.ok) return null;
        if (data.hotelId && !draftIdRef.current) {
            draftIdRef.current = data.hotelId; setHotelId(data.hotelId);
            router.replace('/addhotel?draft=' + encodeURIComponent(data.hotelId), { scroll: false });
        }
        if (extraRooms && Array.isArray(data.roomIds)) {
            setRooms((prev) => prev.map((r, i) => data.roomIds[i] ? { ...r, id: data.roomIds[i] } : r));
        }
        return draftIdRef.current;
    }
    function writeDraft(extraRooms?: RoomDraft[] | null): Promise<string | null> {
        const run = writeLock.current.then(() => writeDraftNow(extraRooms), () => writeDraftNow(extraRooms));
        writeLock.current = run;
        return run;
    }

    const snapshot = JSON.stringify(patch());
    useEffect(() => {
        if (!propertyType || publishing) return;
        dirty.current = true;
        const t = setTimeout(async () => {
            setAutosave('saving');
            const id = await writeDraft();
            dirty.current = false;
            setAutosave(id ? 'saved' : 'error');
        }, 1500);
        return () => clearTimeout(t);
    }, [snapshot, propertyType, publishing]);

    useEffect(() => {
        if (!hotelId) return;
        try { window.localStorage.setItem('gg.addhotel.step.' + hotelId, String(step)); } catch { /* ignore */ }
    }, [hotelId, step]);

    useEffect(() => {
        const warn = (e: BeforeUnloadEvent) => { if (dirty.current || autosave === 'saving') { e.preventDefault(); e.returnValue = ''; } };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [autosave]);

    // Every step opens at the top of the page (Liam's walkthrough).
    useEffect(() => { try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch { /* ignore */ } }, [step]);

    // ---- rooms: save on add/edit/remove ---------------------------------------
    async function commitRooms(next: RoomDraft[]) {
        setRooms(next);
        setAutosave('saving');
        const id = await writeDraft(next);
        setAutosave(id ? 'saved' : 'error');
    }
    function onRoomSaved(room: RoomDraft) {
        const next = roomEditor && roomEditor.index !== null
            ? rooms.map((r, i) => i === roomEditor.index ? { ...r, ...room } : r)
            : [...rooms, room];
        setRoomEditor(null);
        commitRooms(next);
    }
    function removeRoom(i: number) { commitRooms(rooms.filter((_, idx) => idx !== i)); }

    // ---- photos ----------------------------------------------------------------
    async function addPhotos(files: FileList | null) {
        if (!files) return;
        setFormError(null);
        for (const file of Array.from(files)) {
            try {
                const dim = await readImageDimensions(file);
                const dimProblem = tinyImageProblem(dim.width, dim.height);
                if (dimProblem) { setFormError(dimProblem); continue; }
                const ready = await compressImage(file);
                const path = `hotel-${Date.now()}_${generateRandomNumber()}.jpg`;
                const { error } = await supabase.storage.from(Env.S3_BUCKET).upload(path, ready, { contentType: 'image/jpeg' });
                if (error) { setFormError('A photo could not be uploaded.'); continue; }
                setPhotos((prev) => [...prev, path]);
            } catch { setFormError('A photo could not be processed.'); }
        }
    }

    // ---- navigation ------------------------------------------------------------
    function goNext() {
        setFormError(null);
        const problem = hotelProblemAtStep(hotelForRules(), step);
        if (problem) { setFormError(problem); return; }
        setStep((s) => Math.min(HOTEL_TOTAL_STEPS, s + 1));
    }
    function goBack() {
        setFormError(null);
        if (step > 1) setStep(step - 1); else router.push('/dashboard');
    }

    async function publish() {
        setFormError(null);
        // What's missing — jump to the exact step and explain, never a disabled button.
        const problem = firstHotelProblem(hotelForRules());
        if (problem) { setFormError(problem.message); setStep(problem.step); return; }
        if (!agreed) { setFormError('Please agree to the Host Terms to publish.'); return; }
        setPublishing(true);
        const id = await writeDraft(rooms); // ensure everything, incl. rooms, is saved
        if (!id) { setFormError('Could not save your hotel. Please try again.'); setPublishing(false); return; }
        const termsErr = await recordAgreement('host', 'hotel_publish');
        if (termsErr) { setFormError(termsErr); setPublishing(false); return; }
        const res = await fetch('/api/hotels/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hotelId: id }) });
        const body = await res.json().catch(() => ({}));
        setPublishing(false);
        if (!body.ok) { setFormError(body.error || 'Could not publish.'); return; }
        window.location.href = `/hotels/${id}?submitted=1`;
    }

    return (
        <main className="min-h-screen bg-slate-50">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10 w-full">
                {/* Back, top-left of every step (Liam's walkthrough). */}
                <button type="button" onClick={goBack} disabled={publishing}
                    className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900">
                    <ChevronLeft className="h-4 w-4" /> Back
                </button>
                {/* Segmented progress bar, as /addhome */}
                <div className="flex space-x-1 mb-2">
                    {Array.from({ length: HOTEL_TOTAL_STEPS }).map((_, i) => (
                        <div key={i} className={`h-1.5 flex-1 rounded-full ${i < step ? 'bg-emerald-700' : 'bg-slate-200'}`} />
                    ))}
                </div>
                <div className="mb-6 flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-600">Step {step} of {HOTEL_TOTAL_STEPS}</p>
                    <p className="text-xs text-slate-400">{autosave === 'saving' ? 'Saving…' : autosave === 'saved' ? 'Saved' : autosave === 'error' ? 'Not saved' : ''}</p>
                </div>

                {formError && <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">{formError}</p>}

                {step === HOTEL_STEPS.TYPE && (
                    <Step title="What kind of place is it?">
                        <div className="grid sm:grid-cols-2 gap-3">
                            {HOTEL_PROPERTY_TYPES.map((t) => (
                                <button key={t.value} type="button" onClick={() => setPropertyType(t.value)}
                                    className={`text-left rounded-2xl border-2 p-4 transition ${propertyType === t.value ? 'border-emerald-700 bg-emerald-50/40' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                                    <div className="font-semibold text-slate-900">{t.label}</div>
                                    <div className="text-xs text-slate-500">{t.blurb}</div>
                                </button>
                            ))}
                        </div>
                    </Step>
                )}

                {step === HOTEL_STEPS.NAME && (
                    <Step title="What’s your hotel called?" hint="This is the name guests will see.">
                        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="The Harbour Hotel" className={bigInputCls} autoFocus />
                        <div className="mt-6">
                            <label className="mb-1.5 block text-sm font-semibold text-slate-700">Star rating (optional)</label>
                            <div className="flex gap-1">
                                {[1, 2, 3, 4, 5].map((n) => (
                                    <button key={n} type="button" onClick={() => setStar(star === n ? '' : n)} aria-label={`${n} star`}
                                        className={`p-1 ${star !== '' && n <= Number(star) ? 'text-amber-500' : 'text-slate-300'}`}>
                                        <Star className="h-7 w-7 fill-current" />
                                    </button>
                                ))}
                            </div>
                        </div>
                    </Step>
                )}

                {step === HOTEL_STEPS.LOCATION && (
                    <Step title="Where is it?" hint="A hotel publishes its address, so guests can find you.">
                        {/* The same address search as the holiday-let sign-up: type a
                            postcode or street and pick it, or "Enter it by hand". The
                            lookup answers from a fake off production (type ID1 1QD on
                            TEST), so no real lookup credits are spent walking it. */}
                        <AddressLookup
                            value={{ house: flat, street, town: city, postcode }}
                            onChange={(a) => { setFlat(a.house); setStreet(a.street); setCity(a.town); setPostcode(a.postcode); }}
                            searchEnabled
                            showErrors={!!formError}
                        />
                    </Step>
                )}

                {step === HOTEL_STEPS.ROOMS && (
                    <Step title="Your rooms" hint="A room type is a kind of room you have several of.">
                        <div className="space-y-3">
                            {rooms.map((r, i) => (
                                <div key={r.id || i} className="rounded-2xl border border-slate-200 bg-white p-4 flex items-center justify-between">
                                    <div>
                                        <div className="font-semibold text-slate-900">{r.name || 'Untitled room'}</div>
                                        <div className="text-sm text-slate-500">{r.inventory_count} room(s) · sleeps {occupancyOf(r as any)} · £{Number(r.price_per_night) || 0}/night{r.breakfast_included ? ' · breakfast' : ''}</div>
                                        {roomTypeProblem(r) && <div className="text-xs text-rose-700 mt-0.5">{roomTypeProblem(r)}</div>}
                                    </div>
                                    <div className="flex gap-1">
                                        <button type="button" onClick={() => setRoomEditor({ index: i })} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><Pencil className="h-4 w-4" /></button>
                                        <button type="button" onClick={() => removeRoom(i)} className="rounded-lg p-2 text-slate-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                                    </div>
                                </div>
                            ))}
                            <button type="button" onClick={() => setRoomEditor({ index: null })} className="inline-flex items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-400">
                                <Plus className="h-4 w-4" /> Add a room type
                            </button>
                        </div>
                    </Step>
                )}

                {step === HOTEL_STEPS.FACILITIES && (
                    <Step title="What does the hotel offer?">
                        <AmenityGrid categories={HOTEL_FACILITY_CATEGORIES as any} selected={facilities}
                            onToggle={(n: string) => setFacilities((prev) => prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n])} />
                        <div className="mt-6 space-y-4 border-t border-slate-100 pt-6">
                            <Field label="Parking">
                                <PillChoice options={PARKING_OPTIONS} value={parkingType} onChange={setParkingType} />
                            </Field>
                            {parkingType !== 'none' && (
                                <Field label="Parking price per night (£, leave blank if free)">
                                    <input type="number" min={0} value={parkingPrice} onChange={(e) => setParkingPrice(e.target.value === '' ? '' : Number(e.target.value))} className={bigInputCls} />
                                </Field>
                            )}
                        </div>
                    </Step>
                )}

                {step === HOTEL_STEPS.RESTAURANT && (
                    <Step title="Restaurant or bar hours" hint="If you have a restaurant or bar, set its opening hours. Leave every day closed if you don't.">
                        {/* Set Monday, and opening the next day pre-fills it with
                            Monday's times (and so on down the week) — still editable
                            — so the hours aren't typed seven times. */}
                        <RestaurantHours value={restaurantSchedule} onChange={setRestaurantSchedule} />
                    </Step>
                )}

                {step === HOTEL_STEPS.PHOTOS && (
                    <Step title="Photos" hint={`Add at least ${MIN_HOTEL_PHOTOS}. The first is the cover.`}>
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:border-slate-400">
                            <Plus className="h-4 w-4" /> Add photos
                            <input type="file" accept="image/*" multiple hidden onChange={(e) => { addPhotos(e.target.files); e.currentTarget.value = ''; }} />
                        </label>
                        <div className="mt-4 grid grid-cols-3 gap-2">
                            {photos.map((p, i) => (
                                <div key={p} className="relative aspect-[4/3] overflow-hidden rounded-xl bg-slate-100">
                                    <img src={getImageUrl(p)} alt="" className="h-full w-full object-cover" />
                                    <button type="button" onClick={() => setPhotos((prev) => prev.filter((x) => x !== p))} className="absolute top-1 right-1 rounded-full bg-white/90 p-1 text-slate-700 shadow"><Trash2 className="h-3.5 w-3.5" /></button>
                                    {i === 0 && <span className="absolute bottom-1 left-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">Cover</span>}
                                </div>
                            ))}
                        </div>
                        {photos.length > 0 && photos.length < MIN_HOTEL_PHOTOS && (
                            <p className="mt-3 text-sm text-amber-700">Add at least {MIN_HOTEL_PHOTOS} — you have {photos.length}.</p>
                        )}
                    </Step>
                )}

                {step === HOTEL_STEPS.TIMES && (
                    <Step title="Check-in and house rules" hint="Guests see these on your listing and in their booking confirmation.">
                        {/* The holiday-let flow's exact time fields — native inputs. */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-lg">
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
                        {/* The holiday-let House rules component, reused as-is. */}
                        <div className="mt-8">
                            <h3 className="text-base font-bold text-slate-900 mb-2">House rules</h3>
                            <HouseRulesCard rules={houseRules} onSave={(r) => { setHouseRules(r); return true; }} />
                        </div>
                    </Step>
                )}

                {step === HOTEL_STEPS.CANCELLATION && (
                    <Step title="Cancellation policy" hint="The same policies as our holiday lets.">
                        <div className="space-y-3">
                            {CANCELLATION_KEYS.map((key) => {
                                const d = cancellationDisplay(key, key === 'Custom' ? customDays : undefined);
                                const on = cancellation === key;
                                return (
                                    <button key={key} type="button" onClick={() => setCancellation(key)}
                                        className={`w-full text-left rounded-2xl border-2 p-4 transition ${on ? 'border-emerald-700 bg-emerald-50/40' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                                        <div className="flex items-center justify-between">
                                            <span className="font-semibold text-slate-900">{key === 'Custom' ? 'Custom' : key}</span>
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
                    </Step>
                )}

                {step === HOTEL_STEPS.REVIEW && (
                    <Step title="Review and publish" hint="This is exactly what guests will see.">
                        {/* The real guest page, not a cramped embed: the title opens
                            the actual hotel page (owner preview) in a new tab — the
                            same page a guest sees, the way the holiday-let review and
                            the admin listing review open the real listing. */}
                        <div className="rounded-2xl border border-slate-200 bg-white p-5 mb-5 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
                            {hotelId ? (
                                <a href={`/hotels/${hotelId}/preview`} target="_blank" rel="noopener noreferrer"
                                    className="group flex items-center gap-4">
                                    <div className="h-20 w-28 flex-none overflow-hidden rounded-xl bg-slate-100">
                                        {photos[0] && <img src={getImageUrl(photos[0])} alt="" className="h-full w-full object-cover" />}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-1.5 font-semibold text-slate-900 group-hover:text-emerald-700">
                                            {name || 'Your hotel'} <ChevronLeft className="h-4 w-4 rotate-180" />
                                        </div>
                                        <p className="text-sm text-slate-500">Open your hotel page as a guest sees it</p>
                                    </div>
                                </a>
                            ) : (
                                <p className="text-sm text-slate-500">Finish the earlier steps and your hotel page preview will appear here.</p>
                            )}
                        </div>
                        <AgreementTick doc="host" checked={agreed} onChange={setAgreed} />
                        <p className="mt-3 text-sm text-slate-500">When you publish, your hotel goes to Galloway Getaways for a quick review before it appears to guests.</p>
                    </Step>
                )}

                {/* Next / Publish, bottom-right (Back is at the top). */}
                <div className="mt-8 flex justify-end">
                    {step < HOTEL_TOTAL_STEPS ? (
                        <button type="button" onClick={goNext} className="rounded-xl bg-emerald-700 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800">Next</button>
                    ) : (
                        <button type="button" onClick={publish} disabled={publishing} className="rounded-xl bg-emerald-700 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">{publishing ? 'Publishing…' : 'Publish'}</button>
                    )}
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

function Step({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
    return (
        <section>
            <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
            {hint && <p className="mt-1 mb-5 text-slate-600">{hint}</p>}
            {!hint && <div className="mb-5" />}
            {children}
        </section>
    );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</span>{children}</label>;
}
