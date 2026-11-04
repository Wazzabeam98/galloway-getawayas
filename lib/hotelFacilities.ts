// The checklists the hotel wizard asks, with icons — Liam's walkthrough.
//
// HOTEL FACILITIES reuse the full holiday-let amenity list with its exact icons
// (copied from app/addhome's AMENITY_CATEGORIES so the names and lucide icons
// match one-for-one), grouped, plus the hotel-only extras a holiday let has no
// field for (lift, 24-hour reception, luggage storage, restaurant, bar, parking,
// services) grouped the way Booking.com groups them.
//
// ROOM FACILITIES are the Booking.com per-room checklists: bed types (with
// counts), bathroom, view, smoking, accessibility, and in-room amenities. These
// render in the room editor; in-room amenities reuse the same AmenityGrid as the
// hotel facilities step.
//
// The shape { category, items: [{ name, icon, note? }] } is exactly what
// components/listing-editor/AmenitiesCard AmenityGrid takes, so both the hotel
// facilities step and the room in-room-amenities step render through it.

import {
    // Holiday-let icons (same as app/addhome), so the shared amenities look
    // identical to the cottage wizard.
    Snowflake, Package, Refrigerator, Thermometer, Droplet, UtensilsCrossed, Tv,
    Wind, RotateCw, Wifi, Coffee, Shirt, Zap, ThermometerSnowflake, Baby,
    Briefcase, Car, Dumbbell, Bath, Flame, Armchair, ShowerHead, Waves,
    ThermometerSun, Umbrella, Anchor, Accessibility as AccessibilityIcon,
    // Hotel-extra icons.
    ArrowUpDown, Clock, Luggage, Wine, BellRing, Sparkles, Bus, PawPrint,
    Flower2, Trees, Sun, Users, CigaretteOff, Croissant, Lock, Monitor,
} from 'lucide-react';
import { ACCESSIBILITY_AMENITIES } from '@/lib/listingFilters';

export type FacilityItem = { name: string; icon: any; note?: string };
export type FacilityCategory = { category: string; items: FacilityItem[] };

// ---------------------------------------------------------------- hotel facilities

// The holiday-let list, copied so the shared amenities carry the same icons as
// /addhome (there is no shared export to import — AMENITY_CATEGORIES is a local
// const in addhome and edit-listing).
const SHARED_AMENITIES: FacilityCategory[] = [
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
        category: 'Accessibility',
        items: ACCESSIBILITY_AMENITIES.map((name) => ({ name, icon: AccessibilityIcon })),
    },
];

// The hotel-only groups, grouped as Booking.com groups them. Parking and the
// restaurant carry extra sub-fields (cost, hours) collected separately on the
// facilities step; the checklist entries here are the on/off part.
const HOTEL_EXTRAS: FacilityCategory[] = [
    {
        category: 'General',
        items: [
            { name: 'Lift', icon: ArrowUpDown },
            { name: 'Family rooms', icon: Users },
            { name: 'Non-smoking rooms', icon: CigaretteOff },
            { name: 'Garden', icon: Trees },
            { name: 'Terrace', icon: Sun },
            { name: 'Pets allowed', icon: PawPrint },
        ],
    },
    {
        category: 'Reception services',
        items: [
            { name: '24-hour front desk', icon: Clock },
            { name: 'Luggage storage', icon: Luggage },
            { name: 'Express check-in/out', icon: Zap },
            { name: 'Concierge', icon: BellRing },
        ],
    },
    {
        category: 'Food & drink',
        items: [
            { name: 'Restaurant', icon: UtensilsCrossed, note: 'Set the opening hours below' },
            { name: 'Bar', icon: Wine },
            { name: 'Breakfast available', icon: Croissant },
            { name: 'Room service', icon: BellRing },
        ],
    },
    {
        category: 'Services',
        items: [
            { name: 'Daily housekeeping', icon: Sparkles },
            { name: 'Airport shuttle', icon: Bus },
            { name: 'Business centre', icon: Monitor },
            { name: 'Safe at reception', icon: Lock },
        ],
    },
    {
        category: 'Wellness',
        items: [
            { name: 'Spa', icon: Flower2 },
            { name: 'Swimming pool', icon: Waves },
            { name: 'Fitness centre', icon: Dumbbell },
        ],
    },
];

// What the hotel facilities step renders: the shared holiday-let amenities with
// their icons, then the hotel-only groups.
export const HOTEL_FACILITY_CATEGORIES: FacilityCategory[] = [...SHARED_AMENITIES, ...HOTEL_EXTRAS];

export const PARKING_OPTIONS: { value: string; label: string }[] = [
    { value: 'none', label: 'No parking' },
    { value: 'private', label: 'Private parking' },
    { value: 'public', label: 'Public parking nearby' },
    { value: 'street', label: 'Street parking' },
];

// ---------------------------------------------------------------- room facilities

export const BATHROOM_TYPES: { value: string; label: string }[] = [
    { value: 'private', label: 'Private (ensuite)' },
    { value: 'shared', label: 'Shared' },
];

export const BATHROOM_FEATURES: string[] = [
    'Bath', 'Shower', 'Toilet', 'Bidet', 'Free toiletries', 'Hairdryer', 'Bathrobe', 'Slippers',
];

export const ROOM_VIEWS: string[] = [
    'Sea view', 'City view', 'Garden view', 'Pool view', 'Mountain view',
    'Landmark view', 'Courtyard view', 'Quiet-street view',
];

export const SMOKING_OPTIONS: { value: string; label: string }[] = [
    { value: 'non_smoking', label: 'Non-smoking' },
    { value: 'smoking', label: 'Smoking' },
    { value: 'both', label: 'Smoking & non-smoking' },
];

export const ROOM_ACCESSIBILITY: string[] = [
    'Entire unit wheelchair accessible', 'Ground floor', 'Upper floors by lift',
    'Roll-in shower', 'Walk-in shower', 'Toilet with grab rails', 'Raised toilet',
    'Lowered sink', 'Shower chair',
];

// In-room amenities, grouped with icons, rendered through the same AmenityGrid as
// the hotel facilities step. Booking.com's common in-room set.
export const IN_ROOM_AMENITY_CATEGORIES: FacilityCategory[] = [
    {
        category: 'Comfort',
        items: [
            { name: 'Air conditioning', icon: Snowflake },
            { name: 'Heating', icon: Thermometer },
            { name: 'Soundproofing', icon: Package },
            { name: 'Wardrobe', icon: Shirt },
        ],
    },
    {
        category: 'Tea & coffee',
        items: [
            { name: 'Tea/coffee maker', icon: Coffee },
            { name: 'Kettle', icon: Coffee },
            { name: 'Minibar', icon: Refrigerator },
            { name: 'Fridge', icon: Refrigerator },
        ],
    },
    {
        category: 'Entertainment & tech',
        items: [
            { name: 'Flat-screen TV', icon: Tv },
            { name: 'Free WiFi', icon: Wifi },
            { name: 'Telephone', icon: BellRing },
        ],
    },
    {
        category: 'Comfort & work',
        items: [
            { name: 'Desk', icon: Briefcase },
            { name: 'Safe', icon: Lock },
            { name: 'Iron', icon: Zap },
            { name: 'Hairdryer', icon: Wind },
        ],
    },
];
