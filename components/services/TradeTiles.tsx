import Link from 'next/link';
import {
    Sparkles, Wrench, Trees, Droplet, ChefHat, Cake, ShoppingBasket,
    PawPrint, Trash2, Zap, Hammer, Home, Paintbrush, ShowerHead,
} from 'lucide-react';

// One tile, used by both places that offer a trade.
//
// WHY THIS IS SHARED RATHER THAN COPIED
//
// The sign-up's trade picker and the host-facing shop are the same idea seen
// from two ends — here are the trades, pick one — and they were built weeks
// apart, so they had drifted before anybody looked at them side by side. The
// sign-up had icons in a three-across grid; the shop had plain text cards and
// looked inert next to it.
//
// Two implementations of the same tile is a promise to keep them in step by
// remembering to, which is not a promise anybody keeps. So the geometry, the
// icons and the hover state live here once.
//
// THE ONE THING THAT LEGITIMATELY DIFFERS
//
// The shop navigates and the sign-up sets state, so one wants a link and the
// other a button. That is a real difference — a <button> that routes loses
// middle-click, cmd-click and "copy link address", and a <Link> cannot hold a
// step's state. Passing `href` renders a link and `onClick` renders a button;
// everything visual is identical either way.

export const TRADE_ICONS: Record<string, any> = {
    sponge: Sparkles,
    spanner: Wrench,
    trees: Trees,
    droplet: Droplet,
    chef: ChefHat,
    cake: Cake,
    basket: ShoppingBasket,
    paw: PawPrint,
    bin: Trash2,
    electrician: Zap,
    joiner: Hammer,
    // NOT Droplet, which is window cleaning's.
    //
    // They never met while these lived in the sign-up: the maintenance trades
    // sit behind a group there, so a plumber and a window cleaner were never
    // on screen together. The shop puts all seven in one flat grid, and two
    // identical icons two tiles apart is the kind of thing that reads as a
    // rendering fault.
    plumber: ShowerHead,
    roofer: Home,
    painter: Paintbrush,
    handyman: Wrench,
};

export const GROUP_ICONS: Record<string, any> = {
    maintenance: Wrench,
};

// Two across on a phone, three on anything wider. Held here so a change to the
// shop's density is a change to the sign-up's as well, which is the point.
export function TradeTileGrid({ children }: { children: any }) {
    return <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{children}</div>;
}

interface TileProps {
    // Either an icon component, or a trade/group key to look one up by.
    icon?: any;
    tradeKey?: string;
    groupKey?: string;

    label: string;
    hint?: string;

    // A link, or a button. Exactly one.
    href?: string;
    onClick?: () => void;
}

const SHELL =
    'rounded-2xl border border-slate-300 p-4 text-left transition '
    + 'hover:border-emerald-700 hover:bg-emerald-50/40 '
    + 'focus:outline-none focus:ring-2 focus:ring-emerald-700';

export function TradeTile({ icon, tradeKey, groupKey, label, hint, href, onClick }: TileProps) {
    const Icon = icon
        || (groupKey ? GROUP_ICONS[groupKey] : null)
        || (tradeKey ? TRADE_ICONS[tradeKey] : null)
        || Sparkles;

    const inner = (
        <>
            <Icon className="w-7 h-7 text-emerald-700 mb-3" strokeWidth={1.5} />
            <span className="block font-semibold text-slate-900">{label}</span>
            {hint && <span className="block text-xs text-slate-500 mt-1">{hint}</span>}
        </>
    );

    if (href) {
        return (
            <Link href={href} className={'block ' + SHELL}>
                {inner}
            </Link>
        );
    }

    return (
        <button type="button" onClick={onClick} className={SHELL}>
            {inner}
        </button>
    );
}
