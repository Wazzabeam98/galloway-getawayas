'use client';

import { Accessibility as AccessibilityIcon } from 'lucide-react';
import { ACCESSIBILITY_AMENITIES } from '@/lib/listingFilters';
import { useEffect, useRef, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter, useParams } from 'next/navigation';
import Logo from '@/components/base/Logo';
import { WifiCard, What3wordsCard, DirectionsCard } from '@/components/ArrivalEditor';
import CheckInTimesCard from '@/components/listing-editor/CheckInTimesCard';
import CapacityCard from '@/components/listing-editor/CapacityCard';
import TitleCard from '@/components/listing-editor/TitleCard';
import { HouseRulesCard, CheckoutInstructionsCard, GuestSafetyCard } from '@/components/listing-editor/ArrivalCards';
import {
    petsAllowed as listingAllowsPets, withPetsAmenity, clampMaxPets, cleanGuestSafety,
    withAlarmAmenities, safetyAnswer, SAFETY_GROUPS, type GuestSafety,
} from '@/lib/listingSafety';
import { HowGuestsBookCard, CancellationPolicyCard } from '@/components/listing-editor/BookingCards';
import AutoTextarea from '@/components/AutoTextarea';
import DescriptionCard from '@/components/listing-editor/DescriptionCard';
import AmenitiesCard, { AmenityGrid } from '@/components/listing-editor/AmenitiesCard';
import PhotosEditor, { PhotosCard } from '@/components/listing-editor/PhotosEditor';
import {
    NightlyPriceCard, WeekendPriceCard, DiscountsCard, CleaningFeeCard,
    ExtraGuestFeeCard, PetFeeCard, DamageDepositCard,
} from '@/components/listing-editor/PricingCards';
import { AddressCard, LocationSharingCard, NearbyCard, NeighbourhoodCard } from '@/components/listing-editor/LocationCards';
import PropertyMap from '@/components/PropertyMap';
import LoginModel from '@/components/auth/LoginModel';
import PropertyTypeCard from '@/components/listing-editor/PropertyTypeCard';
import CheckInMethodCard from '@/components/listing-editor/CheckInMethodCard';
import PhoneSectionTabs, { goToEditorSection } from '@/components/listing-editor/PhoneSectionTabs';
import { timeInputValue } from '@/lib/utils';
import { toast } from 'react-toastify';
import { rateFor } from '@/lib/fees';
import { listingLocation, splitLocation, DEFAULT_REGION } from '@/lib/places';
import { buildStreetAddress, tidyPostcode } from '@/lib/address';
import SleepingArrangementsEditor from '@/components/SleepingArrangementsEditor';
import { normaliseArrangements, roomsFromBedroomCount, deriveCounts, type Room } from '@/lib/sleeping';
import { publishProblems } from '@/lib/listingRules';
import { amountForBox, amountOrNull, amountOrZero } from '@/lib/amountInput';
import { CalendarSyncCard } from '@/components/IcalFeeds';
import { QuestionSheetContext } from '@/components/listing-editor/questionSheets';
import {
    HomeIcon, Trees, Waves, Compass, Building2, Sparkles, Snowflake, Package, Refrigerator, Thermometer, Droplet, UtensilsCrossed, Tv, RotateCw, Wifi, Coffee, Wind, Shirt, Zap, Baby, Briefcase, Car, Dumbbell, Bath, ThermometerSun, ThermometerSnowflake, ShowerHead, Flame, Armchair, Umbrella, Anchor, LayoutGrid, MapPin, FileText, Image as ImageIcon, PoundSterling, CalendarRange, RefreshCw, DoorOpen,
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
            { name: 'Cold plunge', icon: ThermometerSnowflake },
            { name: 'Cot', icon: Baby },
            { name: 'Dedicated workspace', icon: Briefcase },
            { name: 'EV charger', icon: Zap },
            { name: 'Free parking on premises', icon: Car },
            { name: 'Free street parking', icon: Car },
            { name: 'Gym', icon: Dumbbell },
            { name: 'Hot tub', icon: Bath },
            { name: 'Indoor fireplace', icon: Flame },
            { name: 'Outdoor furniture', icon: Armchair },
            { name: 'Outdoor shower', icon: ShowerHead },
            { name: 'Pool', icon: Waves },
            { name: 'Sauna', icon: ThermometerSun },
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
    // Pets are set in House rules, and the smoke and carbon monoxide alarms in
    // Guest safety (both under Arrival); they're still stored as amenities.
];



