import {
    Wifi, Car, PawPrint, Waves, Flame, Tv, Thermometer, Plug, Laptop,
    Baby, Umbrella, Dumbbell, Armchair, Shirt, Droplet, Utensils,
    Bath, Trees, Snowflake, Coffee, Wind,
    ShieldCheck, Sofa, Check, type LucideIcon,
} from 'lucide-react';

// One icon per amenity, so "What this place offers" reads the way Airbnb's
// does — a line icon beside each thing rather than a wall of grey pills. The
// match is on the exact strings the wizard writes (see AmenityList's
// DECIDES_ON and app/addhome). Anything unmapped falls back to a tick, which
// is honest — it still says "yes, this place has it" — rather than guessing an
// icon that might mislead.
const ICONS: Record<string, LucideIcon> = {
    'Wifi': Wifi,
    'Free parking on premises': Car,
    'Parking': Car,
    'Pets allowed': PawPrint,
    'Pool': Waves,
    'Waterfront': Waves,
    'Beach access': Umbrella,
    'Hot tub': Bath,
    'Indoor fireplace': Flame,
    'Fireplace': Flame,
    'Heating': Thermometer,
    'Hot water': Droplet,
    'EV charger': Plug,
    'Dedicated workspace': Laptop,
    'TV': Tv,
    'Cot': Baby,
    'Gym': Dumbbell,
    'Outdoor furniture': Armchair,
    'Hangers': Shirt,
    'Kitchen': Utensils,
    'Cooking basics': Utensils,
    'Washing machine': Shirt,
    'Dryer': Wind,
    'Air conditioning': Snowflake,
    'Coffee maker': Coffee,
    'Garden': Trees,
    'Smoke alarm': ShieldCheck,
    'Carbon monoxide alarm': ShieldCheck,
    'Sofa': Sofa,
};

export function amenityIcon(name: string): LucideIcon {
    return ICONS[name] || Check;
}
