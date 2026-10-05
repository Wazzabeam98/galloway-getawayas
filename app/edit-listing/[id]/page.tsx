'use client';

import { Accessibility as AccessibilityIcon } from 'lucide-react';
import { ACCESSIBILITY_AMENITIES } from '@/lib/listingFilters';
import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter, useParams } from 'next/navigation';
import Logo from '@/components/base/Logo';
import LockboxCode from '@/components/LockboxCode';
import ArrivalEditor from '@/components/ArrivalEditor';
import Link from 'next/link';
import LoginModel from '@/components/auth/LoginModel';
import PropertyTypePicker from '@/components/PropertyTypePicker';
import { addressLineLabel } from '@/lib/propertyTypes';
import Env from '@/config/Env';
import { generateRandomNumber, getImageUrl, timeInputValue } from '@/lib/utils';
import { toast } from 'react-toastify';
import { rateFor, feeAmount, netOfFee } from '@/lib/fees';
import { buildLocation, splitLocation, DEFAULT_REGION } from '@/lib/places';
import { buildStreetAddress, tidyPostcode } from '@/lib/address';
import SleepingArrangementsEditor from '@/components/SleepingArrangementsEditor';
import { normaliseArrangements, roomsFromBedroomCount, deriveCounts, type Room } from '@/lib/sleeping';
import { fromRow, newProblems, publishProblems } from '@/lib/listingRules';
import { HIGHLIGHTS, MAX_HIGHLIGHTS, highlightSentence } from '@/components/listingHighlights';
import {
    SAFETY_DISCLOSURES, CHECKOUT_INSTRUCTIONS, cleanItems, itemProblems, labelFor, NOTE_MAX,
    type ItemDef, type ListingItem,
} from '@/lib/listingDisclosures';
import { LICENCE_STATUSES, licenceWarning, licenceStatusLabel } from '@/lib/stlLicence';
import { ADVANCE_NOTICE_OPTIONS, PREP_TIME_OPTIONS, AVAILABILITY_WINDOW_OPTIONS } from '@/lib/availabilityOptions';
import { formatGBP } from '@/lib/formatMoney';
import type { ArrivalValues } from '@/components/ArrivalEditor';
import { compressImage } from '@/lib/compressImage';
import IcalFeeds from '@/components/IcalFeeds';
import {
    HomeIcon, Trees, Waves, Compass, Building2, Sparkles, Minus, Plus, Check,
    KeyRound, Lock, DoorOpen, Hash, Users,
    Snowflake, Package, Refrigerator, Thermometer, Droplet, UtensilsCrossed, Tv,
    RotateCw, Wifi, Coffee, Wind, Shirt, Zap, Baby, Briefcase, Car, Dumbbell, Bath,
    Flame, Armchair, Umbrella, Anchor, AlertTriangle, BellRing, PawPrint,
    MapPin, X, ChevronLeft,
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



// THE EDITOR'S SHAPE — Airbnb's listing editor, 5 October 2026.
//
// Three tabs, each a column of section cards. Every card names the section and
// says in one line what is set now, so a host can see the state of the whole
// listing without opening anything; tapping a card opens that section beside
// the list (desktop) or in place of it (phone). Same idea as Airbnb's "Your
// space" / "Arrival guide" split, with our Pricing and booking as the third,
// because a listing here carries its own prices, rules and licence.
const TABS = [
    { key: 'space', label: 'Your space' },
    { key: 'arrival', label: 'Arrival' },
    { key: 'pricing', label: 'Pricing and booking' },
] as const;
type TabKey = typeof TABS[number]['key'];

const SECTIONS: { key: string; tab: TabKey; title: string }[] = [
    { key: 'photos', tab: 'space', title: 'Photos' },
    { key: 'title', tab: 'space', title: 'Title and description' },
    { key: 'type', tab: 'space', title: 'Property type' },
    { key: 'guests', tab: 'space', title: 'Guests and sleeping arrangements' },
    { key: 'amenities', tab: 'space', title: 'Amenities' },
    { key: 'accessibility', tab: 'space', title: 'Accessibility' },
    { key: 'location', tab: 'space', title: "Location and what's nearby" },
    { key: 'safety', tab: 'space', title: 'Guest safety' },
    { key: 'rules', tab: 'space', title: 'House rules' },

    { key: 'times', tab: 'arrival', title: 'Check-in and checkout times' },
    { key: 'access', tab: 'arrival', title: 'How guests get in' },
    { key: 'directions', tab: 'arrival', title: 'Directions and parking' },
    { key: 'wifi', tab: 'arrival', title: 'Wifi' },
    { key: 'checkout', tab: 'arrival', title: 'Checkout instructions' },

    { key: 'price', tab: 'pricing', title: 'Nightly price' },
    { key: 'discounts', tab: 'pricing', title: 'Discounts' },
    { key: 'fees', tab: 'pricing', title: 'Fees and deposit' },
    { key: 'availability', tab: 'pricing', title: 'Stay length and availability' },
    { key: 'booking', tab: 'pricing', title: 'How guests book' },
    { key: 'cancellation', tab: 'pricing', title: 'Cancellation policy' },
    { key: 'licence', tab: 'pricing', title: 'Short-term let licence' },
];

// The old section names, so a link written before the rebuild (the Account
// page's "Booking settings →", a bookmark) still lands somewhere sensible.
const LEGACY_SECTIONS: Record<string, string> = {
    basics: 'type', description: 'title', rates: 'price', calendar: 'availability',
};

// These sections save through their own secure routes (the arrival details
// table), never this form's Save — so the form's Save button is not shown on
// them, where it would look like it saved what is on screen.
const OWN_SAVE_SECTIONS = ['directions', 'wifi'];

// Shown in the Amenities section; the other two categories have sections of
// their own (Accessibility, Guest safety), as on Airbnb.
const SPLIT_OUT_CATEGORIES = ['Accessibility', 'Safety'];

// Tick what applies, with a note under each ticked one. Used for the safety
// disclosures and the checkout instructions — same shape, same rules
// (lib/listingDisclosures).
function ItemPicker({
    defs,
    value,
    onChange,
    notePlaceholder,
}: {
    defs: ItemDef[];
    value: ListingItem[];
    onChange: (v: ListingItem[]) => void;
    notePlaceholder: string;
}) {
    const on = (key: string) => value.some((v) => v.key === key);
    const toggle = (key: string) =>
        onChange(on(key) ? value.filter((v) => v.key !== key) : cleanItems([...value, { key, note: '' }], defs));
    const setNote = (key: string, note: string) =>
        onChange(value.map((v) => (v.key === key ? { ...v, note } : v)));

    return (
        <div className="divide-y divide-slate-200 rounded-2xl border border-slate-200">
            {defs.map((d) => {
                const checked = on(d.key);
                const item = value.find((v) => v.key === d.key);
                return (
                    <div key={d.key} className="p-4">
                        <label className="flex cursor-pointer items-start justify-between gap-4">
                            <span>
                                <span className="block text-sm font-medium text-slate-900">{d.label}</span>
                                {d.hint && <span className="mt-0.5 block text-xs text-slate-500">{d.hint}</span>}
                            </span>
                            <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggle(d.key)}
                                aria-label={d.label}
                                className="mt-0.5 h-5 w-5 flex-none accent-slate-900"
                            />
                        </label>
                        {checked && (
                            <div className="mt-3">
                                <textarea
                                    value={item?.note || ''}
                                    onChange={(e) => setNote(d.key, e.target.value)}
                                    rows={2}
                                    maxLength={NOTE_MAX}
                                    placeholder={d.noteRequired ? d.noteRequired : notePlaceholder}
                                    aria-label={`Details: ${d.label}`}
                                    className="w-full rounded-xl border p-3 text-sm"
                                />
                                {d.noteRequired && !(item?.note || '').trim() && (
                                    <p className="mt-1 text-xs text-amber-700">Needed before you can save.</p>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// "£160", "£12.50" — whole pounds without the pence, for the card summaries.
function gbp(n: number | string): string {
    return formatGBP(n).replace(/\.00$/, '');
}

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
    const [activeSection, setActiveSection] = useState('photos');
    const [activeTab, setActiveTab] = useState<TabKey>('space');
    // On a phone the section list and the open section take turns, as on
    // Airbnb's app; on a desktop both show, side by side.
    const [phoneOpen, setPhoneOpen] = useState(false);

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    // Was a single free-text box holding the whole address. A street typed in
    // there went straight into `location`, which is the public field — the same
    // way the malformed one got there in the first place. Four boxes now, and
    // `location` is assembled from two of them.
    const [locTown, setLocTown] = useState('');
    const [locRegion, setLocRegion] = useState(DEFAULT_REGION);
    const [streetAddress, setStreetAddress] = useState('');
    const [listingStatus, setListingStatus] = useState('');
    const [locPostcode, setLocPostcode] = useState('');
    const [price, setPrice] = useState('');
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
    const [selectedHighlights, setSelectedHighlights] = useState<string[]>([]);
    const [safety, setSafety] = useState<ListingItem[]>([]);
    const [checkoutSteps, setCheckoutSteps] = useState<ListingItem[]>([]);
    const [weekendPrice, setWeekendPrice] = useState('');
    const [extraGuestPeriod, setExtraGuestPeriod] = useState<'night' | 'stay'>('night');
    const [advanceNotice, setAdvanceNotice] = useState('Same day');
    const [preparationTime, setPreparationTime] = useState('None');
    const [availabilityWindow, setAvailabilityWindow] = useState('9 months');
    const [stlStatus, setStlStatus] = useState('none');
    const [stlNumber, setStlNumber] = useState('');
    const [stlExpiry, setStlExpiry] = useState('');
    // The arrival details live in their own table behind their own route; the
    // two arrival editors hand their values up so the cards can summarise them.
    const [arrival, setArrival] = useState<ArrivalValues | null>(null);
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
            setLocRegion(place.region || DEFAULT_REGION);
            setStreetAddress(listing.street_address || '');
            setLocPostcode(listing.postcode || '');
            setListingStatus(listing.status || '');
            setPrice(String(listing.price_per_night ?? ''));
            setCommissionRate(listing.commission_rate ?? null);
            setPropertyType(listing.property_type || '');
            setPrivacyType(listing.privacy_type || 'Entire place');
            setGuests(listing.max_guests || 1);
            setBedrooms(listing.bedrooms ?? 1);
            setBeds(listing.beds ?? 1);
            setBathrooms(listing.bathrooms ?? 1);
            {
                const existing = normaliseArrangements(listing.sleeping_arrangements);
                setSleeping(existing.length ? existing : roomsFromBedroomCount(listing.bedrooms ?? 1));
            }
            setNeighbourhood(listing.neighbourhood || '');
            setSafety(cleanItems(listing.safety_disclosures, SAFETY_DISCLOSURES));
            setCheckoutSteps(cleanItems(listing.checkout_instructions, CHECKOUT_INSTRUCTIONS));
            setWeekendPrice(listing.weekend_price != null ? String(listing.weekend_price) : '');
            setExtraGuestPeriod(listing.extra_guest_period === 'stay' ? 'stay' : 'night');
            setAdvanceNotice(listing.advance_notice || 'Same day');
            setPreparationTime(listing.preparation_time || 'None');
            setAvailabilityWindow(listing.availability_window || '9 months');
            setStlStatus(listing.stl_licence_status || 'none');
            setStlNumber(listing.stl_licence_number || '');
            setStlExpiry((listing.stl_licence_expiry || '').slice(0, 10));
            setAmenities(listing.amenities || []);
            setPhotos((listing.images || []).map((path: string) => ({ kind: 'existing', path })));
            setNewListingPromo(listing.new_listing_promo ?? true);
            setLastMinuteDiscount(listing.last_minute_discount ?? false);
            setWeeklyDiscount(listing.weekly_discount ?? false);
            setExtraGuestFee(listing.extra_guest_fee != null ? String(listing.extra_guest_fee) : '');
            setExtraGuestAfter(listing.extra_guest_after != null ? String(listing.extra_guest_after) : '');
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
            setCleaningFee(listing.cleaning_fee != null ? String(listing.cleaning_fee) : '');
            setPetFee(listing.pet_fee != null ? String(listing.pet_fee) : '');
            setDamageDeposit(listing.damage_deposit != null ? String(listing.damage_deposit) : '');
            setInstantBook(listing.instant_book ?? false);
            setInstantBookRequiresPhone(listing.instant_book_requires_phone ?? false);

            setLoading(false);
        };
        load();
    }, [supabase, listingId]);

    // The arrival details, read once for the Directions and Wifi card
    // summaries — the same owner-gated GET the two arrival editors use.
    useEffect(() => {
        if (!session || !listingId || notOwner || notFound) return;
        fetch('/api/listings/arrival?listing=' + encodeURIComponent(listingId))
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                const a = (d && d.arrival) || {};
                setArrival({
                    arrival_directions: a.arrival_directions || '',
                    parking_info: a.parking_info || '',
                    wifi_name: a.wifi_name || '',
                    wifi_password: a.wifi_password || '',
                    what3words: a.what3words || '',
                });
            })
            .catch(() => {});
    }, [session, listingId, notOwner, notFound]);

    // Open a section, and the tab it lives in.
    const openSection = (key: string) => {
        const found = SECTIONS.find((x) => x.key === key);
        if (!found) return;
        setActiveTab(found.tab);
        setActiveSection(key);
        setPhoneOpen(true);
        // On a phone the section replaces the list, so start it at the top
        // rather than wherever the tapped card was.
        if (typeof window !== 'undefined' && window.innerWidth < 768) window.scrollTo({ top: 0 });
    };

    // Switching tab shows that tab's list, with its first section open beside
    // it on a desktop.
    const openTab = (tab: TabKey) => {
        setActiveTab(tab);
        setActiveSection(SECTIONS.find((x) => x.tab === tab)!.key);
        setPhoneOpen(false);
    };

    // Open a specific section from ?section= (the Account page links straight
    // to How guests book and the licence, so a host lands where they meant to).
    useEffect(() => {
        const raw = new URLSearchParams(window.location.search).get('section');
        const key = raw ? (LEGACY_SECTIONS[raw] || raw) : '';
        if (key) openSection(key);
        // eslint-disable-next-line react-hooks/exhaustive-deps
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

        // The notes a guest is owed — where the cameras are, what "anything
        // else" means. The save route asks the same question of the same
        // helper, so this is a kindness, not the guard.
        const safetyProblems = itemProblems(safety, SAFETY_DISCLOSURES);
        if (safetyProblems.length > 0) {
            openSection('safety');
            setFormError(safetyProblems[0]);
            return;
        }
        const checkoutProblems = itemProblems(checkoutSteps, CHECKOUT_INSTRUCTIONS);
        if (checkoutProblems.length > 0) {
            openSection('checkout');
            setFormError(checkoutProblems[0]);
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

            // Beds entered room by room are the source of truth; the two flat
            // integers are derived from them so they can't drift. A bedroom with
            // no beds still counts as a room; a common space with no beds is
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
                    location: buildLocation(locTown, locRegion),
                    street_address: buildStreetAddress(null, null, streetAddress) || null,
                    postcode: locPostcode.trim() ? tidyPostcode(locPostcode) : null,
                    price_per_night: Number(price),
                    extra_guest_fee: extraGuestFee.trim() ? Number(extraGuestFee) : null,
                    extra_guest_after: extraGuestAfter.trim() ? Number(extraGuestAfter) : null,
                    max_guests: guests,
                    images: finalPaths,
                    property_type: propertyType,
                    privacy_type: privacyType,
                    bedrooms: hasSleeping ? derived.bedrooms : bedrooms,
                    beds: hasSleeping ? derived.beds : beds,
                    sleeping_arrangements: hasSleeping ? cleanRooms : (original?.sleeping_arrangements ?? []),
                    bathrooms,
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
                    weekend_price: weekendPrice.trim() ? Number(weekendPrice) : null,
                    extra_guest_period: extraGuestPeriod,
                    advance_notice: advanceNotice,
                    preparation_time: preparationTime,
                    availability_window: availabilityWindow,
                    stl_licence_status: stlStatus,
                    stl_licence_number: stlNumber.trim() ? stlNumber.trim().toUpperCase() : null,
                    stl_licence_expiry: stlExpiry || null,
                    safety_disclosures: safety,
                    checkout_instructions: checkoutSteps,
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

            // Stay where you are, the way Airbnb's editor does — a host fixing
            // one section usually has another to do. What was saved becomes the
            // baseline the next edit is judged against, and the photos just
            // uploaded are now ordinary stored ones, cover first.
            setOriginal((prev: any) => ({ ...prev, ...patch }));
            setPhotos(finalPaths.map((path) => ({ kind: 'existing' as const, path })));
            setCoverIndex(0);
            if (stlNumber.trim()) setStlNumber(stlNumber.trim().toUpperCase());
            toast.success('Saved.', { theme: 'colored' });
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

    // ---- the one-line summaries on the section cards ----
    const roomCounts = deriveCounts(sleeping);
    const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
    const amenityNames = AMENITY_CATEGORIES
        .filter((c) => !SPLIT_OUT_CATEGORIES.includes(c.category))
        .flatMap((c) => c.items.map((i) => i.name));
    const shownAmenities = amenities.filter((a) => amenityNames.includes(a));
    const accessibilityOn = amenities.filter((a) => (ACCESSIBILITY_AMENITIES as readonly string[]).includes(a));
    const alarms = ['Smoke alarm', 'Carbon monoxide alarm'].filter((a) => amenities.includes(a));
    const discountsOn = [
        newListingPromo && 'New listing 20%',
        lastMinuteDiscount && 'Last-minute 5%',
        weeklyDiscount && 'Weekly 10%',
        monthlyDiscount && 'Monthly 20%',
    ].filter(Boolean) as string[];
    const feesOn = [
        Number(cleaningFee) > 0 && `Cleaning ${gbp(cleaningFee)}`,
        Number(extraGuestFee) > 0 && `Extra guest ${gbp(extraGuestFee)}`,
        Number(petFee) > 0 && `Pet ${gbp(petFee)}`,
        Number(damageDeposit) > 0 && `Deposit ${gbp(damageDeposit)}`,
    ].filter(Boolean) as string[];
    const licenceNote = licenceWarning({
        stl_licence_status: stlStatus,
        stl_licence_number: stlNumber.trim().toUpperCase(),
        stl_licence_expiry: stlExpiry || null,
    });
    const listOrNone = (items: string[], none: string, max = 3) =>
        items.length === 0 ? none : items.slice(0, max).join(' · ') + (items.length > max ? ` · +${items.length - max} more` : '');

    const summaries: Record<string, { text: string; warn?: boolean }> = {
        photos: photos.length
            ? { text: plural(photos.length, 'photo') }
            : { text: 'No photos yet', warn: true },
        title: title.trim() ? { text: title.trim() } : { text: 'Add a title', warn: true },
        type: {
            text: [privacyType, propertyType ? propertyType.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '']
                .filter(Boolean).join(' · ') || 'Not chosen yet',
            warn: !propertyType,
        },
        guests: {
            text: [
                plural(guests, 'guest'),
                plural(roomCounts.beds > 0 ? roomCounts.bedrooms : bedrooms, 'bedroom'),
                plural(roomCounts.beds > 0 ? roomCounts.beds : beds, 'bed'),
                plural(bathrooms, 'bathroom'),
            ].join(' · '),
        },
        amenities: { text: listOrNone(shownAmenities, 'None added yet'), warn: shownAmenities.length === 0 },
        accessibility: { text: listOrNone(accessibilityOn, 'None added', 2) },
        location: buildLocation(locTown, locRegion)
            ? { text: buildLocation(locTown, locRegion) + (nearby.filter((n) => n.name.trim()).length ? ` · ${plural(nearby.filter((n) => n.name.trim()).length, 'place')} nearby` : '') }
            : { text: 'Add your town', warn: true },
        safety: {
            text: listOrNone(
                [
                    ...alarms.map((a) => (a === 'Carbon monoxide alarm' ? 'CO alarm' : a)),
                    ...(safety.length ? [plural(safety.length, 'disclosure')] : []),
                ],
                'Nothing added yet'
            ),
            warn: alarms.length < 2,
        },
        rules: {
            text: [
                eventsAllowed ? 'Events allowed' : 'No events',
                smokingAllowed ? 'Smoking allowed' : 'No smoking',
                quietHoursEnabled ? `Quiet hours ${quietHoursStart}–${quietHoursEnd}` : '',
            ].filter(Boolean).join(' · '),
        },
        times: { text: `Check-in after ${checkinStart || '15:00'} · Checkout before ${checkoutTime || '11:00'}` },
        access: checkInMethod ? { text: checkInMethod } : { text: 'Not chosen yet', warn: true },
        directions: {
            text: !arrival
                ? 'Directions, parking and what3words'
                : listOrNone(
                    [
                        arrival.arrival_directions.trim() && 'Directions',
                        arrival.parking_info.trim() && 'Parking',
                        arrival.what3words.trim() && 'what3words',
                    ].filter(Boolean) as string[],
                    'Not added yet'
                ),
        },
        wifi: {
            text: !arrival ? 'Network name and password' : arrival.wifi_name.trim() ? `Network: ${arrival.wifi_name.trim()}` : 'Not added yet',
        },
        checkout: { text: listOrNone(checkoutSteps.map((c) => labelFor(CHECKOUT_INSTRUCTIONS, c.key)), 'None added yet', 2) },
        price: Number(price) > 0
            ? { text: `${gbp(price)} per night` + (Number(weekendPrice) > 0 ? ` · ${gbp(weekendPrice)} weekends` : '') }
            : { text: 'No price set', warn: true },
        discounts: { text: listOrNone(discountsOn, 'None', 2) },
        fees: { text: listOrNone(feesOn, 'No extra fees', 2) },
        availability: {
            text: `${minNights || 1}${maxNights ? '–' + maxNights : '+'} night stays · ${advanceNotice === 'Same day' ? 'same-day' : advanceNotice} notice`,
        },
        booking: { text: instantBook ? 'Instant book' : 'Request to book — you approve each one' },
        cancellation: { text: cancellationPolicy + (nonRefundableOption ? ' · non-refundable option' : '') },
        licence: {
            text: stlNumber.trim()
                ? `${licenceStatusLabel(stlStatus)} · ${stlNumber.trim().toUpperCase()}`
                : stlStatus === 'none' ? 'Not added — required in Scotland' : licenceStatusLabel(stlStatus),
            warn: !!licenceNote,
        },
    };

    const coverPhoto = photos[coverIndex] || photos[0];
    const coverSrc = coverPhoto
        ? coverPhoto.kind === 'existing' ? getImageUrl(coverPhoto.path) : URL.createObjectURL(coverPhoto.file)
        : '';

    const toggleRow = (label: string, value: boolean, set: (v: boolean) => void) => (
        <div key={label} className="p-4 flex items-center justify-between gap-4">
            <span className="text-sm font-medium text-slate-800">{label}</span>
            <div className="flex gap-2 flex-none">
                <button type="button" onClick={() => set(false)} aria-label={`${label}: no`}
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${!value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-400'}`}>
                    <X className="w-4 h-4" />
                </button>
                <button type="button" onClick={() => set(true)} aria-label={`${label}: yes`}
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-400'}`}>
                    <Check className="w-4 h-4" />
                </button>
            </div>
        </div>
    );

    const amenityGrid = (items: { name: string; icon: any; note?: string }[]) => (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {items.map(({ name, icon: Icon, note }) => {
                const selected = amenities.includes(name);
                return (
                    <button key={name} type="button" onClick={() => toggleAmenity(name)} aria-pressed={selected}
                        className={`p-3 rounded-2xl border-2 text-left transition relative ${selected ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}>
                        <Icon className="w-4 h-4 mb-2 text-slate-700" />
                        <div className="text-xs font-semibold text-slate-900 pr-5">{name}</div>
                        {note && <div className="text-[10px] text-slate-400 mt-0.5">{note}</div>}
                        {selected && <Check className="w-4 h-4 text-slate-900 absolute top-3 right-3" />}
                    </button>
                );
            })}
        </div>
    );

    const payout = (amount: number) => (
        <div className="bg-slate-50 rounded-2xl border p-4 max-w-xs text-sm">
            <div className="flex justify-between text-slate-600 mb-1">
                <span>Guest pays</span><span className="font-medium text-slate-900">£{amount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-600 mb-1">
                <span>Host fee ({HOST_FEE_PERCENT}%)</span>
                <span className="font-medium text-slate-900">− £{feeAmount(amount, HOST_FEE_PERCENT).toFixed(2)}</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-slate-200">
                <span className="font-semibold text-slate-900">You receive</span>
                <span className="font-bold text-emerald-700">£{netOfFee(amount, HOST_FEE_PERCENT).toFixed(2)}</span>
            </div>
        </div>
    );

    const H2 = ({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) => (
        <div className="mb-5">
            <h2 className="text-xl font-bold text-slate-900">{children}</h2>
            {sub && <p className="mt-1 text-sm text-slate-500">{sub}</p>}
        </div>
    );

    const moneyInput = (value: string, set: (v: string) => void, unit?: string, placeholder = '0') => (
        <div className="flex items-center border-2 rounded-xl px-3 py-2 max-w-[11rem] bg-white">
            <span className="text-slate-500 mr-1">£</span>
            <input type="number" inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} className="outline-none w-full text-slate-900" />
            {unit && <span className="text-slate-500 text-sm ml-1 whitespace-nowrap">{unit}</span>}
        </div>
    );

    const activeTitle = SECTIONS.find((x) => x.key === activeSection)?.title || '';

    return (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 md:py-10 w-full">
            <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
                <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900">Listing editor</h1>
                <div className="flex items-center gap-4 text-sm font-semibold">
                    {listingStatus === 'published' && (
                        <Link href={`/homes/${listingId}`} className="underline text-slate-600 hover:text-black">View listing</Link>
                    )}
                    <button type="button" onClick={() => router.push(moderating ? '/admin/listings' : '/dashboard')} className="underline text-slate-600 hover:text-black">
                        {moderating ? 'Back to all listings' : 'Back to dashboard'}
                    </button>
                </div>
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
                    <button type="button" onClick={() => openSection('location')}
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

            {/* The three tabs — Airbnb's segmented control. */}
            <div className={`${phoneOpen ? 'hidden md:flex' : 'flex'} mb-6 overflow-x-auto`}>
                <div role="tablist" aria-label="Listing editor" className="inline-flex flex-none rounded-full bg-slate-200/70 p-1">
                    {TABS.map((t) => (
                        <button
                            key={t.key}
                            type="button"
                            role="tab"
                            aria-selected={activeTab === t.key}
                            onClick={() => openTab(t.key)}
                            className={`whitespace-nowrap rounded-full px-3.5 sm:px-5 py-2 text-sm font-semibold transition ${
                                activeTab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                            }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>

            <form onSubmit={handleSubmit}>
                <div className="grid grid-cols-1 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)] gap-6 lg:gap-10 items-start">
                    {/* The section cards — what is set now, at a glance. */}
                    <div className={`${phoneOpen ? 'hidden md:block' : 'block'} space-y-3`}>
                        {SECTIONS.filter((x) => x.tab === activeTab).map((x) => {
                            const sum = summaries[x.key];
                            const selected = activeSection === x.key;
                            return (
                                <button
                                    key={x.key}
                                    type="button"
                                    onClick={() => openSection(x.key)}
                                    aria-current={selected ? 'true' : undefined}
                                    className={`w-full text-left rounded-2xl border border-slate-200 bg-white shadow-[0_6px_16px_rgba(0,0,0,0.12)] p-4 transition flex items-center gap-3 ${
                                        selected ? 'md:ring-2 md:ring-slate-900' : ''
                                    }`}
                                >
                                    <span className="min-w-0 flex-1">
                                        <span className="block font-semibold text-slate-900">{x.title}</span>
                                        <span className={`mt-0.5 block text-sm line-clamp-2 ${sum?.warn ? 'text-amber-700' : 'text-slate-500'}`}>
                                            {sum?.text}
                                        </span>
                                    </span>
                                    {x.key === 'photos' && coverSrc && (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={coverSrc} alt="" className="h-14 w-14 flex-none rounded-lg object-cover" />
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {/* The open section. Flat — it is a form, not a card. */}
                    <div className={`${phoneOpen ? 'block' : 'hidden md:block'} min-w-0 rounded-2xl border border-slate-200 bg-white p-5 md:p-8`}>
                        <button
                            type="button"
                            onClick={() => setPhoneOpen(false)}
                            className="md:hidden -ml-1 mb-4 inline-flex items-center gap-1 text-sm font-semibold text-slate-700"
                        >
                            <ChevronLeft className="h-4 w-4" /> {TABS.find((t) => t.key === activeTab)?.label}
                        </button>

                        {activeSection === 'photos' && (
                            <section>
                                <H2 sub="Drag to reorder. Tap the star to set the cover photo.">Photos</H2>
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
                                                className={`relative h-36 md:h-40 rounded-2xl overflow-hidden border-2 group cursor-grab active:cursor-grabbing transition ${
                                                    i === coverIndex ? 'border-emerald-700' : 'border-slate-200'
                                                } ${dragOverIndex === i ? 'ring-2 ring-slate-900 scale-95' : ''} ${draggedIndex === i ? 'opacity-40' : ''}`}
                                            >
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img
                                                    src={photo.kind === 'existing' ? getImageUrl(photo.path) : URL.createObjectURL(photo.file)}
                                                    alt={`Photo ${i + 1}`}
                                                    className="w-full h-full object-cover pointer-events-none"
                                                />
                                                <button type="button" onClick={() => setCoverIndex(i)}
                                                    title={i === coverIndex ? 'Cover photo' : 'Make cover photo'}
                                                    className={`absolute top-2 right-11 w-8 h-8 rounded-full flex items-center justify-center text-sm shadow ${i === coverIndex ? 'bg-emerald-700 text-white' : 'bg-white/90 text-slate-600 md:opacity-0 md:group-hover:opacity-100 transition'}`}>
                                                    ★
                                                </button>
                                                <button type="button" onClick={() => removePhoto(i)} title="Remove photo"
                                                    className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90 text-slate-600 flex items-center justify-center text-sm shadow md:opacity-0 md:group-hover:opacity-100 transition">
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

                        {activeSection === 'title' && (
                            <section>
                                <H2>Title and description</H2>
                                <label htmlFor="edit-title" className="block text-sm font-semibold text-slate-900 mb-1">Title</label>
                                <p className="text-xs text-slate-500 mb-2">Short titles work best. Have fun with it — you can always change it later.</p>
                                <input id="edit-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} className="w-full p-3 border rounded-xl" />
                                <p className="mt-1 text-xs text-slate-400">{title.length}/80</p>

                                <label htmlFor="edit-description" className="block text-sm font-semibold text-slate-900 mt-8 mb-1">Description</label>
                                <p className="text-xs text-slate-500 mb-3">Choose up to {MAX_HIGHLIGHTS} highlights and we&apos;ll suggest a line for your description.</p>
                                <div className="flex flex-wrap gap-2 mb-3">
                                    {HIGHLIGHTS.map(({ label, icon: Icon }) => {
                                        const selected = selectedHighlights.includes(label);
                                        return (
                                            <button
                                                key={label}
                                                type="button"
                                                aria-pressed={selected}
                                                onClick={() => {
                                                    if (selected) setSelectedHighlights(selectedHighlights.filter((h) => h !== label));
                                                    else if (selectedHighlights.length < MAX_HIGHLIGHTS) setSelectedHighlights([...selectedHighlights, label]);
                                                }}
                                                className={`flex items-center px-4 py-2 rounded-full border-2 text-sm font-semibold transition ${selected ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}
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
                                            const suggestion = highlightSentence(selectedHighlights);
                                            setDescription((prev) => (prev ? `${prev}\n\n${suggestion}` : suggestion));
                                            setSelectedHighlights([]);
                                        }}
                                        className="text-sm font-semibold text-emerald-700 hover:text-emerald-800 mb-3"
                                    >
                                        + Add &ldquo;{highlightSentence(selectedHighlights)}&rdquo; to my description
                                    </button>
                                )}
                                <textarea id="edit-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={8} className="w-full p-3 border rounded-xl" />
                            </section>
                        )}

                        {activeSection === 'type' && (
                            <div className="space-y-10">
                                <section>
                                    <H2>Property type</H2>
                                    <PropertyTypePicker value={propertyType} onChange={setPropertyType} compact />
                                </section>
                                <section>
                                    <h3 className="font-semibold text-slate-900 mb-3">What guests get</h3>
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
                            </div>
                        )}

                        {activeSection === 'guests' && (
                            <section>
                                <H2>Guests and sleeping arrangements</H2>
                                <Counter label="Guests" value={guests} onChange={setGuests} min={1} />
                                <Counter label="Bathrooms" value={bathrooms} onChange={setBathrooms} min={0.5} />
                                {/* Beds are entered room by room; the bedroom
                                    and bed totals are derived from them, so
                                    there are no separate counters for those. */}
                                <div className="mt-6 border-t pt-6">
                                    <SleepingArrangementsEditor
                                        rooms={sleeping}
                                        onChange={setSleeping}
                                        photos={photos.filter((p) => p.kind === 'existing').map((p) => (p as { path: string }).path)}
                                    />
                                </div>
                            </section>
                        )}

                        {activeSection === 'amenities' && (
                            <section>
                                <H2 sub={`${shownAmenities.length} selected`}>Amenities</H2>
                                <div className="space-y-6">
                                    {AMENITY_CATEGORIES.filter((c) => !SPLIT_OUT_CATEGORIES.includes(c.category)).map(({ category, items }) => (
                                        <div key={category}>
                                            <h3 className="font-semibold text-slate-800 text-sm mb-2">{category}</h3>
                                            {amenityGrid(items)}
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}

                        {activeSection === 'accessibility' && (
                            <section>
                                <H2 sub="Step-free features guests can rely on. Guests who need them filter for them, so only tick what is true for every guest.">Accessibility</H2>
                                {amenityGrid(AMENITY_CATEGORIES.find((c) => c.category === 'Accessibility')?.items || [])}
                            </section>
                        )}

                        {activeSection === 'location' && (
                            <div className="space-y-10">
                                <section>
                                    <H2 sub="Guests only ever see the town and region. The street address and postcode are kept private.">Location</H2>
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
                                            <label htmlFor="edit-street" className="text-xs text-slate-500 font-semibold uppercase">{addressLineLabel(propertyType).label} (private)</label>
                                            <input id="edit-street" type="text" value={streetAddress} onChange={(e) => setStreetAddress(e.target.value)}
                                                placeholder={addressLineLabel(propertyType).placeholder}
                                                className="w-full p-3 border rounded-xl text-sm mt-1" />
                                            {addressLineLabel(propertyType).hint && (
                                                <p className="mt-1 text-xs text-slate-500">{addressLineLabel(propertyType).hint}</p>
                                            )}
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
                                    <h3 className="font-semibold text-slate-900 mb-1">What&apos;s nearby</h3>
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
                                                    aria-label="Place"
                                                    onChange={(e) => {
                                                        const next = nearby.slice();
                                                        next[i] = { name: e.target.value, time: next[i].time };
                                                        setNearby(next);
                                                    }}
                                                    className="min-w-0 flex-1 p-3 border rounded-xl text-sm"
                                                />
                                                <input
                                                    type="text"
                                                    value={item.time}
                                                    placeholder="3 min walk"
                                                    aria-label="How far"
                                                    onChange={(e) => {
                                                        const next = nearby.slice();
                                                        next[i] = { name: next[i].name, time: e.target.value };
                                                        setNearby(next);
                                                    }}
                                                    className="w-28 sm:w-40 p-3 border rounded-xl text-sm"
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

                                <section>
                                    <h3 className="font-semibold text-slate-900 mb-1">Where you&apos;ll be</h3>
                                    <p className="text-sm text-slate-500 mb-4">
                                        A few lines about the area — the street, the walk into town, what&apos;s on
                                        the doorstep. Shown under the map. Keep it about the surroundings, not the
                                        house itself (the description covers that).
                                    </p>
                                    <textarea
                                        value={neighbourhood}
                                        onChange={(e) => setNeighbourhood(e.target.value)}
                                        rows={6}
                                        maxLength={2000}
                                        placeholder="St Cuthbert Street runs through the heart of Kirkcudbright, a two-minute walk from the harbour and the galleries…"
                                        className="w-full p-3 border rounded-xl text-sm"
                                    />
                                    <p className="mt-1 text-xs text-slate-400">{neighbourhood.length}/2000</p>
                                </section>
                            </div>
                        )}

                        {activeSection === 'safety' && (
                            <div className="space-y-8">
                                <section>
                                    <H2 sub="What guests should know before they book. All of it is shown on your listing under Safety & property.">Guest safety</H2>
                                    <h3 className="font-semibold text-slate-900 mb-2">Safety devices</h3>
                                    {amenityGrid(AMENITY_CATEGORIES.find((c) => c.category === 'Safety')?.items || [])}
                                </section>
                                <section>
                                    <h3 className="font-semibold text-slate-900 mb-1">Things guests should know about</h3>
                                    <p className="text-sm text-slate-500 mb-3">Tick anything that applies to your place and add a line of detail.</p>
                                    <ItemPicker
                                        defs={SAFETY_DISCLOSURES}
                                        value={safety}
                                        onChange={setSafety}
                                        notePlaceholder="Add details (optional)"
                                    />
                                </section>
                            </div>
                        )}

                        {activeSection === 'rules' && (
                            <section>
                                <H2 sub="Guests are expected to follow your rules and may be removed if they don't. Check-in and checkout times are under Arrival.">House rules</H2>
                                <div className="border rounded-2xl divide-y">
                                    {toggleRow('Events allowed', eventsAllowed, setEventsAllowed)}
                                    {toggleRow('Smoking, vaping, e-cigarettes allowed', smokingAllowed, setSmokingAllowed)}
                                    {toggleRow('Commercial photography and filming allowed', commercialPhotographyAllowed, setCommercialPhotographyAllowed)}
                                    <div>
                                        {toggleRow('Quiet hours', quietHoursEnabled, setQuietHoursEnabled)}
                                        {quietHoursEnabled && (
                                            <div className="grid grid-cols-2 gap-3 px-4 pb-4">
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
                                <p className="mt-3 text-xs text-slate-500">
                                    Pets are set under Amenities (&ldquo;Pets allowed&rdquo;), and the most guests under Guests and sleeping arrangements.
                                </p>

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

                        {activeSection === 'times' && (
                            <section>
                                <H2 sub="Shown on your listing, and used to time your scheduled messages — the checkout reminder counts back from the checkout time.">Check-in and checkout times</H2>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-xl">
                                    <div>
                                        <label className="text-sm font-semibold text-slate-800">Check-in from</label>
                                        <input type="time" value={checkinStart} onChange={(e) => setCheckinStart(e.target.value)}
                                            className="w-full p-2.5 border rounded-lg text-sm mt-1" />
                                    </div>
                                    <div>
                                        <label className="text-sm font-semibold text-slate-800">Check-in until</label>
                                        <input type="time" value={checkinEnd} onChange={(e) => setCheckinEnd(e.target.value)}
                                            className="w-full p-2.5 border rounded-lg text-sm mt-1" />
                                        <p className="text-xs text-slate-400 mt-1">Leave blank for no set end.</p>
                                    </div>
                                    <div>
                                        <label className="text-sm font-semibold text-slate-800">Checkout by</label>
                                        <input type="time" value={checkoutTime} onChange={(e) => setCheckoutTime(e.target.value)}
                                            className="w-full p-2.5 border rounded-lg text-sm mt-1" />
                                    </div>
                                </div>
                            </section>
                        )}

                        {activeSection === 'access' && (
                            <section>
                                <H2 sub="Shown on your listing. The code itself is only ever shown to a booked guest, close to arrival.">How guests get in</H2>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {CHECKIN_METHODS.map(({ label, icon: Icon, note }) => {
                                        const selected = checkInMethod === label;
                                        return (
                                            <button key={label} type="button" aria-pressed={selected}
                                                onClick={() => setCheckInMethod(selected ? '' : label)}
                                                className={`text-left border-2 rounded-2xl p-4 transition ${selected ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}>
                                                <Icon className="w-5 h-5 text-slate-700 mb-2" />
                                                <div className="font-semibold text-slate-900 text-sm">{label}</div>
                                                <div className="text-xs text-slate-500 mt-0.5">{note}</div>
                                            </button>
                                        );
                                    })}
                                </div>
                                {/* Saved on its own, through its own route: the code is
                                    not on the listing row, so it is not part of this
                                    form's Save. */}
                                {listingId && <LockboxCode listingId={listingId} method={checkInMethod} />}
                            </section>
                        )}

                        {/* Directions and wifi: saved on their own secure route,
                            never this form's Save, and none of it gates publishing. */}
                        {activeSection === 'directions' && listingId && (
                            <section>
                                <H2 sub="The way to the door, shown to a booked guest on their Getting-there screen.">Directions and parking</H2>
                                <ArrivalEditor listingId={listingId} part="directions" onValues={setArrival} />
                            </section>
                        )}

                        {activeSection === 'wifi' && listingId && (
                            <section>
                                <H2 sub="Only ever shown to a booked guest, close to arrival.">Wifi</H2>
                                <ArrivalEditor listingId={listingId} part="wifi" onValues={setArrival} />
                            </section>
                        )}

                        {activeSection === 'checkout' && (
                            <section>
                                <H2 sub="What guests should do before they leave. Shown with your house rules as “Before you leave”.">Checkout instructions</H2>
                                <ItemPicker
                                    defs={CHECKOUT_INSTRUCTIONS}
                                    value={checkoutSteps}
                                    onChange={setCheckoutSteps}
                                    notePlaceholder="Add details (optional)"
                                />
                            </section>
                        )}

                        {activeSection === 'price' && (
                            <section className="space-y-8">
                                <div>
                                    <H2 sub="What a guest pays per night. Fees, deposit and discounts have their own sections.">Nightly price</H2>
                                    <div className="flex items-center border-2 rounded-2xl px-5 py-4 mb-3 max-w-xs bg-white">
                                        <span className="text-2xl font-black text-slate-900 mr-2">£</span>
                                        <input type="number" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Nightly price" className="text-2xl font-black text-slate-900 outline-none w-full" />
                                        <span className="text-slate-500 ml-2 whitespace-nowrap">/ night</span>
                                    </div>
                                    {Number(price) > 0 && payout(Number(price))}
                                </div>
                                <div>
                                    <h3 className="font-semibold text-slate-900 mb-1">Weekend price</h3>
                                    <p className="text-sm text-slate-500 mb-3">Friday and Saturday nights. Leave blank to charge the nightly price.</p>
                                    {moneyInput(weekendPrice, setWeekendPrice, '/ night', price || '0')}
                                    {Number(weekendPrice) > 0 && <div className="mt-3">{payout(Number(weekendPrice))}</div>}
                                </div>
                                <p className="text-xs text-slate-500">
                                    Prices for particular dates are set on the <Link href="/dashboard/calendar" className="underline">calendar</Link>, and win over these.
                                </p>
                            </section>
                        )}

                        {activeSection === 'discounts' && (
                            <section>
                                <H2>Discounts</H2>
                                <div className="space-y-3">
                                    {[
                                        { percent: '20%', title: 'New listing promotion', note: 'Available until your listing has 3 reviews or gets booked 10 times', value: newListingPromo, set: setNewListingPromo },
                                        { percent: '5%', title: 'Last-minute discount', note: 'For stays booked 14 days or less before arrival', value: lastMinuteDiscount, set: setLastMinuteDiscount },
                                        { percent: '10%', title: 'Weekly discount', note: 'For stays of 7 nights or more', value: weeklyDiscount, set: setWeeklyDiscount },
                                        { percent: '20%', title: 'Monthly discount', note: 'For stays of 28 nights or more', value: monthlyDiscount, set: setMonthlyDiscount },
                                    ].map((d) => (
                                        <button key={d.title} type="button" onClick={() => d.set(!d.value)} aria-pressed={d.value}
                                            className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 text-left transition ${d.value ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}>
                                            <div className="flex items-center">
                                                <span className="text-sm font-bold text-slate-900 w-12 flex-none">{d.percent}</span>
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

                        {activeSection === 'fees' && (
                            <section>
                                <H2 sub="All optional. Leave any blank for none.">Fees and deposit</H2>
                                <div className="space-y-6">
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-800 mb-1">Cleaning fee</label>
                                        <p className="text-[12px] text-slate-500 mb-1.5">A one-off charge per stay. Always refunded in full if the guest cancels.</p>
                                        {moneyInput(cleaningFee, setCleaningFee, '/ stay')}
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-800 mb-1">Extra guest fee</label>
                                        <p className="text-[12px] text-slate-500 mb-1.5">Charged for each guest above the number included. Also applies when a booking is changed to add guests.</p>
                                        <div className="flex flex-wrap items-end gap-3">
                                            {moneyInput(extraGuestFee, setExtraGuestFee)}
                                            <div>
                                                <span className="block text-[12px] text-slate-500 mb-1">Guests included first</span>
                                                <input type="number" inputMode="numeric" min={1} value={extraGuestAfter} onChange={(e) => setExtraGuestAfter(e.target.value)} placeholder="1" aria-label="Guests included first" className="border-2 rounded-xl px-3 py-2 w-20 outline-none text-slate-900" />
                                            </div>
                                        </div>
                                        <div className="mt-2 inline-flex rounded-xl border-2 p-0.5">
                                            {(['night', 'stay'] as const).map((p) => (
                                                <button key={p} type="button" onClick={() => setExtraGuestPeriod(p)} aria-pressed={extraGuestPeriod === p}
                                                    className={`rounded-lg px-3 py-1.5 text-sm font-medium ${extraGuestPeriod === p ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>
                                                    {p === 'night' ? 'Per night' : 'Once per stay'}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-800 mb-1">Pet fee</label>
                                        <p className="text-[12px] text-slate-500 mb-1.5">{amenities.includes('Pets allowed') ? 'Charged per stay when a guest brings a pet.' : 'Only charged if you allow pets (turn that on under Amenities).'}</p>
                                        {moneyInput(petFee, setPetFee, '/ stay')}
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-800 mb-1">Damage deposit</label>
                                        <p className="text-[12px] text-slate-500 mb-1.5">Shown to guests before they book. You collect and return it yourself at the property — we don&apos;t take it or hold it.</p>
                                        {moneyInput(damageDeposit, setDamageDeposit)}
                                    </div>
                                </div>
                            </section>
                        )}

                        {activeSection === 'availability' && (
                            <section className="space-y-8">
                                <div>
                                    <H2>Stay length and availability</H2>
                                    <div className="grid grid-cols-2 gap-4">
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
                                </div>
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-800 mb-1">Advance notice</label>
                                        <p className="text-xs text-slate-500 mb-1">How much notice you need before a guest arrives.</p>
                                        <select value={advanceNotice} onChange={(e) => setAdvanceNotice(e.target.value)} className="w-full max-w-xs p-2.5 border rounded-lg text-sm bg-white">
                                            {ADVANCE_NOTICE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-800 mb-1">Preparation time</label>
                                        <p className="text-xs text-slate-500 mb-1">Nights blocked between one stay and the next.</p>
                                        <select value={preparationTime} onChange={(e) => setPreparationTime(e.target.value)} className="w-full max-w-xs p-2.5 border rounded-lg text-sm bg-white">
                                            {PREP_TIME_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-slate-800 mb-1">Availability window</label>
                                        <p className="text-xs text-slate-500 mb-1">How far ahead guests can book.</p>
                                        <select value={availabilityWindow} onChange={(e) => setAvailabilityWindow(e.target.value)} className="w-full max-w-xs p-2.5 border rounded-lg text-sm bg-white">
                                            {AVAILABILITY_WINDOW_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                                        </select>
                                    </div>
                                </div>

                                <div className="border-t pt-8">
                                    <h3 className="font-semibold text-slate-900 mb-1">Calendar sync</h3>
                                    <p className="text-sm text-slate-500 mb-4">
                                        Keep this listing&apos;s availability in step with your calendar on other sites.
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
                                            aria-label="Export link"
                                            value={typeof window !== 'undefined' && icalToken ? `${window.location.origin}/api/ical/${listingId}?token=${icalToken}` : 'Save this listing to generate your link'}
                                            className="min-w-0 w-full p-3 border rounded-xl text-sm bg-slate-50 text-slate-500"
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
                                        Paste this into Airbnb or Booking.com&apos;s &ldquo;import calendar&rdquo; setting so bookings made here block those dates there too. It works with your own website too. Keep it to yourself — anyone with this link can see when your place is occupied.
                                    </p>
                                </div>
                            </section>
                        )}

                        {activeSection === 'booking' && (
                            <section>
                                <H2>How guests book</H2>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setInstantBook(false)}
                                        aria-pressed={!instantBook}
                                        className={`text-left px-4 py-3.5 rounded-xl border transition ${!instantBook ? 'border-slate-900 border-2' : 'border-slate-200 hover:border-slate-400'}`}
                                    >
                                        <div className={`text-sm ${!instantBook ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>Request to book</div>
                                        <div className="text-xs text-slate-500 mt-0.5">You approve each booking before the guest is charged.</div>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setInstantBook(true)}
                                        aria-pressed={instantBook}
                                        className={`text-left px-4 py-3.5 rounded-xl border transition ${instantBook ? 'border-slate-900 border-2' : 'border-slate-200 hover:border-slate-400'}`}
                                    >
                                        <div className={`text-sm ${instantBook ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>Instant book</div>
                                        <div className="text-xs text-slate-500 mt-0.5">Guests book and pay straight away, no approval needed.</div>
                                    </button>
                                </div>
                                {instantBook && (
                                    <div className="mt-3 flex items-center justify-between gap-4 rounded-xl border p-4">
                                        <span>
                                            <span className="block text-sm font-medium text-slate-800">Require a phone number</span>
                                            <span className="block text-xs text-slate-500">Guests add a verified phone before they can instant-book.</span>
                                        </span>
                                        <button
                                            type="button"
                                            aria-checked={instantBookRequiresPhone}
                                            aria-label="Require a phone number"
                                            role="switch"
                                            onClick={() => setInstantBookRequiresPhone(!instantBookRequiresPhone)}
                                            className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors ${instantBookRequiresPhone ? 'bg-emerald-700' : 'bg-slate-300'}`}
                                        >
                                            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ${instantBookRequiresPhone ? 'translate-x-5' : 'translate-x-0.5'}`} />
                                        </button>
                                    </div>
                                )}
                            </section>
                        )}

                        {activeSection === 'cancellation' && (
                            <section>
                                <H2 sub="All refunds exclude the Galloway Getaways service fee. Cleaning fees are always returned in full, since the clean doesn't happen.">Cancellation policy</H2>
                                <div className="space-y-3">
                                    {CANCELLATION_POLICIES.map((policy) => (
                                        <button
                                            key={policy.key}
                                            type="button"
                                            onClick={() => setCancellationPolicy(policy.key)}
                                            aria-pressed={cancellationPolicy === policy.key}
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
                                <div className="mt-4 p-4 border rounded-2xl flex items-start justify-between gap-4">
                                    <div>
                                        <div className="font-semibold text-slate-900 text-sm mb-1">Non-refundable option</div>
                                        <p className="text-xs text-slate-500">
                                            For short-term stays, guests pay 10% less in exchange for you keeping your full payout if they cancel.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={nonRefundableOption}
                                        aria-label="Non-refundable option"
                                        onClick={() => setNonRefundableOption(!nonRefundableOption)}
                                        className={`flex-shrink-0 w-11 h-6 rounded-full relative transition ${nonRefundableOption ? 'bg-slate-900' : 'bg-slate-300'}`}
                                    >
                                        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${nonRefundableOption ? 'left-5' : 'left-0.5'}`} />
                                    </button>
                                </div>
                            </section>
                        )}

                        {activeSection === 'licence' && (
                            <section>
                                <H2 sub="Short-term lets in Scotland need a licence from the council, and the number has to appear on any advert. We show it on your listing, under the description.">Short-term let licence</H2>
                                <div className="space-y-4 max-w-sm">
                                    <div>
                                        <label htmlFor="stl-status" className="block text-sm font-semibold text-slate-800 mb-1">Status</label>
                                        <select id="stl-status" value={stlStatus} onChange={(e) => setStlStatus(e.target.value)} className="w-full p-2.5 border rounded-lg text-sm bg-white">
                                            {LICENCE_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label htmlFor="stl-number" className="block text-sm font-semibold text-slate-800 mb-1">Licence number</label>
                                        <input id="stl-number" type="text" value={stlNumber} onChange={(e) => setStlNumber(e.target.value)} onBlur={() => setStlNumber(stlNumber.trim().toUpperCase())}
                                            placeholder="ABC12345" maxLength={20} className="w-full p-2.5 border rounded-lg text-sm" />
                                    </div>
                                    <div>
                                        <label htmlFor="stl-expiry" className="block text-sm font-semibold text-slate-800 mb-1">Expires</label>
                                        <input id="stl-expiry" type="date" value={stlExpiry} onChange={(e) => setStlExpiry(e.target.value)} className="w-full p-2.5 border rounded-lg text-sm bg-white" />
                                    </div>
                                </div>
                                {licenceNote && <p className="mt-4 text-sm text-amber-700">{licenceNote}</p>}
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

                        {!OWN_SAVE_SECTIONS.includes(activeSection) && (
                            <button type="submit" disabled={submitting || (moderating && moderationReason.trim().length < 3)}
                                aria-label={`Save ${activeTitle}`}
                                className="w-full mt-8 py-3.5 bg-emerald-700 text-white font-bold rounded-xl hover:bg-emerald-800 transition disabled:opacity-60">
                                {submitting ? 'Saving...' : 'Save'}
                            </button>
                        )}
                    </div>
                </div>
            </form>
        </div>
    );
}
