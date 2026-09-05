'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Home, Sparkles, Wrench, X, ArrowRight } from 'lucide-react';

// The single fork — Airbnb's "What would you like to host?" done our way.
//
// A focused full-screen takeover (fixed inset-0), so the global header —
// "Welcome, Liam", "Switch to hosting" — does not compete with the one
// decision on screen. This is the same shape ProviderSignUp already uses, so
// the fork and the provider wizard read as one flow rather than two patterns.
//
// Interaction is Airbnb's: click a tile to select it, one Next bottom-right,
// greyed until a tile is chosen. No per-tile links.
//
// The tile art is a flat coloured glyph for now — a deliberate stand-in for
// the commissioned illustrations that will carry the platform's look. The
// glyph is the only colour on an otherwise neutral screen.

type Choice = {
    key: string;
    href: string;
    title: string;
    Icon: typeof Home;
    // The 3D illustration that fills the tile's art zone. The glyph (Icon) is
    // the fallback if the image is ever missing.
    art?: string;
};

// One palette across all three — the brand emerald — so the tiles read as a
// set, not three unrelated colours. The glyph stays the only colour on screen.
const CHOICES: Choice[] = [
    { key: 'home', href: '/addhome', title: 'List a home or holiday let', Icon: Home, art: '/illustrations/fork-home.png' },
    { key: 'guest', href: '/services/join?trade=guest', title: 'Host a guest experience', Icon: Sparkles, art: '/illustrations/fork-guest.png' },
    { key: 'service', href: '/services/join', title: 'Offer a service', Icon: Wrench, art: '/illustrations/fork-service.png' },
];

export default function HostFork() {
    const router = useRouter();
    const [selected, setSelected] = useState<string | null>(null);
    const chosen = CHOICES.find((c) => c.key === selected) || null;

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
            {/* Own top bar — brand left, a way out right. No global nav. */}
            <header className="flex h-16 flex-none items-center justify-between border-b border-slate-100 px-5 sm:px-8">
                <Link href="/" className="text-sm font-bold tracking-tight text-slate-900">
                    Galloway Getaways
                </Link>
                <Link
                    href="/"
                    aria-label="Close"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                >
                    <X className="h-5 w-5" />
                </Link>
            </header>

            {/* The one question. */}
            <main className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-10">
                <div className="w-full max-w-4xl">
                    <div className="mx-auto max-w-xl text-center">
                        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
                            What would you like to host?
                        </h1>
                        <p className="mt-3 text-base leading-relaxed text-slate-500">
                            One place to start, whatever you have to offer in Dumfries &amp; Galloway.
                        </p>
                    </div>

                    <div className="mt-12 grid gap-5 sm:grid-cols-3">
                        {CHOICES.map(({ key, title, Icon, art }) => {
                            const isOn = selected === key;
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    aria-pressed={isOn}
                                    onClick={() => setSelected(key)}
                                    className={
                                        'group flex flex-col items-center gap-6 rounded-3xl border-2 bg-white px-6 py-10 text-center transition '
                                        + 'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 '
                                        + (isOn
                                            ? 'border-emerald-600 shadow-md'
                                            : 'border-slate-200 hover:border-slate-300 hover:shadow-md')
                                    }
                                >
                                    {/* The illustration zone — large and dominant, Airbnb-style.
                                        The 3D artwork drops in here: replace the <Icon> with
                                        <img src="/illustrations/fork-<key>.png" alt="" className="h-full w-auto" />.
                                        The fixed height keeps all three cards' art aligned. */}
                                    <span className="flex h-28 items-center justify-center sm:h-36">
                                        {art
                                            ? <img src={art} alt="" className="h-full w-auto object-contain" />
                                            : <Icon className="h-16 w-16 text-emerald-600 sm:h-24 sm:w-24" strokeWidth={1.5} aria-hidden />}
                                    </span>
                                    <span className="text-lg font-semibold text-slate-900">{title}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </main>

            {/* Next — greyed until a tile is chosen. */}
            <footer className="flex flex-none items-center justify-end border-t border-slate-100 px-5 py-4 sm:px-8">
                <button
                    type="button"
                    disabled={!chosen}
                    onClick={() => chosen && router.push(chosen.href)}
                    className={
                        'inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold transition '
                        + (chosen
                            ? 'bg-slate-900 text-white hover:bg-slate-800'
                            : 'cursor-not-allowed bg-slate-200 text-slate-400')
                    }
                >
                    Next
                    <ArrowRight className="h-4 w-4" />
                </button>
            </footer>
        </div>
    );
}
