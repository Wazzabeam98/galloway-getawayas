'use client';

import { useEffect, useRef, useState } from 'react';
import { Navigation, MapPin, Grid3x3 } from 'lucide-react';

// "Get directions" used to jump straight to Google Maps. It now opens a small
// picker: Apple Maps, Google Maps, and what3words — the three words live in
// here rather than on their own row of the card.
//
// Every option is a plain https link to the provider's own universal URL. We do
// NOT sniff for installed apps: on a phone the OS opens the app when it's there
// and the browser when it isn't; on desktop it opens a tab. Letting the OS
// decide is the whole point — a scheme like comgooglemaps:// would fail silently
// when the app is absent, which a universal https link never does.
//
// The map options carry the same "never the town centre" guarantee as before:
// their URLs are built by lib/directions, which returns null (and so no option)
// unless it can place the guest at a pin or a street address.
export default function DirectionsPicker({
    apple,
    google,
    what3words,
    compact = false,
}: {
    apple?: string | null;
    google?: string | null;
    what3words?: string | null;
    // The trips card sits its buttons a little smaller and in slate; the home
    // card uses stone. Same picker, same behaviour — just the two house styles.
    compact?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    // The words for the what3words link have no leading slashes.
    const w3wUrl = what3words ? 'https://what3words.com/' + what3words.replace(/^\/+/, '') : null;

    const btn = compact
        ? 'flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800'
        : 'flex w-full items-center justify-center gap-2 rounded-lg bg-stone-900 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-800';
    const item = 'flex w-full items-center gap-2.5 px-3 text-left text-sm font-medium text-stone-700 transition hover:bg-stone-50 '
        + (compact ? 'py-2' : 'py-2.5');

    // Nothing to offer — no pin, no street, no words — so no button at all.
    if (!apple && !google && !w3wUrl) return null;

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={open}
                className={btn}
            >
                <Navigation className="h-4 w-4" /> Get directions
            </button>
            {open && (
                <div
                    role="menu"
                    // Grows to fit the three words (which can be wider than the
                    // half-width button) but never narrower than the button, and
                    // capped so it can't run off a narrow card.
                    className="absolute left-0 top-full z-20 mt-1.5 w-max min-w-full max-w-[16rem] overflow-hidden rounded-lg border border-stone-200 bg-white shadow-lg"
                >
                    {apple && (
                        <a role="menuitem" href={apple} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className={item}>
                            <MapPin className="h-4 w-4 flex-none text-stone-400" /> Apple Maps
                        </a>
                    )}
                    {google && (
                        <a role="menuitem" href={google} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className={item}>
                            <MapPin className="h-4 w-4 flex-none text-stone-400" /> Google Maps
                        </a>
                    )}
                    {w3wUrl && (
                        <a role="menuitem" href={w3wUrl} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className={item}>
                            <Grid3x3 className="h-4 w-4 flex-none text-emerald-700" />
                            <span className="min-w-0">
                                <span className="block truncate text-emerald-700">{what3words}</span>
                                <span className="block text-xs text-stone-400">Open in what3words</span>
                            </span>
                        </a>
                    )}
                </div>
            )}
        </div>
    );
}