const SECTIONS = [
    { key: 'basics', label: 'Basics & guests', short: 'Basics', icon: LayoutGrid },
    // Airbnb's Arrival guide: how guests get in, the times, wifi, directions
    // and what3words.
    { key: 'arrival', label: 'Arrival', short: 'Arrival', icon: DoorOpen },
    { key: 'location', label: 'Location', short: 'Location', icon: MapPin },
    { key: 'description', label: 'Description', short: 'Description', icon: FileText },
    { key: 'amenities', label: 'Amenities', short: 'Amenities', icon: Sparkles },
    { key: 'photos', label: 'Photos', short: 'Photos', icon: ImageIcon },
    // Every amount the host charges, in one place (the fees, deposit and
    // discounts used to sit under Booking settings and a Discounts tab).
    { key: 'rates', label: 'Pricing & fees', short: 'Pricing', icon: PoundSterling },
    // How guests book and the cancellation policy (stay length is on the
    // calendar's Availability tab) so they're findable and changeable in one place, rather than
    // scattered across Rates / Availability / Cancellation (and, for instant
    // book, only on the Account page).
    { key: 'booking', label: 'Booking settings', short: 'Booking', icon: CalendarRange },
    { key: 'calendar', label: 'Calendar sync', short: 'Calendar sync', icon: RefreshCw },
];

const CANCELLATION_POLICIES = [
    { key: 'Flexible', bullets: ['Full refund up to 1 day before check-in', '50% refund inside 1 day of check-in'] },
    { key: 'Moderate', bullets: ['Full refund up to 5 days before check-in', '50% refund inside 5 days of check-in'] },
    { key: 'Limited', bullets: ['Full refund up to 14 days before check-in', '50% refund 7–14 days before', 'No refund inside 7 days'] },
    { key: 'Firm', bullets: ['Full refund up to 30 days before check-in', '50% refund 7–30 days before', 'No refund inside 7 days'] },
];

