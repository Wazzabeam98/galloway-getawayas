// One icon per property type (lib/propertyTypes.ts `icon`), in the same style
// as the lucide icons the picker already used: 24px grid, 2px round strokes,
// no fill. The installed lucide (0.279) has no caravan, hut, yurt, dome, pod,
// cabin or tower, so those are drawn here on the same grid; everything lucide
// does have comes from lucide. The original six keep their original icons.
import { Home, Trees, Waves, Compass, Building2, Building, Sparkles, Sailboat, Tent, Castle, Tractor, Warehouse } from 'lucide-react';

type Props = { className?: string };

function Svg({ className, children }: Props & { children: React.ReactNode }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
            {children}
        </svg>
    );
}

const House = (p: Props) => (
    <Svg {...p}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9v12h14V9" /><path d="M16 5.5V3h2v4" /><path d="M10 21v-5h4v5" /></Svg>
);
const Cabin = (p: Props) => (
    <Svg {...p}><path d="M2 21 12 3l10 18" /><path d="M7 12h10" /><path d="M10 21v-4h4v4" /><path d="M2 21h20" /></Svg>
);
const Lodge = (p: Props) => (
    <Svg {...p}><path d="M1 11 12 4l11 7" /><path d="M4 9.5V20h16V9.5" /><rect x="7" y="13" width="4" height="3" /><path d="M14 20v-6h3v6" /></Svg>
);
const StaticCaravan = (p: Props) => (
    <Svg {...p}><rect x="2" y="5" width="20" height="12" rx="2" /><rect x="5" y="8" width="4" height="3" /><rect x="16" y="8" width="3" height="3" /><path d="M11 17V9h3v8" /><circle cx="7" cy="19" r="1.5" /></Svg>
);
const Pod = (p: Props) => (
    <Svg {...p}><path d="M3 20v-8a9 9 0 0 1 18 0v8" /><path d="M2 20h20" /><path d="M10 20v-4a2 2 0 0 1 4 0v4" /></Svg>
);
const ShepherdsHut = (p: Props) => (
    <Svg {...p}><path d="M4 9c0-2 3.6-3.5 8-3.5S20 7 20 9" /><path d="M4 9v7h16V9" /><rect x="13" y="10" width="4" height="3" /><path d="M7 16v-5h3v5" /><circle cx="7" cy="19" r="2" /><circle cx="17" cy="19" r="2" /></Svg>
);
const TinyHome = (p: Props) => (
    <Svg {...p}><path d="M6 11.5 12 6l6 5.5" /><path d="M8 10v9h8v-9" /><path d="M11 19v-3h2v3" /><path d="M3 19h18" /></Svg>
);
const Houseboat = (p: Props) => (
    <Svg {...p}><path d="M2 16h20l-2 4H4z" /><path d="M6 16v-5h10v5" /><path d="M5 11.5 11 7l6 4.5" /><path d="M10 16v-2h2v2" /></Svg>
);
const Campervan = (p: Props) => (
    <Svg {...p}><path d="M3 17V8a2 2 0 0 1 2-2h11l4 5h1a1 1 0 0 1 1 1v5h-2" /><path d="M3 17h2" /><path d="M9 17h6" /><path d="M16 6v5h4" /><rect x="6" y="9" width="6" height="3" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" /></Svg>
);
const Yurt = (p: Props) => (
    <Svg {...p}><path d="M2 12 12 6l10 6" /><path d="M4 12v8h16v-8" /><path d="M10 20v-4h4v4" /><path d="M11 6.5V5h2v1.5" /></Svg>
);
const Dome = (p: Props) => (
    <Svg {...p}><path d="M2 20a10 10 0 0 1 20 0" /><path d="M2 20h20" /><path d="M5.5 13 12 15l6.5-2" /><path d="M12 10v10" /></Svg>
);
const Treehouse = (p: Props) => (
    <Svg {...p}><path d="M12 22v-8" /><path d="M8 22h8" /><path d="M7 10.5 12 6l5 4.5" /><path d="M8.5 9.5V14h7V9.5" /><path d="M6 6a6 4 0 0 1 12 0" /></Svg>
);
const Tower = (p: Props) => (
    <Svg {...p}><path d="M8 21V8" /><path d="M16 21V8" /><path d="M7 8V4h2v2h2V4h2v2h2V4h2v4z" /><path d="M11 21v-3h2v3" /><path d="M12 11v2" /><path d="M5 21h14" /></Svg>
);

const ICONS: Record<string, React.ComponentType<Props>> = {
    cottage: Home,
    farmhouse: Trees,
    coastal: Waves,
    townhouse: Building2,
    luxury: Sparkles,
    // The old 'Cabins & Pods' tile's compass stays for anything still keyed to it.
    compass: Compass,
    house: House,
    flat: Building,
    cabin: Cabin,
    lodge: Lodge,
    static_caravan: StaticCaravan,
    barn: Warehouse,
    pod: Pod,
    shepherds_hut: ShepherdsHut,
    tiny_home: TinyHome,
    boat: Sailboat,
    houseboat: Houseboat,
    campervan: Campervan,
    tent: Tent,
    yurt: Yurt,
    dome: Dome,
    treehouse: Treehouse,
    farm: Tractor,
    castle: Castle,
    tower: Tower,
};

export default function PropertyTypeIcon({ icon, className }: { icon: string; className?: string }) {
    const Icon = ICONS[icon] || Home;
    return <Icon className={className} />;
}
