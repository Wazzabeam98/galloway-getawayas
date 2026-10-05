'use client';

import { Accessibility as AccessibilityIcon } from 'lucide-react';
import { ACCESSIBILITY_AMENITIES } from '@/lib/listingFilters';
import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter, useParams } from 'next/navigation';
import Logo from '@/components/base/Logo';
import { WifiCard, What3wordsCard, DirectionsCard } from '@/components/ArrivalEditor';
import CheckInTimesCard from '@/components/listing-editor/CheckInTimesCard';
import CapacityCard from '@/components/listing-editor/CapacityCard';
import TitleCard from '@/components/listing-editor/TitleCard';
import { HowGuestsBookCard, CancellationPolicyCard } from '@/components/listing-editor/BookingCards';
import AutoTextarea from '@/components/AutoTextarea';
import {
    NightlyPriceCard, WeekendPriceCard, DiscountsCard, CleaningFeeCard,
    ExtraGuestFeeCard, PetFeeCard, DamageDepositCard,
} from '@/components/listing-editor/PricingCards';
import { AddressCard, LocationSharingCard, NearbyCard, NeighbourhoodCard } from '@/components/listing-editor/LocationCards';
import PropertyMap from '@/components/PropertyMap';
import LoginModel from '@/components/auth/LoginModel';
import PropertyTypeCard from '@/components/listing-editor/PropertyTypeCard';
import CheckInMethodCard from '@/components/listing-editor/CheckInMethodCard';
import Env from '@/config/Env';
import { generateRandomNumber, getImageUrl, timeInputValue } from '@/lib/utils';
import { toast } from 'react-toastify';
import { rateFor } from '@/lib/fees';
import { listingLocation, splitLocation, DEFAULT_REGION } from '@/lib/places';
import { buildStreetAddress, tidyPostcode } from '@/lib/address';
import SleepingArrangementsEditor from '@/components/SleepingArrangementsEditor';
import { normaliseArrangements, roomsFromBedroomCount, deriveCounts, type Room } from '@/lib/sleeping';
import { fromRow, newProblems, publishProblems } from '@/lib/listingRules';
import { compressImage } from '@/lib/compressImage';
import IcalFeeds from '@/components/IcalFeeds';
import {
    HomeIcon, Trees, Waves, Compass, Building2, Sparkles, Check,
    Snowflake, Package, Refrigerator, Thermometer, Droplet, UtensilsCrossed, Tv,
    RotateCw, Wifi, Coffee, Wind, Shirt, Zap, Baby, Briefcase, Car, Dumbbell, Bath,
    Flame, Armchair, Umbrella, Anchor, AlertTriangle, BellRing, PawPrint,
    LayoutGrid, MapPin, FileText, Image as ImageIcon, PoundSterling, CalendarRange,
    RefreshCw, ShieldAlert, X, DoorOpen,
} from 'lucide-react';


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
            { name: 'Free street parking', icon: Car },
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
        // Airbnb's step-free features — what the "Accessibility features"
        // filter on the home page searches (lib/listingFilters).
        category: 'Accessibility',
        items: ACCESSIBILITY_AMENITIES.map((name) => ({ name, icon: AccessibilityIcon })),
    },
    {
        category: 'Safety',
        items: [
            { name: 'Carbon monoxide alarm', icon: AlertTriangle },
            { name: 'Smoke alarm', icon: BellRing },
        ],
    },
];



