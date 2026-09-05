import Link from 'next/link';
import { Home, ChefHat, Wrench, ArrowRight } from 'lucide-react';

export const metadata = {
    // The root layout appends ' | Galloway Getaways' to every page title.
    title: 'Start hosting',
    description:
        'List a cottage, host a guest experience, or offer a trade — the one place to start, '
        + 'for everyone with something to offer in Dumfries & Galloway.',
    alternates: { canonical: '/business' },
};

// The single fork — one page, three tiles — replacing the old two-card
// "Set up a business". It mirrors Airbnb's "What would you like to host?":
// every "become a host / list your property / set up a business" link on the
// site now lands here and branches from one decision. The tiles are a front
// door; the flows behind them are unchanged.
//
//   • cottage      → /addhome (its own 9-step wizard)
//   • guest exp.   → /services/join?trade=guest
//   • trade        → /services/join
//
// PLACEHOLDER ART: the illustrations are marked placeholders so the layout can
// be judged now; real artwork replaces <TileArt> later. Do not ship these to
// production as final.

type Fork = {
    href: string;
    title: string;
    blurb: string;
    Icon: typeof Home;
    art: string; // emoji stand-in, clearly a placeholder
};

const FORKS: Fork[] = [
    {
        href: '/addhome',
        title: 'List a cottage',
        blurb: 'A place for guests to stay.',
        Icon: Home,
        art: '🏡',
    },
    {
        href: '/services/join?trade=guest',
        title: 'Host a guest experience',
        blurb: 'Cook, bake, pour or host — anything a guest would book for their stay.',
        Icon: ChefHat,
        art: '🧑‍🍳',
    },
    {
        href: '/services/join',
        title: 'Offer a trade',
        blurb: 'Get work from the holiday lets nearby.',
        Icon: Wrench,
        art: '🔧',
    },
];

// A deliberately unfinished illustration: dashed frame, oversized emoji, and a
// "Placeholder" tag so nobody mistakes it for the real thing.
function TileArt({ art, Icon }: { art: string; Icon: typeof Home }) {
    return (
        <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-2xl border border-dashed border-emerald-300/70 bg-emerald-50/60">
            <span aria-hidden className="text-5xl leading-none opacity-90">{art}</span>
            <Icon aria-hidden className="absolute bottom-3 right-3 h-5 w-5 text-emerald-600/50" strokeWidth={1.75} />
            <span className="absolute left-2 top-2 rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-600/20">
                Placeholder
            </span>
        </div>
    );
}

export default function BusinessPage() {
    return (
        <div className="relative isolate overflow-hidden">
            <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-gradient-to-b from-emerald-50 to-transparent"
            />

            <div className="mx-auto max-w-5xl px-4 sm:px-6 py-14 pb-24">
                <div className="max-w-2xl">
                    <span className="inline-flex items-center rounded-full bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700 ring-1 ring-emerald-600/20">
                        Galloway Getaways
                    </span>
                    <h1 className="mt-4 text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900">
                        What would you like to host?
                    </h1>
                    <p className="mt-4 text-lg leading-relaxed text-slate-600">
                        One place to start, whatever you have to offer in Dumfries &amp; Galloway.
                        Pick the one that fits — you keep your own prices and your own customers.
                    </p>
                </div>

                <div className="mt-10 grid items-stretch gap-5 sm:grid-cols-3">
                    {FORKS.map(({ href, title, blurb, Icon, art }) => (
                        <Link
                            key={title}
                            href={href}
                            className="group relative flex flex-col rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                        >
                            <TileArt art={art} Icon={Icon} />
                            <h2 className="mt-5 text-xl font-bold text-slate-900">{title}</h2>
                            <p className="mt-2 text-sm leading-relaxed text-slate-600">{blurb}</p>
                            <span className="mt-auto pt-5 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 transition group-hover:text-emerald-800">
                                Start hosting
                                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                            </span>
                        </Link>
                    ))}
                </div>

                {/* Liam's reassurance from the old page, kept but moved out of the
                    tiles: signing up is not going live. */}
                <p className="mt-8 max-w-2xl text-sm text-slate-500">
                    Experiences and trades are reviewed and set up for payment before guests can
                    book — signing up isn&rsquo;t going live.
                </p>
            </div>
        </div>
    );
}
