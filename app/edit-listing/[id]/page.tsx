'use client';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter, useParams } from 'next/navigation';
import Logo from '@/components/base/Logo';
import LoginModel from '@/components/auth/LoginModel';
import { categories } from '@/config/categories';
import Env from '@/config/Env';
import { generateRandomNumber, getImageUrl } from '@/lib/utils';
import { toast } from 'react-toastify';
import {
    HomeIcon, Trees, Waves, Compass, Building2, Sparkles, Minus, Plus, Check,
    KeyRound, Lock, DoorOpen, Hash, Users, MapPin,
    Snowflake, Package, Refrigerator, Thermometer, Droplet, UtensilsCrossed, Tv,
    RotateCw, Wifi, Coffee, Wind, Shirt, Zap, Baby, Briefcase, Car, Dumbbell, Bath,
    Flame, Armchair, Umbrella, Anchor, AlertTriangle, BellRing, PawPrint,
    LayoutGrid, MapPin, FileText, Image as ImageIcon, PoundSterling, CalendarRange,
    RefreshCw, Percent, ShieldAlert, RotateCcw, X,
} from 'lucide-react';

const ICON_MAP: Record<string, any> = { Home: HomeIcon, Trees, Waves, Compass, Building2, Sparkles };

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

const HOST_FEE_PERCENT = 10;

const SECTIONS = [
    { key: 'basics', label: 'Basics & guests', icon: LayoutGrid },
    { key: 'location', label: 'Location', icon: MapPin },
    { key: 'description', label: 'Description', icon: FileText },
    { key: 'amenities', label: 'Amenities', icon: Sparkles },
    { key: 'photos', label: 'Photos', icon: ImageIcon },
    { key: 'rates', label: 'Rates', icon: PoundSterling },
    { key: 'availability', label: 'Availability', icon: CalendarRange },
    { key: 'rules', label: 'House rules', icon: ShieldAlert },
    { key: 'cancellation', label: 'Cancellation policy', icon: RotateCcw },
    { key: 'calendar', label: 'Calendar sync', icon: RefreshCw },
    { key: 'discounts', label: 'Discounts', icon: Percent },
];

const CANCELLATION_POLICIES = [
    { key: 'Flexible', bullets: ['Full refund at least 1 day before check-in', 'Partial refund within 1 day of check-in'] },
    { key: 'Moderate', bullets: ['Full refund at least 5 days before check-in', 'Partial refund within 5 days of check-in'] },
    { key: 'Limited', bullets: ['Full refund at least 14 days before check-in', 'Partial refund 7–14 days before check-in'] },
    { key: 'Firm', bullets: ['Full refund at least 30 days before check-in', 'Partial refund 7–30 days before check-in'] },
];

type Photo = { kind: 'existing'; path: string } | { kind: 'new'; file: File };

