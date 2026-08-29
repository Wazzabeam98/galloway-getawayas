'use client';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter, useParams } from 'next/navigation';
import Logo from '@/components/base/Logo';
import LockboxCode from '@/components/LockboxCode';
import LoginModel from '@/components/auth/LoginModel';
import { categories } from '@/config/categories';
import Env from '@/config/Env';
import { generateRandomNumber, getImageUrl, timeInputValue } from '@/lib/utils';
import { toast } from 'react-toastify';
import { rateFor } from '@/lib/fees';
import { buildLocation, splitLocation, DEFAULT_REGION } from '@/lib/places';
import { buildStreetAddress, tidyPostcode } from '@/lib/address';
import { fromRow, newProblems, publishProblems } from '@/lib/listingRules';
import GuestBookableHere from '@/components/GuestBookableHere';
import { PLOT_BANDS, STOREY_BANDS } from '@/lib/serviceProviders';
import { compressImage } from '@/lib/compressImage';
import IcalFeeds from '@/components/IcalFeeds';
import {
    HomeIcon, Trees, Waves, Compass, Building2, Sparkles, Minus, Plus, Check,
    KeyRound, Lock, DoorOpen, Hash, Users,
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



// One choice from three, for the facts the services side needs. Shared by both
// so a third one later is a call rather than another copy of this markup.
//
// Radio-style buttons rather than a <select>: the options are sentences, and a
// dropdown hides two of the three at the moment somebody is choosing between
// them. "Not said" is a real state and stays reachable — a host who has not
// decided should be able to leave it, and clear it again.
function BandChoice({
    label,
    options,
    value,
    onChange,
}: {
    label: string;
    options: readonly { key: string; label: string }[];
    value: string;
    onChange: (v: string) => void;
}) {
    return (
        <div>
            <div className="text-sm font-semibold text-slate-900 mb-2">{label}</div>
            <div className="space-y-2">
                {options.map((o) => {
                    const on = value === o.key;
                    return (
                        <button
                            key={o.key}
                            type="button"
                            onClick={() => onChange(on ? '' : o.key)}
                            aria-pressed={on}
                            className={`w-full text-left rounded-xl border px-4 py-3 text-sm transition ${
                                on
                                    ? 'border-emerald-700 ring-2 ring-emerald-700 bg-emerald-50 text-slate-900'
                                    : 'border-slate-300 text-slate-700 hover:border-slate-400'
                            }`}
                        >
                            {o.label}
                        </button>
                    );
                })}
            </div>
            {!value && (
                <p className="text-xs text-slate-500 mt-2">
                    Not said yet. They cannot price a visit here until you pick one.
                </p>
            )}
        </div>
    );
}

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
    { key: 'Flexible', bullets: ['Full refund up to 1 day before check-in', '50% refund inside 1 day of check-in'] },
    { key: 'Moderate', bullets: ['Full refund up to 5 days before check-in', '50% refund inside 5 days of check-in'] },
    { key: 'Limited', bullets: ['Full refund up to 14 days before check-in', '50% refund 7–14 days before', 'No refund inside 7 days'] },
    { key: 'Firm', bullets: ['Full refund up to 30 days before check-in', '50% refund 7–30 days before', 'No refund inside 7 days'] },
];

type Photo = { kind: 'existing'; path: string } | { kind: 'new'; file: File };

