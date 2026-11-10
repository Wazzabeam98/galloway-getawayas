// The checklists the hotel wizard asks, with icons — Liam's walkthroughs.
//
// TWO LISTS, NO OVERLAP. A guest answers in-room things once, in the room editor
// (IN_ROOM_AMENITY_CATEGORIES). The hotel facilities step is therefore HOTEL-WIDE
// only — reception, lift, restaurant, bar, pool, parking and so on — and shares
// no item with the in-room list, so nothing is asked twice. The holiday-let
// amenities that ARE property-wide (pool, sauna, hot tub, gym, EV charging,
// garden, beach/waterfront, step-free access) keep their exact lucide icons;
// the per-room ones (wifi, TV, heating, kettle, iron…) live only in the room
// editor.
//
// The shape { category, items:[{ name, icon, note? }] } is what
// components/listing-editor/AmenitiesCard AmenityGrid takes.

import {
    Snowflake, Thermometer, Tv, Wifi, Coffee, Shirt, Zap, Refrigerator, Package,
    Briefcase, Dumbbell, Bath, Waves, ThermometerSun, Umbrella, Anchor,
    Accessibility as AccessibilityIcon, UtensilsCrossed as UtensilsIcon,
    ArrowUpDown, Clock, Luggage, Wine, BellRing, Sparkles, Bus, PawPrint,
    Flower2, Trees, Sun, Users, CigaretteOff, Croissant, Lock, Monitor, Car,
} from 'lucide-react';
import { ACCESSIBILITY_AMENITIES } from '@/lib/listingFilters';

export type FacilityItem = { name: string; icon: any; note?: string };
export type FacilityCategory = { category: string; items: FacilityItem[] };

// ---------------------------------------------------------------- hotel facilities
// HOTEL-WIDE ONLY. Nothing here appears in IN_ROOM_AMENITY_CATEGORIES below.
export const HOTEL_FACILITY_CATEGORIES: FacilityCategory[] = [
    {
        category: 'General',
        items: [
            { name: 'Lift', icon: ArrowUpDown },
            { name: 'Family rooms', icon: Users },
            { name: 'Non-smoking rooms', icon: CigaretteOff },
            { name: 'Garden', icon: Trees },
            { name: 'Terrace', icon: Sun },
            // Pets are asked once, in the house-rules step (HouseRulesCard).
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
            { name: 'Restaurant', icon: UtensilsIcon, note: 'Set the opening hours below' },
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
            { name: 'Laundry service', icon: Shirt },
        ],
    },
    {
        category: 'Wellness & leisure',
        items: [
            { name: 'Swimming pool', icon: Waves },
            { name: 'Spa', icon: Flower2 },
            { name: 'Fitness centre', icon: Dumbbell },
            { name: 'Sauna', icon: ThermometerSun },
            { name: 'Hot tub', icon: Bath },
        ],
    },
    {
        category: 'Outdoors & parking',
        items: [
            { name: 'Beach access', icon: Umbrella },
            { name: 'Waterfront', icon: Anchor },
            { name: 'EV charging', icon: Car },
        ],
    },
    {
        category: 'Accessibility',
        items: ACCESSIBILITY_AMENITIES.map((name: string) => ({ name, icon: AccessibilityIcon })),
    },
];

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

// In-room amenities — PER ROOM. No item here appears in the hotel-wide list above.
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
            { name: 'Hairdryer', icon: Thermometer },
        ],
    },
];
