'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter, useSearchParams } from 'next/navigation';
import Logo from '@/components/base/Logo';
import { HomeIcon, ChevronLeftIcon, Trees, Waves, Compass, Building2, Sparkles, Minus, Plus, Check, Snowflake, Package, Refrigerator, Thermometer, Droplet, UtensilsCrossed, Tv, RotateCw, Wifi, Coffee, Wind, Shirt, Zap, Baby, Briefcase, Car, Dumbbell, Bath, Flame, Armchair, Umbrella, Anchor, AlertTriangle, BellRing, Feather, Users, Gem, MapPin, Maximize2, PawPrint, KeyRound, Lock, DoorOpen, Hash } from 'lucide-react';
import LoginModel from '@/components/auth/LoginModel';
import { categories } from '@/config/categories';
import Env from '@/config/Env';
import { compressImage } from '@/lib/compressImage';
import { generateRandomNumber, timeInputValue } from '@/lib/utils';
import { toast } from 'react-toastify';
import { DEFAULT_COMMISSION_PERCENT } from '@/lib/fees';
import { buildLocation, splitLocation, DEFAULT_REGION } from '@/lib/places';
import { buildStreetAddress, tidyPostcode } from '@/lib/address';
import {
    problemAtStep as ruleAtStep,
    firstPublishProblem as firstProblemIn,
} from '@/lib/listingRules';