export default function EditListing() {
    const [commissionRate, setCommissionRate] = useState<number | null>(null);
    const HOST_FEE_PERCENT = rateFor({ commission_rate: commissionRate });
    const params = useParams();
    const listingId = params?.id as string;
    const router = useRouter();
    const supabase = createClientComponentClient();

    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<any>(null);
    const [notFound, setNotFound] = useState(false);
    const [original, setOriginal] = useState<any>(null);
    const [notOwner, setNotOwner] = useState(false);
    const [activeSection, setActiveSection] = useState('basics');

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    // Was a single free-text box holding the whole address. A street typed in
    // there went straight into `location`, which is the public field — the same
    // way the malformed one got there in the first place. Four boxes now, and
    // `location` is assembled from two of them.
    const [locTown, setLocTown] = useState('');
    const [locRegion, setLocRegion] = useState(DEFAULT_REGION);
    const [streetAddress, setStreetAddress] = useState('');
    const [locPostcode, setLocPostcode] = useState('');
    const [price, setPrice] = useState('');
    const [propertyType, setPropertyType] = useState('');
    const [privacyType, setPrivacyType] = useState('Entire place');
    const [guests, setGuests] = useState(1);
    const [bedrooms, setBedrooms] = useState(1);
    const [beds, setBeds] = useState(1);
    const [bathrooms, setBathrooms] = useState(1);
    const [plotBand, setPlotBand] = useState<string>('');
    const [storeyBand, setStoreyBand] = useState<string>('');
    const [amenities, setAmenities] = useState<string[]>([]);
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [coverIndex, setCoverIndex] = useState(0);
    const [checkInMethod, setCheckInMethod] = useState('');
    const [nearby, setNearby] = useState<{ name: string; time: string }[]>([]);

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
    const [icalToken, setIcalToken] = useState('');
    const [isCoHost, setIsCoHost] = useState(false);
    // Set when an owner opens somebody else's listing. Everything it turns on
    // — the banner, the required reason — exists so this can never be mistaken
    // for editing your own.
    const [moderating, setModerating] = useState(false);
    const [moderationReason, setModerationReason] = useState('');
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
    const [processingPhotos, setProcessingPhotos] = useState(false);
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

            // The owner, or a co-host they've allowed to edit the listing.
            if (listing.host_id !== session.user.id) {
                const res = await fetch('/api/my-listings?permission=can_listing');
                const allowed = res.ok ? (await res.json()).listings || [] : [];

                if (allowed.some((a: any) => a.id === listingId)) {
                    setIsCoHost(true);
                } else {
                    // Not theirs and not shared with them — but a Galloway
                    // Getaways owner may still moderate it. The server checks
                    // this again on save; this only decides what is drawn.
                    const { data: me } = await supabase
                        .from('profiles')
                        .select('is_admin')
                        .eq('id', session.user.id)
                        .maybeSingle();

                    if (!me || me.is_admin !== true) {
                        setNotOwner(true);
                        setLoading(false);
                        return;
                    }

                    setModerating(true);
                }
            }

            // The listing exactly as it was before this screen touched it.
            // A rule it already broke is not this edit's doing — see
            // newProblems in lib/listingRules.ts.
            setOriginal(listing);

            setTitle(listing.title || '');
            setDescription(listing.description || '');
            const place = splitLocation(listing.location);
            setLocTown(place.town);
            setLocRegion(place.region || DEFAULT_REGION);
            setStreetAddress(listing.street_address || '');
            setLocPostcode(listing.postcode || '');
            setPrice(String(listing.price_per_night ?? ''));
            setCommissionRate(listing.commission_rate ?? null);
            setPropertyType(listing.property_type || '');
            setPrivacyType(listing.privacy_type || 'Entire place');
            setGuests(listing.max_guests || 1);
            setBedrooms(listing.bedrooms ?? 1);
            setBeds(listing.beds ?? 1);
            setBathrooms(listing.bathrooms ?? 1);
            setPlotBand(listing.plot_band || '');
            setStoreyBand(listing.storey_band || '');
            setAmenities(listing.amenities || []);
            setPhotos((listing.images || []).map((path: string) => ({ kind: 'existing', path })));
            setNewListingPromo(listing.new_listing_promo ?? true);
            setLastMinuteDiscount(listing.last_minute_discount ?? false);
            setWeeklyDiscount(listing.weekly_discount ?? false);
            setMonthlyDiscount(listing.monthly_discount ?? false);
            setIcalToken(listing.ical_token || '');
            setMinNights(String(listing.min_nights ?? 1));
            setMaxNights(listing.max_nights ? String(listing.max_nights) : '');
            setEventsAllowed(listing.events_allowed ?? false);
            setSmokingAllowed(listing.smoking_allowed ?? false);
            setQuietHoursEnabled(listing.quiet_hours_enabled ?? false);
            setCheckInMethod(listing.check_in_method || '');
            setNearby(Array.isArray(listing.nearby) ? listing.nearby : []);
            setQuietHoursStart(listing.quiet_hours_start || '22:00');
            setQuietHoursEnd(listing.quiet_hours_end || '07:00');
            setCommercialPhotographyAllowed(listing.commercial_photography_allowed ?? false);
            // The typed columns now, not the old text trio. timeInputValue
            // trims the seconds a `time` column comes back with.
            setCheckinStart(timeInputValue(listing.check_in_time) || '15:00');
            setCheckinEnd(timeInputValue(listing.check_in_end_time));
            setCheckoutTime(timeInputValue(listing.check_out_time) || '11:00');
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

    // Shrunk here rather than at upload, the way addhome does it, so the
    // preview a host sees is the photo that actually gets stored.
    //
    // This screen used to upload the raw file. A photo straight off a phone is
    // 4-12MB and 4000px wide, and this is the path a host uses every time they
    // add a photo to a listing that already exists — so it is the normal path,
    // not the rare one. Two 4032px files reached production storage that way.
    const handlePhotosChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;

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

        setProcessingPhotos(false);

        if (ready.length) setPhotos((prev) => [...prev, ...ready.map((file) => ({ kind: 'new' as const, file }))]);
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

    // What this listing already fails, as it stands on screen. Only ever shown,
    // never enforced — enforcement is newProblems, which asks what this edit
    // would newly break.
    const belowStandard = original
        ? publishProblems({
            propertyType: propertyType,
            street: streetAddress,
            city: locTown,
            region: locRegion,
            postcode: locPostcode,
            photoCount: photos.length,
            title: title,
            description: description,
            price: price,
            amenities: amenities,
            checkInMethod: checkInMethod,
        })
        : [];

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError('');

        // The same rules the wizard publishes by, from lib/listingRules.ts,
        // rather than the shorter list this screen used to keep of its own.
        // That list is why a listing could go live with no title: the wizard
        // learned to ask and this screen never did.
        //
        // Only rules this edit would newly break, though. A listing already on
        // the site from before a rule existed still saves — otherwise a host
        // could not correct a price until they had also satisfied something
        // that was not asked of them when they published.
        const introduced = newProblems(fromRow(original), {
            propertyType: propertyType,
            street: streetAddress,
            city: locTown,
            region: locRegion,
            postcode: locPostcode,
            photoCount: photos.length,
            title: title,
            description: description,
            price: price,
            amenities: amenities,
            checkInMethod: checkInMethod,
        });

        if (introduced.length > 0) {
            setFormError(introduced[0].message);
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

            // Saved through the server so a co-host the owner trusted can
            // edit too — row-level security would block them otherwise.
            const patch = {
                    title: title.trim(),
                    description,
                    location: buildLocation(locTown, locRegion),
                    street_address: buildStreetAddress(null, null, streetAddress) || null,
                    postcode: locPostcode.trim() ? tidyPostcode(locPostcode) : null,
                    price_per_night: Number(price),
                    max_guests: guests,
                    images: finalPaths,
                    property_type: propertyType,
                    privacy_type: privacyType,
                    bedrooms,
                    beds,
                    bathrooms,
                    plot_band: plotBand || null,
                    storey_band: storeyBand || null,
                    amenities,
                    new_listing_promo: newListingPromo,
                    last_minute_discount: lastMinuteDiscount,
                    weekly_discount: weeklyDiscount,
                    monthly_discount: monthlyDiscount,
                    min_nights: Math.max(1, Number(minNights) || 1),
                    max_nights: maxNights ? Number(maxNights) : null,
                    events_allowed: eventsAllowed,
                    smoking_allowed: smokingAllowed,
                    quiet_hours_enabled: quietHoursEnabled,
                    check_in_method: checkInMethod || null,
                    nearby: nearby.filter((n) => n.name.trim()),
                    quiet_hours_start: quietHoursStart,
                    quiet_hours_end: quietHoursEnd,
                    commercial_photography_allowed: commercialPhotographyAllowed,
                    // These also decide when scheduled messages go out —
                    // send_due_scheduled_messages() counts "before check-out"
                    // back from check_out_time — so they are not display-only.
                    check_in_time: checkinStart || '15:00',
                    check_in_end_time: checkinEnd || null,
                    check_out_time: checkoutTime || '11:00',
                    additional_rules: additionalRules,
                    cancellation_policy: cancellationPolicy,
                    non_refundable_option: nonRefundableOption,
            };

            const saveRes = await fetch('/api/listings/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    listingId: listingId,
                    patch: patch,
                    reason: moderating ? moderationReason : undefined,
                }),
            });
            const saveData = await saveRes.json();
            const updateErr = saveData && saveData.ok ? null : { message: (saveData && saveData.error) || 'Could not save' };

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
                <h1 className="text-2xl font-extrabold text-emerald-800">Edit listing</h1>
                <button type="button" onClick={() => router.push(moderating ? '/admin/listings' : '/dashboard')} className="text-sm font-semibold underline text-slate-600 hover:text-black">
                    {moderating ? 'Back to all listings' : 'Back to dashboard'}
                </button>
            </div>

            {/* Impossible to mistake for your own listing, which is the whole
                point — this form looks identical either way. */}
            {moderating && (
                <div className="mb-8 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5">
                    <div className="font-bold text-amber-900">This listing is not yours</div>
                    <p className="text-sm text-amber-900 mt-1">
                        You are editing it as a Galloway Getaways owner. Whatever you change is
                        recorded against your name, along with the reason you give below. The host
                        is not told automatically.
                    </p>
                    <p className="text-sm text-amber-900 mt-2">
                        Removing a photo takes it off the public site and moves the file somewhere
                        private, so it can still be produced if the host asks what was taken down.
                    </p>

                    <label className="block text-xs font-semibold text-amber-900 mt-4">
                        Why are you making this change?
                    </label>
                    <textarea
                        value={moderationReason}
                        onChange={(e) => setModerationReason(e.target.value)}
                        rows={2}
                        placeholder="e.g. Photo four shows the neighbouring property's front door"
                        className="w-full p-2.5 border border-amber-300 rounded-lg text-sm mt-1 bg-white"
                    />
                    {moderationReason.trim().length < 3 && (
                        <p className="text-xs text-amber-800 mt-1">
                            Saving is blocked until you write one.
                        </p>
                    )}
                </div>
            )}

            {/* Read-only: what a guest staying here can book. Owner only — a
                moderator editing someone else's listing is not the host the
                endpoint answers to. Same gate as the guest's trip page. */}
            {!moderating && listingId && (
                <div className="mb-8">
                    <GuestBookableHere listingId={listingId} />
                </div>
            )}

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

                                    {/* Asked here because this is where the
                                        question arises: a host who has just
                                        said "there's a lockbox" is thinking
                                        about the code. It sat next to the house
                                        rules before, surrounded by guest-facing
                                        copy, which is the wrong company for a
                                        credential.

                                        Saved on its own, through its own route:
                                        the code is not on the listing row, so
                                        it is not part of this form's Save. */}
                                    {listingId && (
                                        <LockboxCode listingId={listingId} method={checkInMethod} />
                                    )}
                                </section>

                                <section>
                                    <h2 className="text-xl font-bold text-slate-900 mb-2">Capacity</h2>
                                    <Counter label="Guests" value={guests} onChange={setGuests} min={1} />
                                    <Counter label="Bedrooms" value={bedrooms} onChange={setBedrooms} min={0} />
                                    <Counter label="Beds" value={beds} onChange={setBeds} min={1} />
                                    <Counter label="Bathrooms" value={bathrooms} onChange={setBathrooms} min={0.5} />
                                </section>

                                {/* Asked once, and only because the services side
                                    cannot work them out. Bedrooms above already
                                    carry the cleaning and waste bands; nothing on
                                    a listing says how big the garden is or how
                                    high the windows go.

                                    Both optional: a blank one means that trade
                                    cannot quote for this property yet, which is a
                                    prompt when they first look, not a blocked
                                    save. */}
                                <section>
                                    <h2 className="text-xl font-bold text-slate-900 mb-1">For local services</h2>
                                    <p className="text-sm text-slate-500 mb-5">
                                        Two things a gardener or window cleaner needs before they can price a
                                        visit. Answer once and they both quote from it.
                                    </p>

                                    <BandChoice
                                        label="The garden or grounds"
                                        options={PLOT_BANDS}
                                        value={plotBand}
                                        onChange={setPlotBand}
                                    />

                                    <div className="mt-6">
                                        <BandChoice
                                            label="How high the windows go"
                                            options={STOREY_BANDS}
                                            value={storeyBand}
                                            onChange={setStoreyBand}
                                        />
                                    </div>
                                </section>
                            </div>
                        )}

                        {activeSection === 'location' && (
                            <div className="space-y-10">
                                <section>
                                    <h2 className="text-xl font-bold text-slate-900 mb-1">Location</h2>
                                    <p className="text-sm text-slate-500 mb-4">
                                        Guests only ever see the town and region. The street address and
                                        postcode are kept private.
                                    </p>
                                    <div className="space-y-4">
                                        <div>
                                            <label htmlFor="edit-town" className="text-xs text-slate-500 font-semibold uppercase">Town / city</label>
                                            <input id="edit-town" type="text" value={locTown} onChange={(e) => setLocTown(e.target.value)}
                                                placeholder="e.g. Kirkcudbright"
                                                className="w-full p-3 border rounded-xl text-sm mt-1" />
                                        </div>
                                        <div>
                                            <label htmlFor="edit-region" className="text-xs text-slate-500 font-semibold uppercase">Region</label>
                                            <input id="edit-region" type="text" value={locRegion} onChange={(e) => setLocRegion(e.target.value)}
                                                placeholder="e.g. Dumfries and Galloway"
                                                className="w-full p-3 border rounded-xl text-sm mt-1" />
                                        </div>
                                        <div>
                                            <label htmlFor="edit-street" className="text-xs text-slate-500 font-semibold uppercase">Street address (private)</label>
                                            <input id="edit-street" type="text" value={streetAddress} onChange={(e) => setStreetAddress(e.target.value)}
                                                placeholder="e.g. 18 Dovecroft"
                                                className="w-full p-3 border rounded-xl text-sm mt-1" />
                                        </div>
                                        <div>
                                            <label htmlFor="edit-postcode" className="text-xs text-slate-500 font-semibold uppercase">Postcode (private)</label>
                                            <input id="edit-postcode" type="text" value={locPostcode} onChange={(e) => setLocPostcode(e.target.value)}
                                                placeholder="e.g. DG6 4JS"
                                                className="w-full p-3 border rounded-xl text-sm mt-1" />
                                        </div>
                                        <p className="text-xs text-slate-500">
                                            Guests will see <span className="font-medium text-slate-700">{buildLocation(locTown, locRegion) || 'your town and region'}</span>.
                                        </p>
                                    </div>
                                </section>

                                <section>
                                    <h2 className="text-xl font-bold text-slate-900 mb-1">What&apos;s nearby</h2>
                                    <p className="text-sm text-slate-500 mb-4">
                                        The places you&apos;d tell a friend about — the harbour, the good bakery, the
                                        beach. Guests care about this far more than a map can show them.
                                    </p>

                                    <div className="space-y-3">
                                        {nearby.map((item, i) => (
                                            <div key={i} className="flex gap-2 items-start">
                                                <input
                                                    type="text"
                                                    value={item.name}
                                                    placeholder="Kirkcudbright harbour"
                                                    onChange={(e) => {
                                                        const next = nearby.slice();
                                                        next[i] = { name: e.target.value, time: next[i].time };
                                                        setNearby(next);
                                                    }}
                                                    className="flex-1 p-3 border rounded-xl text-sm"
                                                />
                                                <input
                                                    type="text"
                                                    value={item.time}
                                                    placeholder="3 min walk"
                                                    onChange={(e) => {
                                                        const next = nearby.slice();
                                                        next[i] = { name: next[i].name, time: e.target.value };
                                                        setNearby(next);
                                                    }}
                                                    className="w-40 p-3 border rounded-xl text-sm"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setNearby(nearby.filter((_, j) => j !== i))}
                                                    aria-label="Remove"
                                                    className="p-3 text-slate-400 hover:text-red-600"
                                                >
                                                    &times;
                                                </button>
                                            </div>
                                        ))}
                                    </div>

                                    {nearby.length < 8 && (
                                        <button
                                            type="button"
                                            onClick={() => setNearby(nearby.concat([{ name: '', time: '' }]))}
                                            className="mt-3 text-sm font-semibold text-emerald-700 hover:text-emerald-800"
                                        >
                                            + Add a place
                                        </button>
                                    )}
                                </section>
                            </div>
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
                                                    i === coverIndex ? 'border-emerald-700' : 'border-slate-200'
                                                } ${dragOverIndex === i ? 'ring-2 ring-slate-900 scale-95' : ''} ${draggedIndex === i ? 'opacity-40' : ''}`}
                                            >
                                                <img
                                                    src={photo.kind === 'existing' ? getImageUrl(photo.path) : URL.createObjectURL(photo.file)}
                                                    alt={`Photo ${i + 1}`}
                                                    className="w-full h-full object-cover pointer-events-none"
                                                />
                                                <button type="button" onClick={() => setCoverIndex(i)}
                                                    title={i === coverIndex ? 'Cover photo' : 'Make cover photo'}
                                                    className={`absolute top-2 right-11 w-8 h-8 rounded-full flex items-center justify-center text-sm shadow ${i === coverIndex ? 'bg-emerald-700 text-white' : 'bg-white/90 text-slate-600 opacity-0 group-hover:opacity-100 transition'}`}>
                                                    ★
                                                </button>
                                                <button type="button" onClick={() => removePhoto(i)} title="Remove photo"
                                                    className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90 text-slate-600 flex items-center justify-center text-sm shadow opacity-0 group-hover:opacity-100 transition">
                                                    ×
                                                </button>
                                                {i === coverIndex && (
                                                    <span className="absolute top-2 left-2 text-xs font-semibold bg-emerald-700 text-white px-2 py-0.5 rounded-full">Cover</span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <label className="h-24 rounded-2xl border-2 border-dashed border-slate-300 hover:border-slate-400 flex flex-col items-center justify-center cursor-pointer text-slate-500 text-sm">
                                    <span className="font-semibold">
                                        {processingPhotos ? 'Preparing your photos...' : '+ Add photos'}
                                    </span>
                                    <span className="text-xs mt-0.5">Straight from your phone is fine</span>
                                    <input type="file" accept="image/png, image/jpeg" multiple onChange={handlePhotosChange} className="hidden" disabled={processingPhotos} />
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
                                            <span className="font-bold text-emerald-700">£{(Number(price) * (1 - HOST_FEE_PERCENT / 100)).toFixed(2)}</span>
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
                                        <input type="time" value={checkinEnd} onChange={(e) => setCheckinEnd(e.target.value)}
                                            className="w-full p-2.5 border rounded-lg text-sm mt-1" />
                                        <p className="text-xs text-slate-400 mt-1">Leave blank for no set end.</p>
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
                                <p className="text-sm text-slate-500 mb-2">Choose how flexible you want to be with cancellations.</p>
                                <p className="text-xs text-slate-500 mb-6">
                                    All refunds exclude the Galloway Getaways service fee. Cleaning fees are always
                                    returned in full, since the clean doesn&apos;t happen.
                                </p>
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
                                    Calendars you import (Airbnb, Booking.com, Vrbo…)
                                </label>
                                <div className="mb-6">
                                    <IcalFeeds listingId={listingId} />
                                </div>

                                <label className="block text-sm font-semibold text-slate-800 mb-1">
                                    Your export link for other platforms
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        readOnly
                                        value={typeof window !== 'undefined' && icalToken ? `${window.location.origin}/api/ical/${listingId}?token=${icalToken}` : 'Save this listing to generate your link'}
                                        className="w-full p-3 border rounded-xl text-sm bg-slate-50 text-slate-500"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (!icalToken) {
                                                toast.error('Save this listing first.', { theme: 'colored' });
                                                return;
                                            }
                                            navigator.clipboard.writeText(`${window.location.origin}/api/ical/${listingId}?token=${icalToken}`);
                                            toast.success('Copied.', { theme: 'colored' });
                                        }}
                                        className="px-4 py-2 border rounded-xl text-sm font-semibold text-slate-700 hover:border-slate-500 flex-shrink-0"
                                    >
                                        Copy
                                    </button>
                                </div>
                                <p className="text-xs text-slate-400 mt-1">
                                    Paste this into Airbnb or Booking.com's "import calendar" setting so bookings made here block those dates there too. It works with your own website too. Keep it to yourself — anyone with this link can see when your place is occupied.
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

                        {/* A listing that predates a rule keeps saving, so it
                            would otherwise never be told it is below the
                            standard new listings are held to. Said once, here,
                            and it blocks nothing. */}
                        {belowStandard.length > 0 && (
                            <div className="mt-8 border border-amber-300 bg-amber-50 rounded-xl p-4">
                                <div className="text-sm font-semibold text-amber-900">
                                    This listing is below what a new one would need
                                </div>
                                <ul className="text-sm text-amber-800 mt-2 space-y-1 list-disc pl-5">
                                    {belowStandard.map((item) => (
                                        <li key={item.key}>{item.message}</li>
                                    ))}
                                </ul>
                                <p className="text-xs text-amber-700 mt-2">
                                    It stays on the site and you can carry on saving changes to it.
                                    Worth fixing anyway — a listing with nothing filled in loses
                                    bookings to one that has.
                                </p>
                            </div>
                        )}

                        {formError && <p className="text-red-600 text-sm mt-8">{formError}</p>}

                        <button type="submit" disabled={submitting || (moderating && moderationReason.trim().length < 3)}
                            className="w-full mt-8 py-4 bg-emerald-700 text-white font-bold rounded-xl hover:bg-emerald-800 transition disabled:opacity-60">
                            {submitting ? 'Saving...' : 'Save changes'}
                        </button>
                    </div>
                </div>
            </form>
        </div>
    );
}