export default function EditListing() {
    const params = useParams();
    const listingId = params?.id as string;
    const router = useRouter();
    const supabase = createClientComponentClient();

    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<any>(null);
    const [notFound, setNotFound] = useState(false);
    const [notOwner, setNotOwner] = useState(false);
    const [activeSection, setActiveSection] = useState('basics');

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [location, setLocation] = useState('');
    const [price, setPrice] = useState('');
    const [propertyType, setPropertyType] = useState('');
    const [privacyType, setPrivacyType] = useState('Entire place');
    const [guests, setGuests] = useState(1);
    const [bedrooms, setBedrooms] = useState(1);
    const [beds, setBeds] = useState(1);
    const [bathrooms, setBathrooms] = useState(1);
    const [amenities, setAmenities] = useState<string[]>([]);
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [coverIndex, setCoverIndex] = useState(0);
    const [checkInMethod, setCheckInMethod] = useState('');

    const CHECKIN_METHODS: { label: string; icon: any; note: string }[] = [
        { label: 'Lockbox', icon: KeyRound, note: 'Guests collect a key from a lockbox at the property.' },
        { label: 'Smart lock', icon: Lock, note: 'Guests let themselves in with a code on a smart lock.' },
        { label: 'Keypad', icon: Hash, note: 'A keypad on the door with a code you provide.' },
        { label: 'Host greets you', icon: Users, note: "You'll meet guests at the property to hand over keys." },
        { label: 'Keys collected nearby', icon: MapPin, note: 'Guests pick keys up from a nearby address.' },
        { label: 'Building staff', icon: DoorOpen, note: 'A concierge or building staff let guests in.' },
    ];
    const [newListingPromo, setNewListingPromo] = useState(true);
    const [lastMinuteDiscount, setLastMinuteDiscount] = useState(false);
    const [weeklyDiscount, setWeeklyDiscount] = useState(false);
    const [monthlyDiscount, setMonthlyDiscount] = useState(false);
    const [icalImportUrl, setIcalImportUrl] = useState('');
    const [minNights, setMinNights] = useState('1');
    const [maxNights, setMaxNights] = useState('');
    const [eventsAllowed, setEventsAllowed] = useState(false);
    const [smokingAllowed, setSmokingAllowed] = useState(false);
    const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);
    const [quietHoursStart, setQuietHoursStart] = useState('22:00');
    const [quietHoursEnd, setQuietHoursEnd] = useState('07:00');
    const [commercialPhotographyAllowed, setCommercialPhotographyAllowed] = useState(false);
    const [checkinStart, setCheckinStart] = useState('15:00');
    const [checkinEnd, setCheckinEnd] = useState('');
    const [checkoutTime, setCheckoutTime] = useState('11:00');
    const [additionalRules, setAdditionalRules] = useState('');
    const [cancellationPolicy, setCancellationPolicy] = useState('Moderate');
    const [nonRefundableOption, setNonRefundableOption] = useState(false);

    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState('');
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

    useEffect(() => {
        const load = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setSession(session);

            if (!session?.user || !listingId) {
                setLoading(false);
                return;
            }

            const { data: listing, error } = await supabase
                .from('listings')
                .select('*')
                .eq('id', listingId)
                .single();

            if (error || !listing) {
                setNotFound(true);
                setLoading(false);
                return;
            }

            if (listing.host_id !== session.user.id) {
                setNotOwner(true);
                setLoading(false);
                return;
            }

            setTitle(listing.title || '');
            setDescription(listing.description || '');
            setLocation(listing.location || '');
            setPrice(String(listing.price_per_night ?? ''));
            setPropertyType(listing.property_type || '');
            setPrivacyType(listing.privacy_type || 'Entire place');
            setGuests(listing.max_guests || 1);
            setBedrooms(listing.bedrooms ?? 1);
            setBeds(listing.beds ?? 1);
            setBathrooms(listing.bathrooms ?? 1);
            setAmenities(listing.amenities || []);
            setPhotos((listing.images || []).map((path: string) => ({ kind: 'existing', path })));
            setNewListingPromo(listing.new_listing_promo ?? true);
            setLastMinuteDiscount(listing.last_minute_discount ?? false);
            setWeeklyDiscount(listing.weekly_discount ?? false);
            setMonthlyDiscount(listing.monthly_discount ?? false);
            setIcalImportUrl(listing.ical_import_url || '');
            setMinNights(String(listing.min_nights ?? 1));
            setMaxNights(listing.max_nights ? String(listing.max_nights) : '');
            setEventsAllowed(listing.events_allowed ?? false);
            setSmokingAllowed(listing.smoking_allowed ?? false);
            setQuietHoursEnabled(listing.quiet_hours_enabled ?? false);
            setCheckInMethod(listing.check_in_method || '');
            setQuietHoursStart(listing.quiet_hours_start || '22:00');
            setQuietHoursEnd(listing.quiet_hours_end || '07:00');
            setCommercialPhotographyAllowed(listing.commercial_photography_allowed ?? false);
            setCheckinStart(listing.checkin_start || '15:00');
            setCheckinEnd(listing.checkin_end || '');
            setCheckoutTime(listing.checkout_time || '11:00');
            setAdditionalRules(listing.additional_rules || '');
            setCancellationPolicy(listing.cancellation_policy || 'Moderate');
            setNonRefundableOption(listing.non_refundable_option ?? false);

            setLoading(false);
        };
        load();
    }, [supabase, listingId]);

    const toggleAmenity = (name: string) => {
        setAmenities((prev) => (prev.includes(name) ? prev.filter((a) => a !== name) : [...prev, name]));
    };

    const handlePhotosChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length) setPhotos((prev) => [...prev, ...files.map((file) => ({ kind: 'new' as const, file }))]);
        e.target.value = '';
    };

    const removePhoto = (index: number) => {
        setPhotos((prev) => prev.filter((_, i) => i !== index));
        setCoverIndex((prev) => {
            if (index === prev) return 0;
            if (index < prev) return prev - 1;
            return prev;
        });
    };

    const reorderPhotos = (fromIndex: number, toIndex: number) => {
        if (fromIndex === toIndex) return;
        setPhotos((prev) => {
            const next = [...prev];
            const [moved] = next.splice(fromIndex, 1);
            next.splice(toIndex, 0, moved);
            return next;
        });
        setCoverIndex((prev) => {
            if (prev === fromIndex) return toIndex;
            if (fromIndex < prev && toIndex >= prev) return prev - 1;
            if (fromIndex > prev && toIndex <= prev) return prev + 1;
            return prev;
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError('');

        if (photos.length === 0) {
            setFormError('Please keep at least one photo of your place.');
            return;
        }
        if (!title || !price) {
            setFormError('Please fill in a title and price.');
            return;
        }
        if (maxNights && Number(maxNights) < Number(minNights || 1)) {
            setFormError('Maximum nights can\'t be less than minimum nights.');
            return;
        }

        setSubmitting(true);
        try {
            const orderedPhotos = [photos[coverIndex], ...photos.filter((_, i) => i !== coverIndex)];
            const finalPaths: string[] = [];

            for (const photo of orderedPhotos) {
                if (photo.kind === 'existing') {
                    finalPaths.push(photo.path);
                } else {
                    const uniquePath = Date.now() + '_' + generateRandomNumber();
                    const { data: imgData, error: imgErr } = await supabase.storage
                        .from(Env.S3_BUCKET)
                        .upload(uniquePath, photo.file);

                    if (imgErr) {
                        toast.error(imgErr.message, { theme: 'colored' });
                        setFormError(`Photo upload failed: ${imgErr.message}`);
                        setSubmitting(false);
                        return;
                    }
                    if (imgData?.path) finalPaths.push(imgData.path);
                }
            }

            const { error: updateErr } = await supabase
                .from('listings')
                .update({
                    title,
                    description,
                    location,
                    price_per_night: Number(price),
                    max_guests: guests,
                    images: finalPaths,
                    property_type: propertyType,
                    privacy_type: privacyType,
                    bedrooms,
                    beds,
                    bathrooms,
                    amenities,
                    new_listing_promo: newListingPromo,
                    last_minute_discount: lastMinuteDiscount,
                    weekly_discount: weeklyDiscount,
                    monthly_discount: monthlyDiscount,
                    ical_import_url: icalImportUrl || null,
                    min_nights: Math.max(1, Number(minNights) || 1),
                    max_nights: maxNights ? Number(maxNights) : null,
                    events_allowed: eventsAllowed,
                    smoking_allowed: smokingAllowed,
                    quiet_hours_enabled: quietHoursEnabled,
                    check_in_method: checkInMethod || null,
                    quiet_hours_start: quietHoursStart,
                    quiet_hours_end: quietHoursEnd,
                    commercial_photography_allowed: commercialPhotographyAllowed,
                    checkin_start: checkinStart,
                    checkin_end: checkinEnd,
                    checkout_time: checkoutTime,
                    additional_rules: additionalRules,
                    cancellation_policy: cancellationPolicy,
                    non_refundable_option: nonRefundableOption,
                })
                .eq('id', listingId)
                .eq('host_id', session.user.id);

            if (updateErr) {
                toast.error(updateErr.message, { theme: 'colored' });
                setFormError(`Could not save changes: ${updateErr.message}`);
                return;
            }

            toast.success('Listing updated.', { theme: 'colored' });
            router.push('/dashboard');
        } catch (err: any) {
            const msg = err?.message || 'Something went wrong saving your changes.';
            toast.error(msg, { theme: 'colored' });
            setFormError(msg);
        } finally {
            setSubmitting(false);
        }
    };

    const Counter = ({ label, value, onChange, min = 0 }: { label: string; value: number; onChange: (v: number) => void; min?: number }) => (
        <div className="flex items-center justify-between py-4 border-b">
            <span className="font-medium text-slate-800">{label}</span>
            <div className="flex items-center space-x-4">
                <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}
                    className="w-8 h-8 rounded-full border flex items-center justify-center text-slate-600 hover:border-slate-900 disabled:opacity-30">
                    <Minus className="w-4 h-4" />
                </button>
                <span className="w-6 text-center">{value}</span>
                <button type="button" onClick={() => onChange(value + 1)}
                    className="w-8 h-8 rounded-full border flex items-center justify-center text-slate-600 hover:border-slate-900">
                    <Plus className="w-4 h-4" />
                </button>
            </div>
        </div>
    );

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-4">
                <Logo />
                <p className="text-slate-500 animate-pulse">Loading your listing...</p>
            </div>
        );
    }

    if (!session) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-6 text-center px-4">
                <Logo />
                <h1 className="text-2xl font-bold text-slate-900">Sign in to edit this listing</h1>
                <LoginModel />
            </div>
        );
    }

    if (notFound) {
        return <div className="text-center py-20 text-slate-500">This listing couldn't be found.</div>;
    }

    if (notOwner) {
        return <div className="text-center py-20 text-slate-500">You don't have permission to edit this listing.</div>;
    }

    return (
        <div className="max-w-5xl mx-auto px-6 py-10 w-full">
            <div className="flex justify-between items-center mb-8">
                <h1 className="text-2xl font-extrabold text-rose-500">Edit listing</h1>
                <button type="button" onClick={() => router.push('/dashboard')} className="text-sm font-semibold underline text-slate-600 hover:text-black">
                    Back to dashboard
                </button>
            </div>

            <form onSubmit={handleSubmit}>
                <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-10">
                    {/* Sidebar */}
                    <div className="space-y-1">
                        {SECTIONS.map(({ key, label, icon: Icon }) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => setActiveSection(key)}
                                className={`w-full flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition ${activeSection === key ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}
                            >
                                <Icon className="w-4 h-4 mr-3" /> {label}
                            </button>
                        ))}
                    </div>

                    {/* Content */}
                    <div>
                        {activeSection === 'basics' && (
                            <div className="space-y-10">
                                <section>
                                    <h2 className="text-xl font-bold text-slate-900 mb-4">Property type</h2>
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                        {categories.map((item) => {
                                            const Icon = ICON_MAP[item.icon] || HomeIcon;
                                            const selected = propertyType === item.name;
                                            return (
                                                <button key={item.name} type="button" onClick={() => setPropertyType(item.name)}
                                                    className={`p-4 rounded-2xl border-2 text-left transition ${selected ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}>
                                                    <Icon className="w-5 h-5 mb-2 text-slate-700" />
                                                    <div className="font-semibold text-sm text-slate-900">{item.name}</div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </section>

                                <section>
                                    <h2 className="text-xl font-bold text-slate-900 mb-4">What guests get</h2>
                                    <div className="space-y-3">
                                        {['Entire place', 'A private room', 'A shared room'].map((option) => (
                                            <button key={option} type="button" onClick={() => setPrivacyType(option)}
                                                className={`w-full p-4 rounded-2xl border-2 text-left transition flex items-center justify-between ${privacyType === option ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}>
                                                <span className="font-semibold text-slate-900 text-sm">{option}</span>
                                                {privacyType === option && <Check className="w-5 h-5 text-slate-900" />}
                                            </button>
                                        ))}
                                    </div>
                                </section>

                                <section>
                                    <h2 className="text-xl font-bold text-slate-900 mb-1">How guests get in</h2>
                                    <p className="text-sm text-slate-500 mb-4">
                                        Shown on your listing. Send the actual codes privately once a booking is confirmed.
                                    </p>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        {CHECKIN_METHODS.map(({ label, icon: Icon, note }) => {
                                            const selected = checkInMethod === label;
                                            return (
                                                <button key={label} type="button"
                                                    onClick={() => setCheckInMethod(selected ? '' : label)}
                                                    className={`text-left border-2 rounded-2xl p-4 transition ${selected ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}>
                                                    <Icon className="w-5 h-5 text-slate-700 mb-2" />
                                                    <div className="font-semibold text-slate-900 text-sm">{label}</div>
                                                    <div className="text-xs text-slate-500 mt-0.5">{note}</div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </section>

                                <section>
                                    <h2 className="text-xl font-bold text-slate-900 mb-2">Capacity</h2>
                                    <Counter label="Guests" value={guests} onChange={setGuests} min={1} />
                                    <Counter label="Bedrooms" value={bedrooms} onChange={setBedrooms} min={0} />
                                    <Counter label="Beds" value={beds} onChange={setBeds} min={1} />
                                    <Counter label="Bathrooms" value={bathrooms} onChange={setBathrooms} min={0.5} />
                                </section>
                            </div>
                        )}

                        {activeSection === 'location' && (
                            <section>
                                <h2 className="text-xl font-bold text-slate-900 mb-4">Location</h2>
                                <textarea value={location} onChange={(e) => setLocation(e.target.value)} rows={3}
                                    className="w-full p-3 border rounded-xl text-sm" />
                            </section>
                        )}

                        {activeSection === 'description' && (
                            <section>
                                <h2 className="text-xl font-bold text-slate-900 mb-2">Title</h2>
                                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full p-3 border rounded-xl mb-6" />
                                <h2 className="text-xl font-bold text-slate-900 mb-2">Description</h2>
                                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={8} className="w-full p-3 border rounded-xl" />
                            </section>
                        )}

                        {activeSection === 'amenities' && (
                            <section>
                                <h2 className="text-xl font-bold text-slate-900 mb-1">Amenities</h2>
                                <p className="text-sm text-slate-400 mb-4">{amenities.length} selected</p>
                                <div className="space-y-6">
                                    {AMENITY_CATEGORIES.map(({ category, items }) => (
                                        <div key={category}>
                                            <h3 className="font-semibold text-slate-800 text-sm mb-2">{category}</h3>
                                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                                {items.map(({ name, icon: Icon, note }) => {
                                                    const selected = amenities.includes(name);
                                                    return (
                                                        <button key={name} type="button" onClick={() => toggleAmenity(name)}
                                                            className={`p-3 rounded-2xl border-2 text-left transition relative ${selected ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}>
                                                            <Icon className="w-4 h-4 mb-2 text-slate-700" />
                                                            <div className="text-xs font-semibold text-slate-900">{name}</div>
                                                            {note && <div className="text-[10px] text-slate-400 mt-0.5">{note}</div>}
                                                            {selected && <Check className="w-4 h-4 text-slate-900 absolute top-3 right-3" />}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}

                        {activeSection === 'photos' && (
                            <section>
                                <h2 className="text-xl font-bold text-slate-900 mb-1">Photos</h2>
                                <p className="text-xs text-slate-400 mb-4">Drag to reorder. Click the star to set the cover photo.</p>
                                {photos.length > 0 && (
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                                        {photos.map((photo, i) => (
                                            <div key={i}
                                                draggable
                                                onDragStart={() => setDraggedIndex(i)}
                                                onDragEnter={() => { if (draggedIndex !== null && draggedIndex !== i) setDragOverIndex(i); }}
                                                onDragOver={(e) => e.preventDefault()}
                                                onDrop={() => { if (draggedIndex !== null) reorderPhotos(draggedIndex, i); setDraggedIndex(null); setDragOverIndex(null); }}
                                                onDragEnd={() => { setDraggedIndex(null); setDragOverIndex(null); }}
                                                className={`relative h-40 rounded-2xl overflow-hidden border-2 group cursor-grab active:cursor-grabbing transition ${
                                                    i === coverIndex ? 'border-rose-500' : 'border-slate-200'
                                                } ${dragOverIndex === i ? 'ring-2 ring-slate-900 scale-95' : ''} ${draggedIndex === i ? 'opacity-40' : ''}`}
                                            >
                                                <img
                                                    src={photo.kind === 'existing' ? getImageUrl(photo.path) : URL.createObjectURL(photo.file)}
                                                    alt={`Photo ${i + 1}`}
                                                    className="w-full h-full object-cover pointer-events-none"
                                                />
                                                <button type="button" onClick={() => setCoverIndex(i)}
                                                    title={i === coverIndex ? 'Cover photo' : 'Make cover photo'}
                                                    className={`absolute top-2 right-11 w-8 h-8 rounded-full flex items-center justify-center text-sm shadow ${i === coverIndex ? 'bg-rose-500 text-white' : 'bg-white/90 text-slate-600 opacity-0 group-hover:opacity-100 transition'}`}>
                                                    ★
                                                </button>
                                                <button type="button" onClick={() => removePhoto(i)} title="Remove photo"
                                                    className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90 text-slate-600 flex items-center justify-center text-sm shadow opacity-0 group-hover:opacity-100 transition">
                                                    ×
                                                </button>
                                                {i === coverIndex && (
                                                    <span className="absolute top-2 left-2 text-xs font-semibold bg-rose-500 text-white px-2 py-0.5 rounded-full">Cover</span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <label className="h-24 rounded-2xl border-2 border-dashed border-slate-300 hover:border-slate-400 flex flex-col items-center justify-center cursor-pointer text-slate-500 text-sm">
                                    <span className="font-semibold">+ Add photos</span>
                                    <input type="file" accept="image/png, image/jpeg" multiple onChange={handlePhotosChange} className="hidden" />
                                </label>
                            </section>
                        )}

                        {activeSection === 'rates' && (
                            <section>
                                <h2 className="text-xl font-bold text-slate-900 mb-4">Rates</h2>
                                <div className="flex items-center border-2 rounded-2xl px-5 py-4 mb-3 max-w-xs">
                                    <span className="text-2xl font-black text-slate-900 mr-2">£</span>
                                    <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="text-2xl font-black text-slate-900 outline-none w-full" />
                                    <span className="text-slate-500 ml-2">/ night</span>
                                </div>
                                {Number(price) > 0 && (
                                    <div className="bg-slate-50 rounded-2xl border p-4 max-w-xs text-sm">
                                        <div className="flex justify-between text-slate-600 mb-1">
                                            <span>Guest pays</span><span className="font-medium text-slate-900">£{Number(price).toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between text-slate-600 mb-1">
                                            <span>Host fee ({HOST_FEE_PERCENT}%)</span>
                                            <span className="font-medium text-slate-900">− £{(Number(price) * HOST_FEE_PERCENT / 100).toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between pt-1 border-t border-slate-200">
                                            <span className="font-semibold text-slate-900">You receive</span>
                                            <span className="font-bold text-rose-500">£{(Number(price) * (1 - HOST_FEE_PERCENT / 100)).toFixed(2)}</span>
                                        </div>
                                    </div>
                                )}
                            </section>
                        )}

                        {activeSection === 'availability' && (
                            <section>
                                <h2 className="text-xl font-bold text-slate-900 mb-1">Availability</h2>
                                <p className="text-sm text-slate-500 mb-6">Control how short or long a stay can be.</p>
                                <div className="grid grid-cols-2 gap-4 max-w-md">
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-800 mb-1">Minimum nights</label>
                                        <input
                                            type="number"
                                            min={1}
                                            value={minNights}
                                            onChange={(e) => setMinNights(e.target.value)}
                                            onBlur={() => {
                                                const n = Number(minNights);
                                                if (!minNights || isNaN(n) || n < 1) setMinNights('1');
                                            }}
                                            className="w-full p-3 border rounded-xl text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-800 mb-1">Maximum nights</label>
                                        <input
                                            type="number"
                                            min={Number(minNights) || 1}
                                            value={maxNights}
                                            onChange={(e) => setMaxNights(e.target.value)}
                                            placeholder="No limit"
                                            className="w-full p-3 border rounded-xl text-sm"
                                        />
                                    </div>
                                </div>
                                <p className="text-xs text-slate-400 mt-2">Leave maximum nights blank for no limit.</p>
                            </section>
                        )}

                        {activeSection === 'rules' && (
                            <section>
                                <h2 className="text-xl font-bold text-slate-900 mb-1">House rules</h2>
                                <p className="text-sm text-slate-500 mb-6">
                                    Guests are expected to follow your rules and may be removed if they don't.
                                </p>

                                <div className="border rounded-2xl divide-y">
                                    {[
                                        { label: 'Events allowed', value: eventsAllowed, set: setEventsAllowed },
                                        { label: 'Smoking, vaping, e-cigarettes allowed', value: smokingAllowed, set: setSmokingAllowed },
                                        { label: 'Commercial photography and filming allowed', value: commercialPhotographyAllowed, set: setCommercialPhotographyAllowed },
                                    ].map((rule) => (
                                        <div key={rule.label} className="p-4 flex items-center justify-between">
                                            <span className="text-sm font-medium text-slate-800">{rule.label}</span>
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => rule.set(false)}
                                                    className={`w-8 h-8 rounded-full flex items-center justify-center ${!rule.value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-400'}`}
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => rule.set(true)}
                                                    className={`w-8 h-8 rounded-full flex items-center justify-center ${rule.value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-400'}`}
                                                >
                                                    <Check className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}

                                    <div className="p-4">
                                        <div className="flex items-center justify-between mb-3">
                                            <span className="text-sm font-medium text-slate-800">Quiet hours</span>
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setQuietHoursEnabled(false)}
                                                    className={`w-8 h-8 rounded-full flex items-center justify-center ${!quietHoursEnabled ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-400'}`}
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setQuietHoursEnabled(true)}
                                                    className={`w-8 h-8 rounded-full flex items-center justify-center ${quietHoursEnabled ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-400'}`}
                                                >
                                                    <Check className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                        {quietHoursEnabled && (
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <label className="text-xs text-slate-500">Start time</label>
                                                    <input type="time" value={quietHoursStart} onChange={(e) => setQuietHoursStart(e.target.value)}
                                                        className="w-full p-2.5 border rounded-lg text-sm mt-1" />
                                                </div>
                                                <div>
                                                    <label className="text-xs text-slate-500">End time</label>
                                                    <input type="time" value={quietHoursEnd} onChange={(e) => setQuietHoursEnd(e.target.value)}
                                                        className="w-full p-2.5 border rounded-lg text-sm mt-1" />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <h3 className="font-semibold text-slate-800 mt-8 mb-3">Check-in and checkout times</h3>
                                <div className="grid grid-cols-3 gap-3 max-w-lg">
                                    <div>
                                        <label className="text-xs text-slate-500">Check-in from</label>
                                        <input type="time" value={checkinStart} onChange={(e) => setCheckinStart(e.target.value)}
                                            className="w-full p-2.5 border rounded-lg text-sm mt-1" />
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-500">Check-in until</label>
                                        <input type="text" value={checkinEnd} onChange={(e) => setCheckinEnd(e.target.value)}
                                            placeholder="e.g. 20:00 or Flexible" className="w-full p-2.5 border rounded-lg text-sm mt-1" />
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-500">Checkout by</label>
                                        <input type="time" value={checkoutTime} onChange={(e) => setCheckoutTime(e.target.value)}
                                            className="w-full p-2.5 border rounded-lg text-sm mt-1" />
                                    </div>
                                </div>

                                <h3 className="font-semibold text-slate-800 mt-8 mb-2">Additional rules</h3>
                                <textarea
                                    value={additionalRules}
                                    onChange={(e) => setAdditionalRules(e.target.value)}
                                    rows={4}
                                    placeholder="Share anything else you expect from guests..."
                                    className="w-full p-3 border rounded-xl text-sm"
                                />
                            </section>
                        )}

                        {activeSection === 'cancellation' && (
                            <section>
                                <h2 className="text-xl font-bold text-slate-900 mb-1">Cancellation policy</h2>
                                <p className="text-sm text-slate-500 mb-6">Choose how flexible you want to be with cancellations.</p>
                                <div className="space-y-3 max-w-lg">
                                    {CANCELLATION_POLICIES.map((policy) => (
                                        <button
                                            key={policy.key}
                                            type="button"
                                            onClick={() => setCancellationPolicy(policy.key)}
                                            className={`w-full text-left p-4 rounded-2xl border-2 transition ${cancellationPolicy === policy.key ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}
                                        >
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="font-semibold text-slate-900">{policy.key}</span>
                                                {cancellationPolicy === policy.key && <Check className="w-4 h-4 text-slate-900" />}
                                            </div>
                                            <ul className="text-xs text-slate-500 list-disc pl-4 space-y-0.5">
                                                {policy.bullets.map((b) => <li key={b}>{b}</li>)}
                                            </ul>
                                        </button>
                                    ))}
                                </div>

                                <div className="mt-6 p-4 border rounded-2xl flex items-start justify-between max-w-lg gap-4">
                                    <div>
                                        <div className="font-semibold text-slate-900 text-sm mb-1">Non-refundable option</div>
                                        <p className="text-xs text-slate-500">
                                            For short-term stays, guests pay 10% less in exchange for you keeping your full payout if they cancel.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setNonRefundableOption(!nonRefundableOption)}
                                        className={`flex-shrink-0 w-11 h-6 rounded-full relative transition ${nonRefundableOption ? 'bg-slate-900' : 'bg-slate-300'}`}
                                    >
                                        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${nonRefundableOption ? 'left-5' : 'left-0.5'}`} />
                                    </button>
                                </div>
                            </section>
                        )}

                        {activeSection === 'calendar' && (
                            <section>
                                <h2 className="text-xl font-bold text-slate-900 mb-1">Calendar sync</h2>
                                <p className="text-sm text-slate-500 mb-4">
                                    Keep this listing's availability in step with your calendar on other sites.
                                </p>

                                <label className="block text-sm font-semibold text-slate-800 mb-1">
                                    Import a calendar (from Airbnb, Booking.com, etc.)
                                </label>
                                <input
                                    type="text"
                                    value={icalImportUrl}
                                    onChange={(e) => setIcalImportUrl(e.target.value)}
                                    placeholder="https://www.airbnb.com/calendar/ical/....ics"
                                    className="w-full p-3 border rounded-xl text-sm mb-1"
                                />
                                <p className="text-xs text-slate-400 mb-6">
                                    Paste the export link from that platform's calendar settings. We check it each time a guest views this listing, so bookings made elsewhere stay blocked here too. Note: how current this is depends on how often that platform updates its own export — this isn't instant on their end either.
                                </p>

                                <label className="block text-sm font-semibold text-slate-800 mb-1">
                                    Your export link for other platforms
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        readOnly
                                        value={typeof window !== 'undefined' ? `${window.location.origin}/api/ical/${listingId}` : ''}
                                        className="w-full p-3 border rounded-xl text-sm bg-slate-50 text-slate-500"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            navigator.clipboard.writeText(`${window.location.origin}/api/ical/${listingId}`);
                                            toast.success('Copied.', { theme: 'colored' });
                                        }}
                                        className="px-4 py-2 border rounded-xl text-sm font-semibold text-slate-700 hover:border-slate-500 flex-shrink-0"
                                    >
                                        Copy
                                    </button>
                                </div>
                                <p className="text-xs text-slate-400 mt-1">
                                    Paste this into Airbnb or Booking.com's "import calendar" setting so bookings made here block those dates there too.
                                </p>
                            </section>
                        )}

                        {activeSection === 'discounts' && (
                            <section>
                                <h2 className="text-xl font-bold text-slate-900 mb-4">Discounts</h2>
                                <div className="space-y-3">
                                    {[
                                        { percent: '20%', title: 'New listing promotion', note: 'Available until your listing has 3 reviews or gets booked 10 times', value: newListingPromo, set: setNewListingPromo },
                                        { percent: '5%', title: 'Last-minute discount', note: 'For stays booked 14 days or less before arrival', value: lastMinuteDiscount, set: setLastMinuteDiscount },
                                        { percent: '10%', title: 'Weekly discount', note: 'For stays of 7 nights or more', value: weeklyDiscount, set: setWeeklyDiscount },
                                        { percent: '20%', title: 'Monthly discount', note: 'For stays of 28 nights or more', value: monthlyDiscount, set: setMonthlyDiscount },
                                    ].map((d) => (
                                        <button key={d.title} type="button" onClick={() => d.set(!d.value)}
                                            className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 text-left transition ${d.value ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}>
                                            <div className="flex items-center">
                                                <span className="text-sm font-bold text-slate-900 w-12">{d.percent}</span>
                                                <div>
                                                    <div className="font-semibold text-sm text-slate-900">{d.title}</div>
                                                    <div className="text-xs text-slate-500">{d.note}</div>
                                                </div>
                                            </div>
                                            <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ml-4 ${d.value ? 'bg-slate-900' : 'border-2 border-slate-300'}`}>
                                                {d.value && <Check className="w-4 h-4 text-white" />}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </section>
                        )}

                        {formError && <p className="text-red-600 text-sm mt-8">{formError}</p>}

                        <button type="submit" disabled={submitting}
                            className="w-full mt-8 py-4 bg-rose-500 text-white font-bold rounded-xl hover:bg-rose-600 transition disabled:opacity-60">
                            {submitting ? 'Saving...' : 'Save changes'}
                        </button>
                    </div>
                </div>
            </form>
        </div>
    );
}