export default function AddHome() {
    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<any>(null);
    const [userName, setUserName] = useState('');
    // The flow opens straight on the wizard's first step ("Which of these best
    // describes your place?"). There used to be a landing screen before it — a
    // postcode/street lookup and an import-from-Airbnb box — but the address is
    // collected properly at step 3 (and coordinates are geocoded from the
    // postcode server-side on save), so the landing screen only sat in the way.
    const [showListingForm, setShowListingForm] = useState(true);
    
    // Listing form state
    const [title, setTitle] = useState('');
    const [price, setPrice] = useState('');
    const [country, setCountry] = useState('United Kingdom');
    const [city, setCity] = useState('');
    const [state, setState] = useState(DEFAULT_REGION);
    const [description, setDescription] = useState('');
    const [homeCategories, setHomeCategories] = useState<string[]>([]);
    const [photos, setPhotos] = useState<File[]>([]);
    const [coverIndex, setCoverIndex] = useState(0);
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState('');

    // Airbnb-style wizard state
    const [step, setStep] = useState(1);
    const TOTAL_STEPS = 9;
    const [propertyType, setPropertyType] = useState('');
    const [privacyType, setPrivacyType] = useState('Entire place');
    const [guests, setGuests] = useState(1);
    const [bedrooms, setBedrooms] = useState(1);
    const [beds, setBeds] = useState(1);
    const [bathrooms, setBathrooms] = useState(1);
    const [amenities, setAmenities] = useState<string[]>([]);
    const [checkInMethod, setCheckInMethod] = useState('');
    // Seeded with the old silent defaults, but now visible and changeable
    // before the listing is created rather than assumed afterwards.
    const [checkInTime, setCheckInTime] = useState('15:00');
    const [checkInEndTime, setCheckInEndTime] = useState('');
    const [checkOutTime, setCheckOutTime] = useState('11:00');
    const [latitude, setLatitude] = useState<number | null>(null);
    const [longitude, setLongitude] = useState<number | null>(null);
    const [selectedHighlights, setSelectedHighlights] = useState<string[]>([]);
    const [newListingPromo, setNewListingPromo] = useState(true);
    const [lastMinuteDiscount, setLastMinuteDiscount] = useState(false);
    const [weeklyDiscount, setWeeklyDiscount] = useState(false);
    const [monthlyDiscount, setMonthlyDiscount] = useState(false);

    const AMENITY_CATEGORIES: { category: string; items: { name: string; icon: any; note?: string }[] }[] = [
        {
            category: 'Basics',
            items: [
                { name: 'Air conditioning', icon: Snowflake },
                { name: 'Essentials', icon: Package, note: 'Towels, bed sheets, soap and toilet paper' },
                { name: 'Fridge', icon: Refrigerator },
                { name: 'Heating', icon: Thermometer },
                { name: 'Hot water', icon: Droplet },
                { name: 'Kitchen', icon: UtensilsCrossed },
                { name: 'TV', icon: Tv },
                { name: 'Tumble dryer', icon: Wind },
                { name: 'Washing machine', icon: RotateCw },
                { name: 'Wifi', icon: Wifi },
            ],
        },
        {
            category: 'Popular',
            items: [
                { name: 'Coffee maker', icon: Coffee },
                { name: 'Cooking basics', icon: Package, note: 'Pots and pans, oil, salt and pepper' },
                { name: 'Hairdryer', icon: Wind },
                { name: 'Hangers', icon: Shirt },
                { name: 'Iron', icon: Zap },
                { name: 'Shampoo', icon: Droplet },
            ],
        },
        {
            category: 'Features',
            items: [
                { name: 'Cot', icon: Baby },
                { name: 'Dedicated workspace', icon: Briefcase },
                { name: 'EV charger', icon: Zap },
                { name: 'Free parking on premises', icon: Car },
                { name: 'Gym', icon: Dumbbell },
                { name: 'Hot tub', icon: Bath },
                { name: 'Indoor fireplace', icon: Flame },
                { name: 'Outdoor furniture', icon: Armchair },
                { name: 'Pool', icon: Waves },
                { name: 'Pets allowed', icon: PawPrint },
            ],
        },
        {
            category: 'Location',
            items: [
                { name: 'Beach access', icon: Umbrella },
                { name: 'Waterfront', icon: Anchor },
            ],
        },
        {
            category: 'Safety',
            items: [
                { name: 'Carbon monoxide alarm', icon: AlertTriangle },
                { name: 'Smoke alarm', icon: BellRing },
            ],
        },
    ];

    // How guests get in. The method is public; the actual codes and key
    // locations belong in the check-in message, not on the listing.
    const CHECKIN_METHODS: { label: string; icon: any; note: string }[] = [
        { label: 'Lockbox', icon: KeyRound, note: 'Guests collect a key from a lockbox at the property.' },
        { label: 'Smart lock', icon: Lock, note: 'Guests let themselves in with a code on a smart lock.' },
        { label: 'Keypad', icon: Hash, note: 'A keypad on the door with a code you provide.' },
        { label: 'Host greets you', icon: Users, note: "You'll meet guests at the property to hand over keys." },
        { label: 'Keys collected nearby', icon: MapPin, note: 'Guests pick keys up from a nearby address.' },
        { label: 'Building staff', icon: DoorOpen, note: 'A concierge or building staff let guests in.' },
    ];

    const HIGHLIGHTS: { label: string; icon: any; phrase: string }[] = [
        { label: 'Peaceful', icon: Feather, phrase: 'a peaceful retreat' },
        { label: 'Unique', icon: Sparkles, phrase: 'a truly unique stay' },
        { label: 'Family-friendly', icon: Users, phrase: 'perfect for families' },
        { label: 'Stylish', icon: Gem, phrase: 'a stylish space' },
        { label: 'Central', icon: MapPin, phrase: 'in a central location' },
        { label: 'Spacious', icon: Maximize2, phrase: 'with plenty of space' },
    ];

    // Hosts absorb this fee — guests always pay exactly the nightly rate the
    // host sets, with no extra charge added at checkout.
    const HOST_FEE_PERCENT = DEFAULT_COMMISSION_PERCENT;

    const ICON_MAP: Record<string, any> = { Home: HomeIcon, Trees, Waves, Compass, Building2, Sparkles };

    // The address, collected on step 3 of the wizard. `flat` and `propertyName`
    // are no longer given their own boxes (they were only on the removed landing
    // modal) but are kept here so buildStreetAddress on save keeps its shape — a
    // host who has a flat or a house name folds it into the street line.
    const [flat] = useState('');
    const [propertyName] = useState('');
    const [street, setStreet] = useState('');
    const [postcode, setPostcode] = useState('');

    // There used to be a `locality` box as well as the Region box on step 3,
    // both holding the county. Picking a search result filled both, so the
    // county appeared twice. One field now — `state` — shown on both screens.

    const router = useRouter();
    const searchParams = useSearchParams();
    const supabase = createClientComponentClient();
    const [draftId, setDraftId] = useState<string | null>(null);
    const [savingDraft, setSavingDraft] = useState(false);

    useEffect(() => {
        const checkUser = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setSession(session);
            if (session?.user) {
                setUserName(session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'Host');
            }

            const resumeId = searchParams?.get('draft');
            if (resumeId && session?.user) {
                const { data: draft } = await supabase
                    // listing_private: the owner's view — the sensitive columns
                    // (street_address, coords, ical_token, commission_rate) are
                    // revoked from the base table for the browser role and only
                    // returned here, for your own listings.
                    .from('listing_private')
                    .select('*')
                    .eq('id', resumeId)
                    .eq('host_id', session.user.id)
                    .single();

                if (draft) {
                    setDraftId(draft.id);
                    setTitle(draft.title || '');
                    setDescription(draft.description || '');
                    setPrice(draft.price_per_night ? String(draft.price_per_night) : '');
                    setPropertyType(draft.property_type || '');
                    setPrivacyType(draft.privacy_type || 'Entire place');
                    setCheckInMethod(draft.check_in_method || '');
                    setCheckInTime(timeInputValue(draft.check_in_time) || '15:00');
                    setCheckInEndTime(timeInputValue(draft.check_in_end_time));
                    setCheckOutTime(timeInputValue(draft.check_out_time) || '11:00');
                    setLatitude(draft.latitude ?? null);
                    setLongitude(draft.longitude ?? null);
                    setGuests(draft.max_guests || 1);
                    setBedrooms(draft.bedrooms ?? 1);
                    setBeds(draft.beds ?? 1);
                    setBathrooms(draft.bathrooms ?? 1);
                    setAmenities(draft.amenities || []);
                    // This used to be setCity(location.split(',')[0]) and
                    // setState(location) — the whole string into the region
                    // box. Saving the draft again then folded the entire
                    // address back into itself, one comma at a time.
                    const place = splitLocation(draft.location);
                    setCity(place.town);
                    setState(place.region || DEFAULT_REGION);
                    setStreet(draft.street_address || '');
                    setPostcode(draft.postcode || '');
                    setNewListingPromo(draft.new_listing_promo ?? true);
                    setLastMinuteDiscount(draft.last_minute_discount ?? false);
                    setWeeklyDiscount(draft.weekly_discount ?? false);
                    setMonthlyDiscount(draft.monthly_discount ?? false);
                    setShowListingForm(true);
                }
            }

            setLoading(false);
        };

        checkUser();
    }, [supabase]);

    const saveDraft = async () => {
        const user = await supabase.auth.getUser();
        if (!user.data.user) return;

        setSavingDraft(true);
        try {
            const location = buildLocation(city, state);
            const payload = {
                host_id: user.data.user.id,
                title: title.trim(),
                description,
                location,
                street_address: buildStreetAddress(flat, propertyName, street) || null,
                postcode: postcode.trim() ? tidyPostcode(postcode) : null,
                price_per_night: price ? Number(price) : 0,
                max_guests: guests,
                property_type: propertyType,
                privacy_type: privacyType,
                bedrooms,
                beds,
                bathrooms,
                amenities,
                check_in_method: checkInMethod || null,
                check_in_time: checkInTime || '15:00',
                check_in_end_time: checkInEndTime || null,
                check_out_time: checkOutTime || '11:00',
                latitude,
                longitude,
                new_listing_promo: newListingPromo,
                last_minute_discount: lastMinuteDiscount,
                weekly_discount: weeklyDiscount,
                monthly_discount: monthlyDiscount,
                status: 'draft',
            };

            if (draftId) {
                await supabase.from('listings').update(payload).eq('id', draftId);
            } else {
                const { data } = await supabase.from('listings').insert(payload).select('id').single();
                if (data?.id) setDraftId(data.id);
            }

            toast.success('Saved — you can finish this listing later from your dashboard.', { theme: 'colored' });
            router.push('/dashboard');
        } catch (err: any) {
            toast.error(err?.message || 'Could not save your progress.', { theme: 'colored' });
        } finally {
            setSavingDraft(false);
        }
    };

    const [processingPhotos, setProcessingPhotos] = useState(false);

    const handlePhotosChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        if (!files.length) return;

        // Photos straight off a phone are far too big to upload, and iPhones
        // often hand over HEIC. Shrinking and re-encoding here means the
        // guest never sees a size error.
        setProcessingPhotos(true);
        setFormError('');

        const ready: File[] = [];
        for (const file of files) {
            try {
                ready.push(await compressImage(file));
            } catch (err) {
                setFormError('One of those photos couldn\u2019t be read. Try a different one.');
            }
        }

        if (ready.length) setPhotos((prev) => [...prev, ...ready]);
        setProcessingPhotos(false);
    };

    const removePhoto = (index: number) => {
        setPhotos((prev) => prev.filter((_, i) => i !== index));
        setCoverIndex((prev) => {
            if (index === prev) return 0;
            if (index < prev) return prev - 1;
            return prev;
        });
    };

    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

    const reorderPhotos = (fromIndex: number, toIndex: number) => {
        if (fromIndex === toIndex) return;
        setPhotos((prev) => {
            const next = [...prev];
            const [moved] = next.splice(fromIndex, 1);
            next.splice(toIndex, 0, moved);
            return next;
        });
        // Keep the cover photo pointing at the same actual photo after reordering.
        setCoverIndex((prev) => {
            if (prev === fromIndex) return toIndex;
            if (fromIndex < prev && toIndex >= prev) return prev - 1;
            if (fromIndex > prev && toIndex <= prev) return prev + 1;
            return prev;
        });
    };

    // This form's state, in the shape lib/listingRules.ts reads. Built in one
    // place so the step gating and the Publish button cannot end up asking
    // slightly different questions of it — which is how the two copies of
    // these rules drifted apart in the first place.
    //
    // Saving a draft is held to none of it — a half-finished draft is the point
    // of Save & finish later. This is only what a listing needs to go live.
    const asListing = () => ({
        propertyType: propertyType,
        flat: flat,
        propertyName: propertyName,
        street: street,
        city: city,
        region: state,
        postcode: postcode,
        photoCount: photos.length,
        title: title,
        description: description,
        price: price,
        amenities: amenities,
        checkInMethod: checkInMethod,
    });

    // What is still missing at a given step, or null if that step is done.
    const problemAtStep = (n: number): string | null => ruleAtStep(asListing(), n);

    // The first thing missing anywhere, with the step it belongs to.
    const firstPublishProblem = (): { step: number; message: string } | null =>
        firstProblemIn(asListing());

    const handleListingSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError('');

        const problem = firstPublishProblem();
        if (problem) {
            setFormError(problem.message);
            setStep(problem.step);
            return;
        }

        const tooBig = photos.find((p) => p.size / 1048576 >= 5);
        if (tooBig) {
            setFormError('One of those photos is still too large. Please try a different one.');
            return;
        }

        setSubmitting(true);

        try {
            const user = await supabase.auth.getUser();
            if (!user.data.user) {
                const msg = 'You need to be signed in to publish a listing.';
                toast.error(msg, { theme: 'colored' });
                setFormError(msg);
                return;
            }

            // Upload every photo, cover photo first so it lands at images[0].
            const orderedPhotos = [photos[coverIndex], ...photos.filter((_, i) => i !== coverIndex)];
            const uploadedPaths: string[] = [];
            for (const photo of orderedPhotos) {
                const uniquePath = Date.now() + '_' + generateRandomNumber();
                const { data: imgData, error: imgErr } = await supabase.storage
                    .from(Env.S3_BUCKET)
                    .upload(uniquePath, photo);

                if (imgErr) {
                    // Storage speaks in routes and buckets. A host saw
                    // "Route POST:/object/1788213666530_1948 not found", which
                    // says nothing they can act on and does not tell them the
                    // important part: their listing has NOT been saved, because
                    // photos upload before the row is written.
                    console.error('[addhome] photo upload failed', imgErr);
                    const msg = 'We couldn\u2019t upload your photos, so nothing has been saved yet. '
                        + 'Your details are still on this page \u2014 try again in a moment, or use '
                        + '\u201CSave & finish later\u201D to keep them.';
                    toast.error(msg, { theme: 'colored' });
                    setFormError(msg);
                    return;
                }
                if (imgData?.path) uploadedPaths.push(imgData.path);
            }

            // `location` is the public one — town and region only. The street
            // goes to its own column below, and the postcode, country, flat and
            // property name are not part of it at all. Built by the same helper
            // the draft save uses, so a draft and a published listing cannot
            // disagree about what this listing's location is.
            const location = buildLocation(city, state);

            // The content is written WITHOUT a status. Publishing is no longer
            // something the browser may do — 20260829020000 lets a browser role
            // create a draft and change no status at all — so the row is saved
            // as a draft and then handed to /api/listings/publish, which is the
            // one place allowed to make it live (and where the review gate will
            // one day sit). A draft that fails to publish is still saved, so
            // nothing the host typed is lost.
            const fields = {
                title: title.trim(),
                description,
                location,
                street_address: buildStreetAddress(flat, propertyName, street) || null,
                postcode: postcode.trim() ? tidyPostcode(postcode) : null,
                price_per_night: Number(price),
                max_guests: guests,
                images: uploadedPaths,
                property_type: propertyType,
                privacy_type: privacyType,
                bedrooms,
                beds,
                bathrooms,
                amenities,
                check_in_method: checkInMethod || null,
                check_in_time: checkInTime || '15:00',
                check_in_end_time: checkInEndTime || null,
                check_out_time: checkOutTime || '11:00',
                latitude,
                longitude,
                new_listing_promo: newListingPromo,
                last_minute_discount: lastMinuteDiscount,
                weekly_discount: weeklyDiscount,
                monthly_discount: monthlyDiscount,
            };

            const { data: saved, error: listingErr } = draftId
                ? await supabase.from('listings').update(fields).eq('id', draftId).select('id').single()
                : await supabase.from('listings').insert({ host_id: user.data.user.id, ...fields }).select('id').single();

            if (listingErr) {
                toast.error(listingErr.message, { theme: 'colored' });
                setFormError(`Could not save listing: ${listingErr.message}`);
                return;
            }

            const listingId = saved?.id || draftId;

            const publishRes = await fetch('/api/listings/publish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ listingId }),
            });
            const publishBody = await publishRes.json().catch(() => ({}));

            if (!publishRes.ok || !publishBody.ok) {
                const msg = (publishBody && publishBody.error)
                    || 'Your listing was saved as a draft but could not be published. Please try again.';
                toast.error(msg, { theme: 'colored' });
                setFormError(msg);
                return;
            }

            router.push('/dashboard?success=Home added successfully!');
        } catch (err: any) {
            const msg = err?.message || 'Something went wrong publishing your listing. Please try again.';
            toast.error(msg, { theme: 'colored' });
            setFormError(msg);
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[80vh] space-y-4">
                <Logo />
                <p className="text-lg font-medium text-slate-600 animate-pulse">
                    Please wait while we load Galloway Getaways for you...
                </p>
            </div>
        );
    }

    if (!session) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-6 text-center px-4">
                <Logo />
                <h1 className="text-2xl font-bold text-slate-900">Sign in to become a host</h1>
                <p className="text-slate-600 max-w-md">
                    You need to be logged into your Galloway Getaways account to create and manage listings.
                </p>
                <div className="flex space-x-4">
                    <LoginModel />
                </div>
            </div>
        );
    }

    if (showListingForm) {
        const goBack = () => {
            setFormError('');
            // Back on the first step leaves the flow. There is no longer a
            // landing screen behind it, so this returns to the dashboard.
            if (step > 1) setStep(step - 1);
            else router.push('/dashboard');
        };

        const goNext = () => {
            setFormError('');
            const problem = problemAtStep(step);
            if (problem) {
                setFormError(problem);
                return;
            }
            setStep(step + 1);
        };

        const toggleAmenity = (name: string) => {
            setAmenities((prev) =>
                prev.includes(name) ? prev.filter((a) => a !== name) : [...prev, name]
            );
        };

        const Counter = ({ label, value, onChange, min = 0 }: { label: string; value: number; onChange: (v: number) => void; min?: number }) => (
            <div className="flex items-center justify-between py-4 border-b">
                <span className="font-medium text-slate-800">{label}</span>
                <div className="flex items-center space-x-4">
                    <button
                        type="button"
                        onClick={() => onChange(Math.max(min, value - 1))}
                        className="w-8 h-8 rounded-full border flex items-center justify-center text-slate-600 hover:border-slate-900 disabled:opacity-30"
                        disabled={value <= min}
                    >
                        <Minus className="w-4 h-4" />
                    </button>
                    <span className="w-6 text-center">{value}</span>
                    <button
                        type="button"
                        onClick={() => onChange(value + 1)}
                        className="w-8 h-8 rounded-full border flex items-center justify-center text-slate-600 hover:border-slate-900"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>
            </div>
        );

        return (
            <div className="max-w-3xl mx-auto px-6 py-10 w-full">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-2xl font-extrabold text-emerald-800">Galloway Getaways</h1>
                    <div className="flex items-center gap-4">
                        <button
                            onClick={saveDraft}
                            disabled={savingDraft}
                            className="text-sm font-semibold underline text-slate-600 hover:text-black disabled:opacity-50"
                        >
                            {savingDraft ? 'Saving...' : 'Save & finish later'}
                        </button>
                        <button
                            onClick={() => router.push('/dashboard')}
                            className="text-sm font-semibold underline text-slate-600 hover:text-black"
                        >
                            Back to dashboard
                        </button>
                    </div>
                </div>

                {/* Progress bar */}
                <div className="flex space-x-1 mb-10">
                    {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
                        <div
                            key={i}
                            className={`h-1.5 flex-1 rounded-full ${i < step ? 'bg-emerald-700' : 'bg-slate-200'}`}
                        />
                    ))}
                </div>

                {/* Step 1: Property type */}
                {step === 1 && (
                    <div>
                        <h2 className="text-3xl font-extrabold text-slate-900 mb-2">Which of these best describes your place?</h2>
                        <p className="text-slate-600 mb-8">Pick the closest match — you can fine-tune details later.</p>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                            {categories.map((item) => {
                                const Icon = ICON_MAP[item.icon] || HomeIcon;
                                const selected = propertyType === item.name;
                                return (
                                    <button
                                        key={item.name}
                                        type="button"
                                        onClick={() => {
                                            setPropertyType(item.name);
                                            setHomeCategories([item.name]);
                                        }}
                                        className={`p-5 rounded-2xl border-2 text-left transition ${selected ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}
                                    >
                                        <Icon className="w-6 h-6 mb-3 text-slate-700" />
                                        <div className="font-semibold text-slate-900">{item.name}</div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Step 2: Privacy type */}
                {step === 2 && (
                    <div>
                        <h2 className="text-3xl font-extrabold text-slate-900 mb-2">What will guests have?</h2>
                        <p className="text-slate-600 mb-8">Choose how much of the place guests get.</p>
                        <div className="space-y-4">
                            {['Entire place', 'A private room', 'A shared room'].map((option) => (
                                <button
                                    key={option}
                                    type="button"
                                    onClick={() => setPrivacyType(option)}
                                    className={`w-full p-5 rounded-2xl border-2 text-left transition flex items-center justify-between ${privacyType === option ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}
                                >
                                    <span className="font-semibold text-slate-900">{option}</span>
                                    {privacyType === option && <Check className="w-5 h-5 text-slate-900" />}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Step 3: Location */}
                {step === 3 && (
                    <div>
                        <h2 className="text-3xl font-extrabold text-slate-900 mb-2">Confirm your location</h2>
                        {/* Only claim a lookup happened when one did. A host
                            who chose "skip to manual listing form", or who hit
                            the lookup while it was unavailable, arrives here
                            with four empty boxes under a line telling them this
                            is what we found. */}
                        <p className="text-slate-600 mb-8">
                            {street || city || postcode
                                ? 'This is what we found from your address search — check it over.'
                                : 'Where is your place? Guests only ever see the town and region.'}
                        </p>
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs text-slate-500 font-semibold uppercase">Street address</label>
                                <input type="text" value={street} onChange={(e) => setStreet(e.target.value)} className="w-full p-3 border rounded-xl mt-1" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-slate-500 font-semibold uppercase">Town / city</label>
                                    <input type="text" value={city} onChange={(e) => setCity(e.target.value)} className="w-full p-3 border rounded-xl mt-1" required />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-500 font-semibold uppercase">Region</label>
                                    <input type="text" value={state} onChange={(e) => setState(e.target.value)} className="w-full p-3 border rounded-xl mt-1" required />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-slate-500 font-semibold uppercase">Postcode</label>
                                    <input type="text" value={postcode} onChange={(e) => setPostcode(e.target.value)} className="w-full p-3 border rounded-xl mt-1" required />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-500 font-semibold uppercase">Country</label>
                                    <input type="text" value={country} onChange={(e) => setCountry(e.target.value)} className="w-full p-3 border rounded-xl mt-1" />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Step 4: Capacity */}
                {step === 4 && (
                    <div>
                        <h2 className="text-3xl font-extrabold text-slate-900 mb-2">Share some basics about your place</h2>
                        <p className="text-slate-600 mb-8">You'll add more details later. For now, let's cover the essentials.</p>
                        <div>
                            <Counter label="Guests" value={guests} onChange={setGuests} min={1} />
                            <Counter label="Bedrooms" value={bedrooms} onChange={setBedrooms} min={0} />
                            <Counter label="Beds" value={beds} onChange={setBeds} min={1} />
                            <Counter label="Bathrooms" value={bathrooms} onChange={setBathrooms} min={0.5} />
                        </div>

                        <div className="mt-10 pt-8 border-t">
                            <h3 className="text-xl font-bold text-slate-900 mb-1">How will guests get in?</h3>
                            <p className="text-slate-600 text-sm mb-5">
                                Guests see this before they book. You&apos;ll send the actual codes and key
                                details privately once a booking is confirmed.
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {CHECKIN_METHODS.map(({ label, icon: Icon, note }) => {
                                    const selected = checkInMethod === label;
                                    return (
                                        <button
                                            key={label}
                                            type="button"
                                            onClick={() => setCheckInMethod(selected ? '' : label)}
                                            className={`text-left border-2 rounded-2xl p-4 transition ${selected ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}
                                        >
                                            <Icon className="w-5 h-5 text-slate-700 mb-2" />
                                            <div className="font-semibold text-slate-900 text-sm">{label}</div>
                                            <div className="text-xs text-slate-500 mt-0.5">{note}</div>
                                        </button>
                                    );
                                })}
                            </div>

                            <h3 className="text-xl font-bold text-slate-900 mt-10 mb-1">When can they arrive?</h3>
                            <p className="text-slate-600 text-sm mb-5">
                                Guests see these on your listing and in their booking confirmation. You
                                can change them later.
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-lg">
                                <div>
                                    <label className="text-xs text-slate-500">Check-in from</label>
                                    <input
                                        type="time"
                                        value={checkInTime}
                                        onChange={(e) => setCheckInTime(e.target.value)}
                                        className="w-full p-2.5 border rounded-lg text-sm mt-1"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-500">Check-in until</label>
                                    <input
                                        type="time"
                                        value={checkInEndTime}
                                        onChange={(e) => setCheckInEndTime(e.target.value)}
                                        className="w-full p-2.5 border rounded-lg text-sm mt-1"
                                    />
                                    <p className="text-xs text-slate-400 mt-1">Optional.</p>
                                </div>
                                <div>
                                    <label className="text-xs text-slate-500">Checkout by</label>
                                    <input
                                        type="time"
                                        value={checkOutTime}
                                        onChange={(e) => setCheckOutTime(e.target.value)}
                                        className="w-full p-2.5 border rounded-lg text-sm mt-1"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Step 5: Amenities */}
                {step === 5 && (
                    <div>
                        <h2 className="text-3xl font-extrabold text-slate-900 mb-2">Tell guests what your place offers</h2>
                        <p className="text-slate-600 mb-2">Select all the amenities you provide.</p>
                        <p className="text-sm text-slate-400 mb-8">{amenities.length} selected</p>

                        <div className="space-y-8">
                            {AMENITY_CATEGORIES.map(({ category, items }) => (
                                <div key={category}>
                                    <h3 className="font-bold text-slate-900 mb-3">{category}</h3>
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                        {items.map(({ name, icon: Icon, note }) => {
                                            const selected = amenities.includes(name);
                                            return (
                                                <button
                                                    key={name}
                                                    type="button"
                                                    onClick={() => toggleAmenity(name)}
                                                    className={`p-4 rounded-2xl border-2 text-left transition relative ${selected ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}
                                                >
                                                    <Icon className="w-5 h-5 mb-3 text-slate-700" />
                                                    <div className="text-sm font-semibold text-slate-900">{name}</div>
                                                    {note && <div className="text-xs text-slate-400 mt-0.5">{note}</div>}
                                                    {selected && <Check className="w-4 h-4 text-slate-900 absolute top-4 right-4" />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Step 6: Photos */}
                {step === 6 && (
                    <div>
                        <h2 className="text-3xl font-extrabold text-slate-900 mb-2">Add photos of your place</h2>
                        <p className="text-slate-600 mb-2">Upload as many as you like, then click the star on your favourite to make it the cover photo guests see first.</p>
                        <p className="text-xs text-slate-400 mb-8">Drag photos to reorder them — the order here is the order guests see them in.</p>

                        {photos.length > 0 && (
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                                {photos.map((photo, i) => (
                                    <div
                                        key={i}
                                        draggable
                                        onDragStart={() => setDraggedIndex(i)}
                                        onDragEnter={() => {
                                            if (draggedIndex !== null && draggedIndex !== i) setDragOverIndex(i);
                                        }}
                                        onDragOver={(e) => e.preventDefault()}
                                        onDrop={() => {
                                            if (draggedIndex !== null) reorderPhotos(draggedIndex, i);
                                            setDraggedIndex(null);
                                            setDragOverIndex(null);
                                        }}
                                        onDragEnd={() => {
                                            setDraggedIndex(null);
                                            setDragOverIndex(null);
                                        }}
                                        className={`relative h-40 rounded-2xl overflow-hidden border-2 group cursor-grab active:cursor-grabbing transition ${
                                            i === coverIndex ? 'border-emerald-700' : 'border-slate-200'
                                        } ${dragOverIndex === i ? 'ring-2 ring-slate-900 scale-95' : ''} ${
                                            draggedIndex === i ? 'opacity-40' : ''
                                        }`}
                                    >
                                        <img
                                            src={URL.createObjectURL(photo)}
                                            alt={`Photo ${i + 1}`}
                                            className="w-full h-full object-cover pointer-events-none"
                                        />
                                        <div className="absolute top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-black/40 text-white text-xs opacity-0 group-hover:opacity-100 transition flex items-center gap-1">
                                            <span>⠿</span> Drag to reorder
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setCoverIndex(i)}
                                            title={i === coverIndex ? 'Cover photo' : 'Make cover photo'}
                                            className={`absolute bottom-2 left-2 w-8 h-8 rounded-full flex items-center justify-center text-sm shadow ${i === coverIndex ? 'bg-emerald-700 text-white' : 'bg-white/90 text-slate-600 opacity-0 group-hover:opacity-100 transition'}`}
                                        >
                                            ★
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => removePhoto(i)}
                                            title="Remove photo"
                                            className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-white/90 text-slate-600 flex items-center justify-center text-sm shadow opacity-0 group-hover:opacity-100 transition"
                                        >
                                            ×
                                        </button>
                                        {i === coverIndex && (
                                            <span className="absolute top-2 left-2 text-xs font-semibold bg-emerald-700 text-white px-2 py-0.5 rounded-full">
                                                Cover photo
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}

                        <label className="h-32 rounded-2xl border-2 border-dashed border-slate-300 hover:border-slate-400 flex flex-col items-center justify-center cursor-pointer text-slate-500 text-sm">
                            <span className="font-semibold mb-1">+ Add photos</span>
                            <span>{processingPhotos ? 'Preparing your photos...' : 'Straight from your phone is fine'}</span>
                            <input
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={handlePhotosChange}
                                className="hidden"
                            />
                        </label>
                    </div>
                )}

                {/* Step 7: Title & description */}
                {step === 7 && (
                    <div className="space-y-6">
                        <div>
                            <h2 className="text-3xl font-extrabold text-slate-900 mb-2">Give your place a title</h2>
                            <input
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="e.g. Cosy stone cottage near the coast"
                                // A title is a headline, not a paragraph. Left
                                // uncapped it becomes a wall of text in the page
                                // <h1> and browser tab; 80 is roomy for a real one.
                                maxLength={80}
                                className="w-full p-4 border rounded-xl text-lg"
                            />
                        </div>
                        <div>
                            <h2 className="text-2xl font-extrabold text-slate-900 mb-2">Next, let's describe your house</h2>
                            <p className="text-slate-600 text-sm mb-4">Choose up to 2 highlights — we'll suggest a line for your description.</p>
                            <div className="flex flex-wrap gap-3 mb-4">
                                {HIGHLIGHTS.map(({ label, icon: Icon }) => {
                                    const selected = selectedHighlights.includes(label);
                                    return (
                                        <button
                                            key={label}
                                            type="button"
                                            onClick={() => {
                                                if (selected) {
                                                    setSelectedHighlights(selectedHighlights.filter((h) => h !== label));
                                                } else if (selectedHighlights.length < 2) {
                                                    setSelectedHighlights([...selectedHighlights, label]);
                                                }
                                            }}
                                            className={`flex items-center px-4 py-2.5 rounded-full border-2 text-sm font-semibold transition ${selected ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}
                                        >
                                            <Icon className="w-4 h-4 mr-2" /> {label}
                                        </button>
                                    );
                                })}
                            </div>
                            {selectedHighlights.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        const phrases = HIGHLIGHTS.filter((h) => selectedHighlights.includes(h.label)).map((h) => h.phrase);
                                        const suggestion = `This is ${phrases.join(' and ')}.`;
                                        setDescription((prev) => (prev ? `${prev}\n\n${suggestion}` : suggestion));
                                    }}
                                    className="text-sm font-semibold text-emerald-700 hover:text-emerald-800 mb-4"
                                >
                                    + Add this to my description
                                </button>
                            )}
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={5}
                                placeholder="What makes your place special?"
                                className="w-full p-4 border rounded-xl"
                            />
                        </div>
                    </div>
                )}

                {/* Step 8: Discounts */}
                {step === 8 && (
                    <div>
                        <h2 className="text-3xl font-extrabold text-slate-900 mb-2">Add discounts</h2>
                        <p className="text-slate-600 mb-8">Help your place stand out to get booked faster and earn your first reviews.</p>
                        <div className="space-y-4">
                            {[
                                { key: 'newListingPromo', percent: '20%', title: 'New listing promotion', note: 'Available until your listing has 3 reviews or gets booked 10 times', value: newListingPromo, set: setNewListingPromo },
                                { key: 'lastMinuteDiscount', percent: '5%', title: 'Last-minute discount', note: 'For stays booked 14 days or less before arrival', value: lastMinuteDiscount, set: setLastMinuteDiscount },
                                { key: 'weeklyDiscount', percent: '10%', title: 'Weekly discount', note: 'For stays of 7 nights or more', value: weeklyDiscount, set: setWeeklyDiscount },
                                { key: 'monthlyDiscount', percent: '20%', title: 'Monthly discount', note: 'For stays of 28 nights or more', value: monthlyDiscount, set: setMonthlyDiscount },
                            ].map((d) => (
                                <button
                                    key={d.key}
                                    type="button"
                                    onClick={() => d.set(!d.value)}
                                    className={`w-full flex items-center justify-between p-5 rounded-2xl border-2 text-left transition ${d.value ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}
                                >
                                    <div className="flex items-center">
                                        <span className="text-lg font-bold text-slate-900 w-14">{d.percent}</span>
                                        <div>
                                            <div className="font-semibold text-slate-900">{d.title}</div>
                                            <div className="text-sm text-slate-500">{d.note}</div>
                                        </div>
                                    </div>
                                    <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ml-4 ${d.value ? 'bg-slate-900' : 'border-2 border-slate-300'}`}>
                                        {d.value && <Check className="w-4 h-4 text-white" />}
                                    </div>
                                </button>
                            ))}
                        </div>
                        <p className="text-xs text-slate-400 mt-4">Only one discount is applied per stay.</p>
                    </div>
                )}

                {/* Step 9: Price + review */}
                {step === 9 && (
                    <form onSubmit={handleListingSubmit}>
                        <h2 className="text-3xl font-extrabold text-slate-900 mb-2">Now, set your price</h2>
                        <p className="text-slate-600 mb-6">You can change this anytime.</p>
                        <div className="flex items-center border-2 rounded-2xl px-5 py-4 mb-3 max-w-xs">
                            <span className="text-3xl font-black text-slate-900 mr-2">£</span>
                            <input
                                type="number"
                                value={price}
                                onChange={(e) => setPrice(e.target.value)}
                                placeholder="0"
                                className="text-3xl font-black text-slate-900 outline-none w-full"
                                required
                            />
                            <span className="text-slate-500 ml-2">/ night</span>
                        </div>

                        {Number(price) > 0 && (
                            <div className="bg-slate-50 rounded-2xl border p-5 mb-8 max-w-xs text-sm">
                                <div className="flex justify-between text-slate-600 mb-2">
                                    <span>Guest pays</span>
                                    <span className="font-medium text-slate-900">£{Number(price).toFixed(2)} / night</span>
                                </div>
                                <div className="flex justify-between text-slate-600 mb-2">
                                    <span>Host fee ({HOST_FEE_PERCENT}%)</span>
                                    <span className="font-medium text-slate-900">
                                        − £{(Number(price) * HOST_FEE_PERCENT / 100).toFixed(2)}
                                    </span>
                                </div>
                                <div className="flex justify-between pt-2 border-t border-slate-200">
                                    <span className="font-semibold text-slate-900">You receive</span>
                                    <span className="font-bold text-emerald-700">
                                        £{(Number(price) * (1 - HOST_FEE_PERCENT / 100)).toFixed(2)} / night
                                    </span>
                                </div>
                                <p className="text-xs text-slate-400 mt-3">
                                    Guests are never charged extra — this {HOST_FEE_PERCENT}% covers payment processing and platform costs, deducted from your payout.
                                </p>
                            </div>
                        )}

                        <div className="bg-slate-50 rounded-2xl border p-6 mb-6">
                            <h3 className="font-bold text-slate-900 mb-3">Review your listing</h3>
                            <ul className="text-sm text-slate-600 space-y-1">
                                <li><span className="font-medium text-slate-800">Type:</span> {propertyType || '—'} · {privacyType}</li>
                                <li><span className="font-medium text-slate-800">Location:</span> {[city, state].filter(Boolean).join(', ') || '—'}</li>
                                <li><span className="font-medium text-slate-800">Guests:</span> {guests} · {bedrooms} bedrooms · {beds} beds · {bathrooms} bathrooms</li>
                                <li><span className="font-medium text-slate-800">Amenities:</span> {amenities.length ? amenities.join(', ') : 'None selected'}</li>
                                <li><span className="font-medium text-slate-800">Title:</span> {title || '—'}</li>
                                <li><span className="font-medium text-slate-800">Discounts:</span> {[
                                    newListingPromo && 'New listing 20%',
                                    lastMinuteDiscount && 'Last-minute 5%',
                                    weeklyDiscount && 'Weekly 10%',
                                    monthlyDiscount && 'Monthly 20%',
                                ].filter(Boolean).join(', ') || 'None selected'}</li>
                            </ul>
                        </div>

                        {formError && <p className="text-red-600 text-sm mb-4">{formError}</p>}

                        <button
                            type="submit"
                            disabled={submitting}
                            className="w-full py-4 bg-emerald-700 text-white font-bold rounded-xl hover:bg-emerald-800 transition disabled:opacity-60"
                        >
                            {submitting ? 'Publishing...' : 'Publish listing'}
                        </button>
                    </form>
                )}

                {formError && step !== TOTAL_STEPS && <p className="text-red-600 text-sm mt-6">{formError}</p>}

                {/* Nav buttons (all steps except the last, which has its own submit button above) */}
                {step !== TOTAL_STEPS && (
                    <div className="flex justify-between items-center mt-10 pt-6 border-t">
                        <button
                            type="button"
                            onClick={goBack}
                            className="flex items-center text-sm font-semibold text-slate-700 hover:text-black"
                        >
                            <ChevronLeftIcon className="w-4 h-4 mr-1" /> Back
                        </button>
                        <button
                            type="button"
                            onClick={goNext}
                            className="px-8 py-3 bg-slate-900 hover:bg-black text-white font-bold rounded-xl transition"
                        >
                            Next
                        </button>
                    </div>
                )}
                {step === TOTAL_STEPS && (
                    <button
                        type="button"
                        onClick={goBack}
                        className="flex items-center text-sm font-semibold text-slate-700 hover:text-black mt-6"
                    >
                        <ChevronLeftIcon className="w-4 h-4 mr-1" /> Back
                    </button>
                )}
            </div>
        );
    }

    // Unreachable for a signed-in host: the wizard above always renders. Kept
    // as a typed fallback so every code path returns.
    return null;
}