const SECTIONS = [
    { key: 'basics', label: 'Basics & guests', icon: LayoutGrid },
    // Airbnb's Arrival guide: how guests get in, the times, wifi, directions
    // and what3words.
    { key: 'arrival', label: 'Arrival', icon: DoorOpen },
    { key: 'location', label: 'Location', icon: MapPin },
    { key: 'description', label: 'Description', icon: FileText },
    { key: 'amenities', label: 'Amenities', icon: Sparkles },
    { key: 'photos', label: 'Photos', icon: ImageIcon },
    // Every amount the host charges, in one place (the fees, deposit and
    // discounts used to sit under Booking settings and a Discounts tab).
    { key: 'rates', label: 'Pricing & fees', icon: PoundSterling },
    // How guests book and the cancellation policy (stay length is on the
    // calendar's Availability tab) so they're findable and changeable in one place, rather than
    // scattered across Rates / Availability / Cancellation (and, for instant
    // book, only on the Account page).
    { key: 'booking', label: 'Booking settings', icon: CalendarRange },
    { key: 'rules', label: 'House rules', icon: ShieldAlert },
    { key: 'calendar', label: 'Calendar sync', icon: RefreshCw },
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
    const [streetAddress, setStreetAddress] = useState('');
    const [listingStatus, setListingStatus] = useState('');
    const [locPostcode, setLocPostcode] = useState('');
    // The saved pin (listing_private), for the host's own map, and whether the
    // public listing shows it exactly.
    const [pin, setPin] = useState<{ latitude: number; longitude: number } | null>(null);
    const [showPrecise, setShowPrecise] = useState(false);
    const [price, setPrice] = useState('');
    const [weekendPrice, setWeekendPrice] = useState('');
    const [propertyType, setPropertyType] = useState('');
    const [privacyType, setPrivacyType] = useState('Entire place');
    const [guests, setGuests] = useState(1);
    const [bedrooms, setBedrooms] = useState(1);
    const [beds, setBeds] = useState(1);
    const [bathrooms, setBathrooms] = useState(1);
    // Beds entered room by room; the two integers above are derived from this on
    // save (deriveCounts) so they stay in sync. Seeded from the listing's
    // arrangements, or from its bedroom count when it has none yet.
    const [sleeping, setSleeping] = useState<Room[]>([]);
    const [neighbourhood, setNeighbourhood] = useState('');
    const [amenities, setAmenities] = useState<string[]>([]);
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [coverIndex, setCoverIndex] = useState(0);
    const [checkInMethod, setCheckInMethod] = useState('');
    const [nearby, setNearby] = useState<{ name: string; time: string }[]>([]);
    const [newListingPromo, setNewListingPromo] = useState(true);
    const [lastMinuteDiscount, setLastMinuteDiscount] = useState(false);
    const [weeklyDiscount, setWeeklyDiscount] = useState(false);
    const [monthlyDiscount, setMonthlyDiscount] = useState(false);
    // Extra-guest fee: charged per guest per night above a set number. Used at
    // booking AND when a reservation is changed to add guests.
    const [extraGuestFee, setExtraGuestFee] = useState('');
    const [extraGuestAfter, setExtraGuestAfter] = useState('');
    const [icalToken, setIcalToken] = useState('');
    const [isCoHost, setIsCoHost] = useState(false);
    // Set when an owner opens somebody else's listing. Everything it turns on
    // — the banner, the required reason — exists so this can never be mistaken
    // for editing your own.
    const [moderating, setModerating] = useState(false);
    const [moderationReason, setModerationReason] = useState('');
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
    // Booking settings gathered in one place (were scattered or, for instant
    // book, only on the Account page). Defaults are unchanged — an empty fee is
    // still no fee, request-to-book is still the default.
    const [cleaningFee, setCleaningFee] = useState('');
    const [petFee, setPetFee] = useState('');
    const [damageDeposit, setDamageDeposit] = useState('');
    const [instantBook, setInstantBook] = useState(false);
    const [instantBookRequiresPhone, setInstantBookRequiresPhone] = useState(false);

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
                // listing_private: the owner/active-co-host view. The sensitive
                // columns (street_address, coords, ical_token, commission_rate)
                // are revoked from the base table for the browser role and read
                // here instead — see 20260903154419.
                .from('listing_private')
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
            setStreetAddress(listing.street_address || '');
            setLocPostcode(listing.postcode || '');
            setPin(listing.latitude != null && listing.longitude != null
                ? { latitude: Number(listing.latitude), longitude: Number(listing.longitude) }
                : null);
            setShowPrecise(listing.show_precise_location === true);
            setListingStatus(listing.status || '');
            setPrice(String(listing.price_per_night ?? ''));
            setWeekendPrice(listing.weekend_price != null ? String(listing.weekend_price) : '');
            setCommissionRate(listing.commission_rate ?? null);
            setPropertyType(listing.property_type || '');
            setPrivacyType(listing.privacy_type || 'Entire place');
            setGuests(listing.max_guests || 1);
            setBedrooms(listing.bedrooms ?? 1);
            setBeds(Math.max(listing.beds ?? 1, deriveCounts(normaliseArrangements(listing.sleeping_arrangements)).beds));
            setBathrooms(listing.bathrooms ?? 1);
            {
                const existing = normaliseArrangements(listing.sleeping_arrangements);
                setSleeping(existing.length ? existing : roomsFromBedroomCount(listing.bedrooms ?? 1));
            }
            setNeighbourhood(listing.neighbourhood || '');
            setAmenities(listing.amenities || []);
            setPhotos((listing.images || []).map((path: string) => ({ kind: 'existing', path })));
            setNewListingPromo(listing.new_listing_promo ?? true);
            setLastMinuteDiscount(listing.last_minute_discount ?? false);
            setWeeklyDiscount(listing.weekly_discount ?? false);
            setExtraGuestFee(listing.extra_guest_fee != null ? String(listing.extra_guest_fee) : '');
            setExtraGuestAfter(listing.extra_guest_after != null ? String(listing.extra_guest_after) : '');
            setMonthlyDiscount(listing.monthly_discount ?? false);
            setIcalToken(listing.ical_token || '');
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
            setCleaningFee(listing.cleaning_fee != null ? String(listing.cleaning_fee) : '');
            setPetFee(listing.pet_fee != null ? String(listing.pet_fee) : '');
            setDamageDeposit(listing.damage_deposit != null ? String(listing.damage_deposit) : '');
            setInstantBook(listing.instant_book ?? false);
            setInstantBookRequiresPhone(listing.instant_book_requires_phone ?? false);

            setLoading(false);
        };
        load();
    }, [supabase, listingId]);

    // Open a specific tab from ?section= (the Account page links straight to
    // Booking settings, so a host lands on the controls they came for).
    useEffect(() => {
        const s = new URLSearchParams(window.location.search).get('section');
        // The Discounts tab folded into Pricing & fees.
        const key = s === 'discounts' ? 'rates' : s;
        if (key && SECTIONS.some((x) => x.key === key)) setActiveSection(key);
    }, []);

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
            region: DEFAULT_REGION,
            postcode: locPostcode,
            photoCount: photos.length,
            title: title,
            description: description,
            price: price,
            weekendPrice: weekendPrice,
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
            region: DEFAULT_REGION,
            postcode: locPostcode,
            photoCount: photos.length,
            title: title,
            description: description,
            price: price,
            weekendPrice: weekendPrice,
            amenities: amenities,
            checkInMethod: checkInMethod,
        });

        if (introduced.length > 0) {
            setFormError(introduced[0].message);
            return;
        }


        setSubmitting(true);
        try {
            // Cover first, then the rest — but only when there IS a cover. On a
            // listing with no photos, photos[coverIndex] is undefined, and the old
            // [undefined, ...] array threw "reading 'kind'" below, so the save
            // crashed before it ever ran. Filter guards it either way.
            const cover = photos[coverIndex];
            const orderedPhotos = (cover ? [cover, ...photos.filter((_, i) => i !== coverIndex)] : [...photos])
                .filter(Boolean);
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

            // The bed total is the host's own number (the rooms are placed
            // against it); the bedroom count is derived from the rooms. A
            // bedroom with no beds still counts as a room; a common space with no beds is
            // dropped. When the host hasn't entered any beds yet (an older
            // listing just opened on the seeded cards), keep the counts and
            // arrangements it already had rather than zeroing them.
            const cleanRooms: Room[] = sleeping
                .map((r) => ({ ...r, beds: r.beds.filter((b) => b.count > 0) }))
                .filter((r) => r.kind === 'bedroom' || r.beds.length > 0);
            const derived = deriveCounts(cleanRooms);
            const hasSleeping = derived.beds > 0;

            // Saved through the server so a co-host the owner trusted can
            // edit too — row-level security would block them otherwise.
            const patch = {
                    title: title.trim(),
                    description,
                    location: listingLocation(locTown),
                    street_address: buildStreetAddress(null, null, streetAddress) || null,
                    postcode: locPostcode.trim() ? tidyPostcode(locPostcode) : null,
                    show_precise_location: showPrecise,
                    price_per_night: Number(price),
                    weekend_price: weekendPrice.trim() ? Number(weekendPrice) : null,
                    extra_guest_fee: extraGuestFee.trim() ? Number(extraGuestFee) : null,
                    extra_guest_after: extraGuestAfter.trim() ? Number(extraGuestAfter) : null,
                    max_guests: guests,
                    images: finalPaths,
                    property_type: propertyType,
                    privacy_type: privacyType,
                    bedrooms: hasSleeping ? derived.bedrooms : bedrooms,
                    // The host's total: the cap the rooms are placed against.
                    beds,
                    sleeping_arrangements: hasSleeping ? cleanRooms : (original?.sleeping_arrangements ?? []),
                    bathrooms,
                    amenities,
                    new_listing_promo: newListingPromo,
                    last_minute_discount: lastMinuteDiscount,
                    weekly_discount: weeklyDiscount,
                    monthly_discount: monthlyDiscount,
                    events_allowed: eventsAllowed,
                    smoking_allowed: smokingAllowed,
                    quiet_hours_enabled: quietHoursEnabled,
                    check_in_method: checkInMethod || null,
                    nearby: nearby.filter((n) => n.name.trim()),
                    neighbourhood: neighbourhood.trim() || null,
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
                    cleaning_fee: cleaningFee.trim() ? Number(cleaningFee) : null,
                    pet_fee: petFee.trim() ? Number(petFee) : null,
                    damage_deposit: damageDeposit.trim() ? Number(damageDeposit) : null,
                    instant_book: instantBook,
                    instant_book_requires_phone: instantBook ? instantBookRequiresPhone : false,
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
                <div className="w-full max-w-xs"><LoginModel variant="button" /></div>
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

            {/* A live listing with no address a guest can be sent to. Grandfathered
                listings predate the required-address rule, so we don't block Save
                (a host shouldn't be stopped fixing a typo) — but we do say it,
                loudly, with a jump to where it's fixed. */}
            {(listingStatus === 'published' || listingStatus === 'hidden')
                && (!streetAddress.trim() || !locPostcode.trim()) && (
                <div className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 p-4">
                    <p className="font-semibold text-amber-900">
                        This listing is live but has no {!streetAddress.trim() ? 'street address' : 'postcode'}.
                    </p>
                    <p className="mt-1 text-sm text-amber-900/80">
                        A booked guest needs somewhere to be sent. Add it under Location — it stays private and is only shared once a booking is confirmed.
                    </p>
                    <button type="button" onClick={() => setActiveSection('location')}
                        className="mt-3 rounded-md bg-amber-700 px-3 py-2 text-sm font-medium text-white">
                        Add the address
                    </button>
                </div>
            )}

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
                    <AutoTextarea
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


            <form onSubmit={handleSubmit}>
                <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-10">
                    {/* Sidebar — held in place on desktop, just below the sticky site header. */}
                    <div className="space-y-1 md:sticky md:top-24 md:self-start">
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
                            <div className="space-y-4">
                                <section className="space-y-4">
                                    <TitleCard title={title} onSave={setTitle} />

                                    <PropertyTypeCard
                                        propertyType={propertyType}
                                        privacyType={privacyType}
                                        onSave={(type, listingType) => { setPropertyType(type); setPrivacyType(listingType); }}
                                    />
                                </section>

                                <section>
                                    {/* Beds is the total the rooms below are placed
                                        against; it can't drop below the beds already placed. */}
                                    <CapacityCard
                                        guests={guests}
                                        beds={beds}
                                        bathrooms={bathrooms}
                                        minBeds={deriveCounts(sleeping).beds}
                                        onSave={(g, b, ba) => { setGuests(g); setBeds(b); setBathrooms(ba); }}
                                    />
                                    <div className="mt-4">
                                        <SleepingArrangementsEditor
                                            rooms={sleeping}
                                            onChange={setSleeping}
                                            totalBeds={beds}
                                            photos={photos.filter((p) => p.kind === 'existing').map((p) => (p as { path: string }).path)}
                                        />
                                    </div>
                                </section>

                            </div>
                        )}

                        {activeSection === 'arrival' && (
                            <section className="space-y-4">
                                    {/* The method saves with the listing; the door
                                        code inside its panel saves on its own route —
                                        it is not on the listing row. */}
                                    {listingId && (
                                        <CheckInMethodCard listingId={listingId} method={checkInMethod} onChange={setCheckInMethod} />
                                    )}

                                    <CheckInTimesCard
                                        start={checkinStart}
                                        end={checkinEnd}
                                        checkout={checkoutTime}
                                        onSave={(start, end, checkout) => { setCheckinStart(start); setCheckinEnd(end); setCheckoutTime(checkout); }}
                                    />

                                    {/* Saved on the arrival route, not this form's Save. */}
                                    {listingId && <WifiCard listingId={listingId} />}
                                    {/* Directions and what3words save on the arrival route too;
                                        check-in messages and the arrival screen read them there. */}
                                    {listingId && <DirectionsCard listingId={listingId} />}
                                    {listingId && <What3wordsCard listingId={listingId} />}
                            </section>
                        )}

                        {activeSection === 'location' && (
                            <div className="space-y-4">
                                <section>
                                    <h2 className="text-xl font-bold text-slate-900 mb-4">Location</h2>
                                    <div className="space-y-4">
                                        {/* The host's own exact pin — this map is never shown to guests. */}
                                        {pin && <PropertyMap variant="host" latitude={pin.latitude} longitude={pin.longitude} />}
                                        <AddressCard
                                            town={locTown}
                                            street={streetAddress}
                                            postcode={locPostcode}
                                            propertyType={propertyType}
                                            onSave={(t, st, pc) => { setLocTown(t); setStreetAddress(st); setLocPostcode(pc); }}
                                        />
                                        <LocationSharingCard precise={showPrecise} onSave={setShowPrecise} />
                                    </div>
                                </section>

                                <section className="space-y-4">
                                    <NearbyCard nearby={nearby} onSave={setNearby} />
                                    <NeighbourhoodCard text={neighbourhood} onSave={setNeighbourhood} />
                                </section>
                            </div>
                        )}

                        {activeSection === 'description' && (
                            <section>
                                <h2 className="text-xl font-bold text-slate-900 mb-2">Description</h2>
                                <AutoTextarea value={description} onChange={(e) => setDescription(e.target.value)} rows={8} className="w-full p-3 border rounded-xl" />
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
                            <section className="space-y-4">
                                <h2 className="text-xl font-bold text-slate-900">Pricing &amp; fees</h2>
                                <NightlyPriceCard price={price} feePercent={HOST_FEE_PERCENT} onSave={setPrice} />
                                <WeekendPriceCard weekendPrice={weekendPrice} onSave={setWeekendPrice} />
                                <DiscountsCard
                                    discounts={{ newListingPromo, lastMinute: lastMinuteDiscount, weekly: weeklyDiscount, monthly: monthlyDiscount }}
                                    onSave={(d) => { setNewListingPromo(d.newListingPromo); setLastMinuteDiscount(d.lastMinute); setWeeklyDiscount(d.weekly); setMonthlyDiscount(d.monthly); }}
                                />
                                <CleaningFeeCard fee={cleaningFee} onSave={setCleaningFee} />
                                <ExtraGuestFeeCard fee={extraGuestFee} after={extraGuestAfter} onSave={(f, a) => { setExtraGuestFee(f); setExtraGuestAfter(a); }} />
                                <PetFeeCard fee={petFee} petsAllowed={amenities.includes('Pets allowed')} onSave={setPetFee} />
                                <DamageDepositCard deposit={damageDeposit} onSave={setDamageDeposit} />
                            </section>
                        )}

                        {activeSection === 'booking' && (
                            <section className="space-y-4">
                                <h2 className="text-xl font-bold text-slate-900">Booking settings</h2>
                                <HowGuestsBookCard
                                    instantBook={instantBook}
                                    requiresPhone={instantBookRequiresPhone}
                                    onSave={(ib, phone) => { setInstantBook(ib); setInstantBookRequiresPhone(phone); }}
                                />
                                <CancellationPolicyCard
                                    policies={CANCELLATION_POLICIES}
                                    policy={cancellationPolicy}
                                    nonRefundable={nonRefundableOption}
                                    onSave={(pol, nr) => { setCancellationPolicy(pol); setNonRefundableOption(nr); }}
                                />
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

                                <h3 className="font-semibold text-slate-800 mt-8 mb-2">Additional rules</h3>
                                <AutoTextarea
                                    value={additionalRules}
                                    onChange={(e) => setAdditionalRules(e.target.value)}
                                    rows={4}
                                    placeholder="Share anything else you expect from guests..."
                                    className="w-full p-3 border rounded-xl text-sm"
                                />
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

                        {formError && (
                            <div role="alert" className="mt-8 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                                {formError}
                            </div>
                        )}

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