// One section of the editor. On desktop just its contents (only the chosen
// section is shown). On a phone, where every section sits on one page, a block
// the tab bar can find and scroll to, with the section's heading — Basics and
// Arrival don't carry one of their own.
const OWN_HEADING = new Set(['location', 'description', 'amenities', 'photos', 'rates', 'booking', 'calendar']);
function PhoneSection({ id, phone, children }: { id: string; phone: boolean; children: React.ReactNode }) {
    if (!phone) return <>{children}</>;
    const label = SECTIONS.find((s) => s.key === id)?.label;
    return (
        <div data-editor-section={id} className="mt-14 first:mt-0">
            {!OWN_HEADING.has(id) && <h2 className="text-xl font-bold text-slate-900 mb-4">{label}</h2>}
            {children}
        </div>
    );
}

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
    // On a phone the editor is one continuous page — every section in order,
    // with a sticky tab bar (PhoneSectionTabs) in place of the left-hand list.
    // Decided in JS, not CSS, so each card is mounted once.
    const [isPhone, setIsPhone] = useState(false);
    useEffect(() => {
        const mq = window.matchMedia('(max-width: 767px)');
        const sync = () => setIsPhone(mq.matches);
        sync();
        mq.addEventListener('change', sync);
        return () => mq.removeEventListener('change', sync);
    }, []);
    // Desktop shows the chosen section; a phone shows them all.
    const shows = (key: string) => isPhone || activeSection === key;

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
    // Saved paths, cover first.
    const [photos, setPhotos] = useState<string[]>([]);
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
    const [maxPets, setMaxPets] = useState(1);
    const [checkoutTasks, setCheckoutTasks] = useState<string[]>([]);
    const [checkoutNote, setCheckoutNote] = useState('');
    const [guestSafety, setGuestSafety] = useState<GuestSafety>({});
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
            setPrice(amountForBox(listing.price_per_night));
            setWeekendPrice(amountForBox(listing.weekend_price));
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
            setPhotos(listing.images || []);
            photosRef.current = listing.images || [];
            setNewListingPromo(listing.new_listing_promo ?? true);
            setLastMinuteDiscount(listing.last_minute_discount ?? false);
            setWeeklyDiscount(listing.weekly_discount ?? false);
            setExtraGuestFee(amountForBox(listing.extra_guest_fee));
            setExtraGuestAfter(amountForBox(listing.extra_guest_after));
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
            setMaxPets(clampMaxPets(listing.max_pets));
            setCheckoutTasks(Array.isArray(listing.checkout_tasks) ? listing.checkout_tasks : []);
            setCheckoutNote(listing.checkout_note || '');
            setGuestSafety(listing.guest_safety && typeof listing.guest_safety === 'object' ? listing.guest_safety : {});
            setCancellationPolicy(listing.cancellation_policy || 'Moderate');
            setNonRefundableOption(listing.non_refundable_option ?? false);
            setCleaningFee(amountForBox(listing.cleaning_fee));
            setPetFee(amountForBox(listing.pet_fee));
            setDamageDeposit(amountForBox(listing.damage_deposit));
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
        // The Discounts tab folded into Pricing & fees; House rules into Arrival.
        const key = s === 'discounts' ? 'rates' : s === 'rules' ? 'arrival' : s;
        if (key && SECTIONS.some((x) => x.key === key)) setActiveSection(key);
    }, []);

    // A section is seen from its start: the top of the page. (Desktop only —
    // a phone has every section on one page and the tab bar scrolls to them.)
    const openSection = (key: string) => {
        setActiveSection(key);
        requestAnimationFrame(() => window.scrollTo({ top: 0 }));
    };

    // What this listing already fails, as it stands on screen. Only ever shown,
    // never enforced here — the save route enforces newProblems, which asks
    // what each change would newly break.
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

    // EVERY CARD SAVES ITSELF, as on Airbnb — there is no Save for the page.
    // A sheet's Save sends just that card's columns through /api/listings/save
    // (the server route, so a co-host the owner trusted can edit too, and where
    // the listing rules are binding: a change that would newly break one is
    // refused with the reason). Writes go one at a time, in the order made, so
    // two quick changes to the same column land as the host made them.
    const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
    const write = async (patch: Record<string, unknown>): Promise<boolean> => {
        try {
            const res = await fetch('/api/listings/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ listingId, patch, reason: moderating ? moderationReason : undefined }),
            });
            const data = await res.json().catch(() => null);
            if (!data || !data.ok) {
                toast.error((data && data.error) || 'Could not save that change.', { theme: 'colored' });
                return false;
            }
            // No "Saved" pop-up: the sheet closing is the confirmation, as on
            // Airbnb. Only a failure says anything.
            setOriginal((prev: any) => ({ ...prev, ...patch }));
            return true;
        } catch (err: any) {
            toast.error(err?.message || 'Could not save that change.', { theme: 'colored' });
            return false;
        }
    };
    const persist = (patch: Record<string, unknown>): Promise<boolean> => {
        // An owner editing somebody else's listing writes down why first; the
        // server refuses without it.
        if (moderating && moderationReason.trim().length < 3) {
            toast.error('Write why you are making this change first.', { theme: 'colored' });
            return Promise.resolve(false);
        }
        const run = saveQueue.current.then(() => write(patch), () => write(patch));
        saveQueue.current = run;
        return run;
    };
    // A sheet's Save: write first, and only then show the new answer. False
    // keeps the sheet open with what the host typed.
    const saveThen = (patch: Record<string, unknown>, apply: () => void) =>
        persist(patch).then((ok) => { if (ok) apply(); return ok; });

    // Amenities on desktop and photos change on a tap, so they show at once and are put
    // back if the write fails.
    const toggleAmenity = (name: string) => {
        const before = amenities;
        const next = before.includes(name) ? before.filter((a) => a !== name) : [...before, name];
        setAmenities(next);
        persist({ amenities: next }).then((ok) => { if (!ok) setAmenities(before); });
    };
    const photosRef = useRef<string[]>([]);
    const savePhotos = (change: (current: string[]) => string[]) => {
        const before = photosRef.current;
        const next = change(before);
        photosRef.current = next;
        setPhotos(next);
        return persist({ images: next }).then((ok) => {
            if (!ok && photosRef.current === next) { photosRef.current = before; setPhotos(before); }
            return ok;
        });
    };
    const moderationReady = () => {
        if (moderating && moderationReason.trim().length < 3) {
            toast.error('Write why you are making this change first.', { theme: 'colored' });
            return false;
        }
        return true;
    };

    // The bed total is the host's own number (the rooms are placed against it);
    // the bedroom count is derived from the rooms. A bedroom with no beds still
    // counts as a room; a common space with no beds is dropped. When no beds
    // are placed at all, the counts and arrangements the listing had are kept
    // rather than zeroed.
    const saveSleeping = (rooms: Room[]) => {
        const cleanRooms: Room[] = rooms
            .map((r) => ({ ...r, beds: r.beds.filter((b) => b.count > 0) }))
            .filter((r) => r.kind === 'bedroom' || r.beds.length > 0);
        const derived = deriveCounts(cleanRooms);
        const hasSleeping = derived.beds > 0;
        return saveThen({
            sleeping_arrangements: hasSleeping ? cleanRooms : (original?.sleeping_arrangements ?? []),
            bedrooms: hasSleeping ? derived.bedrooms : bedrooms,
        }, () => { setSleeping(rooms); if (hasSleeping) setBedrooms(derived.bedrooms); });
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
        // Every card's sheet opens as one full-screen question in the add flow's style.
        <QuestionSheetContext.Provider value={true}>
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
                    <button type="button" onClick={() => (isPhone ? goToEditorSection('location') : setActiveSection('location'))}
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
                            Nothing saves until you write one.
                        </p>
                    )}
                </div>
            )}


            {isPhone && (
                <PhoneSectionTabs
                    sections={SECTIONS.map(({ key, short }) => ({ key, label: short }))}
                    initial={activeSection}
                />
            )}

            <div>
                <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-10">
                    {/* Sidebar — held in place on desktop, just below the sticky site header. */}
                    {!isPhone && <div className="space-y-1 md:sticky md:top-24 md:self-start">
                        {SECTIONS.map(({ key, label, icon: Icon }) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => openSection(key)}
                                className={`w-full flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition ${activeSection === key ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}
                            >
                                <Icon className="w-4 h-4 mr-3" /> {label}
                            </button>
                        ))}
                    </div>}

                    {/* Content — min-w-0 so the 1fr grid track can shrink below
                        its content's width; without it a long card summary blows
                        the track out and the cards run off the right of the page. */}
                    <div className="min-w-0">
                        {shows('basics') && (<PhoneSection id="basics" phone={isPhone}>
                            <div className="space-y-4">
                                <section className="space-y-4">
                                    <TitleCard title={title} onSave={(t) => saveThen({ title: t.trim() }, () => setTitle(t))} />

                                    <PropertyTypeCard
                                        propertyType={propertyType}
                                        privacyType={privacyType}
                                        onSave={(type, listingType) => saveThen({
                                            property_type: type,
                                            privacy_type: listingType,
                                            // Some safety questions depend on the kind of place.
                                            ...(listingType !== privacyType ? { guest_safety: cleanGuestSafety(guestSafety, listingType) } : {}),
                                        }, () => { setPropertyType(type); setPrivacyType(listingType); })}
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
                                        onSave={(g, b, ba) => saveThen({ max_guests: g, beds: b, bathrooms: ba }, () => { setGuests(g); setBeds(b); setBathrooms(ba); })}
                                    />
                                    <div className="mt-4">
                                        <SleepingArrangementsEditor
                                            rooms={sleeping}
                                            onChange={saveSleeping}
                                            totalBeds={beds}
                                            photos={photos}
                                        />
                                    </div>
                                </section>

                            </div>
                        </PhoneSection>)}

                        {shows('arrival') && (<PhoneSection id="arrival" phone={isPhone}>
                            <section className="space-y-4">
                                    {/* The method saves with the listing; the door
                                        code inside its panel saves on its own route —
                                        it is not on the listing row. */}
                                    {listingId && (
                                        <CheckInMethodCard listingId={listingId} method={checkInMethod} onChange={(m) => saveThen({ check_in_method: m || null }, () => setCheckInMethod(m))} />
                                    )}

                                    <CheckInTimesCard
                                        start={checkinStart}
                                        end={checkinEnd}
                                        checkout={checkoutTime}
                                        onSave={(start, end, checkout) => saveThen({
                                            // These also decide when scheduled messages go out —
                                            // send_due_scheduled_messages() counts "before check-out"
                                            // back from check_out_time — so they are not display-only.
                                            check_in_time: start || '15:00',
                                            check_in_end_time: end || null,
                                            check_out_time: checkout || '11:00',
                                        }, () => { setCheckinStart(start); setCheckinEnd(end); setCheckoutTime(checkout); })}
                                    />

                                    {/* Saved on the arrival route, not this form's Save. */}
                                    {listingId && <WifiCard listingId={listingId} />}
                                    {/* Directions and what3words save on the arrival route too;
                                        check-in messages and the arrival screen read them there. */}
                                    {listingId && <DirectionsCard listingId={listingId} />}
                                    {listingId && <What3wordsCard listingId={listingId} />}

                                    {/* House rules — the one place pets are set; "Pets allowed"
                                        stays the amenity everything public reads. */}
                                    <HouseRulesCard
                                        rules={{
                                            petsAllowed: listingAllowsPets({ amenities }), maxPets,
                                            eventsAllowed, smokingAllowed, commercialPhotographyAllowed,
                                            quietHoursEnabled, quietHoursStart, quietHoursEnd, additionalRules,
                                        }}
                                        onSave={(r) => {
                                            const nextAmenities = withPetsAmenity(amenities, r.petsAllowed);
                                            return saveThen({
                                                amenities: nextAmenities,
                                                max_pets: r.petsAllowed ? r.maxPets : null,
                                                events_allowed: r.eventsAllowed,
                                                smoking_allowed: r.smokingAllowed,
                                                commercial_photography_allowed: r.commercialPhotographyAllowed,
                                                quiet_hours_enabled: r.quietHoursEnabled,
                                                quiet_hours_start: r.quietHoursStart,
                                                quiet_hours_end: r.quietHoursEnd,
                                                additional_rules: r.additionalRules,
                                            }, () => {
                                                setAmenities(nextAmenities);
                                                setMaxPets(r.maxPets);
                                                setEventsAllowed(r.eventsAllowed);
                                                setSmokingAllowed(r.smokingAllowed);
                                                setCommercialPhotographyAllowed(r.commercialPhotographyAllowed);
                                                setQuietHoursEnabled(r.quietHoursEnabled);
                                                setQuietHoursStart(r.quietHoursStart);
                                                setQuietHoursEnd(r.quietHoursEnd);
                                                setAdditionalRules(r.additionalRules);
                                            });
                                        }}
                                    />
                                    <CheckoutInstructionsCard
                                        tasks={checkoutTasks}
                                        note={checkoutNote}
                                        onSave={(t, n) => saveThen({ checkout_tasks: t, checkout_note: n.trim() || null }, () => { setCheckoutTasks(t); setCheckoutNote(n); })}
                                    />
                                    {/* Guest safety. The two alarms are stored as amenities,
                                        so they follow the answers here. */}
                                    <GuestSafetyCard
                                        safety={guestSafety}
                                        privacyType={privacyType}
                                        alarmAnswers={Object.fromEntries(SAFETY_GROUPS.flatMap((g) => g.items).filter((i) => i.amenity).map((i) => [i.key, safetyAnswer(i, guestSafety, amenities)]))}
                                        onSave={(sf) => {
                                            const nextAmenities = withAlarmAmenities(amenities, sf);
                                            return saveThen({ guest_safety: cleanGuestSafety(sf, privacyType), amenities: nextAmenities },
                                                () => { setGuestSafety(sf); setAmenities(nextAmenities); });
                                        }}
                                    />
                            </section>
                        </PhoneSection>)}

                        {shows('location') && (<PhoneSection id="location" phone={isPhone}>
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
                                            onSave={(t, st, pc) => saveThen({
                                                location: listingLocation(t),
                                                street_address: buildStreetAddress(null, null, st) || null,
                                                postcode: pc.trim() ? tidyPostcode(pc) : null,
                                            }, () => { setLocTown(t); setStreetAddress(st); setLocPostcode(pc); })}
                                        />
                                        <LocationSharingCard precise={showPrecise} onSave={(v) => saveThen({ show_precise_location: v }, () => setShowPrecise(v))} />
                                    </div>
                                </section>

                                <section className="space-y-4">
                                    <NearbyCard nearby={nearby} onSave={(n) => saveThen({ nearby: n.filter((x) => x.name.trim()) }, () => setNearby(n))} />
                                    <NeighbourhoodCard text={neighbourhood} onSave={(t) => saveThen({ neighbourhood: t.trim() || null }, () => setNeighbourhood(t))} />
                                </section>
                            </div>
                        </PhoneSection>)}

                        {shows('description') && (<PhoneSection id="description" phone={isPhone}>
                            <section>
                                <h2 className="text-xl font-bold text-slate-900 mb-2">Description</h2>
                                <DescriptionCard description={description} onSave={(d) => saveThen({ description: d }, () => setDescription(d))} />
                            </section>
                        </PhoneSection>)}

                        {shows('amenities') && (<PhoneSection id="amenities" phone={isPhone}>
                            <section>
                                <h2 className="text-xl font-bold text-slate-900 mb-1">Amenities</h2>
                                {isPhone ? (
                                    // A raised card on a phone, so scrolling past can never
                                    // toggle a tile; its sheet saves on Save.
                                    <div className="mt-3">
                                        <AmenitiesCard categories={AMENITY_CATEGORIES} amenities={amenities}
                                            onSave={(next) => saveThen({ amenities: next }, () => setAmenities(next))} />
                                    </div>
                                ) : (
                                    <>
                                        <p className="text-sm text-slate-400 mb-4">{amenities.length} selected</p>
                                        <AmenityGrid categories={AMENITY_CATEGORIES} selected={amenities} onToggle={toggleAmenity} />
                                    </>
                                )}
                            </section>
                        </PhoneSection>)}

                        {shows('photos') && (<PhoneSection id="photos" phone={isPhone}>
                            {isPhone ? (
                                // A raised card on a phone, so scrolling past can never
                                // move a photo; the full editor is in its sheet.
                                <section>
                                    <h2 className="text-xl font-bold text-slate-900 mb-4">Photos</h2>
                                    <PhotosCard photos={photos} savePhotos={savePhotos} beforeChange={moderationReady} question="Show guests what it’s like" />
                                </section>
                            ) : (
                                <PhotosEditor photos={photos} savePhotos={savePhotos} isPhone={false} beforeChange={moderationReady} />
                            )}
                        </PhoneSection>)}

                        {shows('rates') && (<PhoneSection id="rates" phone={isPhone}>
                            <section className="space-y-4">
                                <h2 className="text-xl font-bold text-slate-900">Pricing &amp; fees</h2>
                                <NightlyPriceCard price={price} feePercent={HOST_FEE_PERCENT} onSave={(v) => saveThen({ price_per_night: amountOrNull(v) ?? 0 }, () => setPrice(v))} />
                                <WeekendPriceCard weekendPrice={weekendPrice} onSave={(v) => saveThen({ weekend_price: amountOrNull(v) }, () => setWeekendPrice(v))} />
                                <DiscountsCard
                                    discounts={{ newListingPromo, lastMinute: lastMinuteDiscount, weekly: weeklyDiscount, monthly: monthlyDiscount }}
                                    onSave={(d) => saveThen({ new_listing_promo: d.newListingPromo, last_minute_discount: d.lastMinute, weekly_discount: d.weekly, monthly_discount: d.monthly }, () => { setNewListingPromo(d.newListingPromo); setLastMinuteDiscount(d.lastMinute); setWeeklyDiscount(d.weekly); setMonthlyDiscount(d.monthly); })}
                                />
                                <CleaningFeeCard fee={cleaningFee} onSave={(v) => saveThen({ cleaning_fee: amountOrZero(v) }, () => setCleaningFee(v))} />
                                <ExtraGuestFeeCard fee={extraGuestFee} after={extraGuestAfter} onSave={(f, a) => saveThen({ extra_guest_fee: amountOrZero(f), extra_guest_after: amountOrNull(a) ?? 1 }, () => { setExtraGuestFee(f); setExtraGuestAfter(a); })} />
                                <PetFeeCard fee={petFee} petsAllowed={amenities.includes('Pets allowed')} onSave={(v) => saveThen({ pet_fee: amountOrZero(v) }, () => setPetFee(v))} />
                                <DamageDepositCard deposit={damageDeposit} onSave={(v) => saveThen({ damage_deposit: amountOrZero(v) }, () => setDamageDeposit(v))} />
                            </section>
                        </PhoneSection>)}

                        {shows('booking') && (<PhoneSection id="booking" phone={isPhone}>
                            <section className="space-y-4">
                                <h2 className="text-xl font-bold text-slate-900">Booking settings</h2>
                                <HowGuestsBookCard
                                    instantBook={instantBook}
                                    requiresPhone={instantBookRequiresPhone}
                                    onSave={(ib, phone) => saveThen({ instant_book: ib, instant_book_requires_phone: ib ? phone : false }, () => { setInstantBook(ib); setInstantBookRequiresPhone(phone); })}
                                />
                                <CancellationPolicyCard
                                    policies={CANCELLATION_POLICIES}
                                    policy={cancellationPolicy}
                                    nonRefundable={nonRefundableOption}
                                    onSave={(pol, nr) => saveThen({ cancellation_policy: pol, non_refundable_option: nr }, () => { setCancellationPolicy(pol); setNonRefundableOption(nr); })}
                                />
                            </section>
                        </PhoneSection>)}

                        {shows('calendar') && (<PhoneSection id="calendar" phone={isPhone}>
                            <section>
                                <h2 className="text-xl font-bold text-slate-900 mb-4">Calendar sync</h2>
                                <CalendarSyncCard
                                    listingId={listingId}
                                    exportUrl={typeof window !== 'undefined' && icalToken ? `${window.location.origin}/api/ical/${listingId}?token=${icalToken}` : null}
                                />
                            </section>
                        </PhoneSection>)}

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

                    </div>
                </div>
            </div>
        </div>
        </QuestionSheetContext.Provider>
    );
}
