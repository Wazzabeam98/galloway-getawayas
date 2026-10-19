'use client';

// The installable-app plumbing, mounted once in the root layout.
//
// 1. Registers the service worker (public/sw.js) — production only, so a dev
//    server's ever-changing chunks are never cached.
// 2. Holds back Chrome's own "Install app" banner, so the site looks and
//    behaves in a browser exactly as it did; the hint below replaces it.
// 3. On a device that already said yes to notifications, makes sure the
//    server has this device against whoever is signed in now — once a visit.
// 4. Phones only, ONCE PER DEVICE, dismissible: a small "Add to Home Screen"
//    hint with Safari's Share icon drawn in. Never inside the Home Screen app,
//    never in an app's built-in browser, never on a page where it would get in
//    the way of paying or signing in. Remembered by a server-set cookie as well
//    as the page's own note, because Safari wipes page storage after a week.
// 5. In the installed app: the first-open notifications card (FirstRunPush).

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import { isIOSSafari, isPhone, isStandalone, syncPush } from '@/lib/pushClient';
import AddToHomeScreenSteps from './AddToHomeScreenSteps';
import FirstRunPush from './FirstRunPush';

const HINT_KEY = 'gg-a2hs-hint-seen';
const HINT_COOKIE = 'gg_a2hs_seen';
const QUIET_PATHS = ['/booking-confirmed', '/auth', '/homes/', '/account', '/addhome', '/edit-listing'];

// Seen on this device, by either record: the page's own note, or the cookie the
// server sets (which outlives Safari's seven-day clear-out of page storage).
function hintSeen(): boolean {
    try {
        if (document.cookie.split(/;\s*/).some((c) => c === HINT_COOKIE + '=1')) return true;
        return localStorage.getItem(HINT_KEY) === '1';
    } catch {
        return true; // can't remember it, so don't risk showing it every time
    }
}

function rememberHint(): void {
    try { localStorage.setItem(HINT_KEY, '1'); } catch { /* private mode */ }
    fetch('/api/pwa/seen', { method: 'POST' }).catch(() => { /* the local note still stands */ });
}

export default function PwaSetup() {
    const pathname = usePathname() || '/';
    const [installEvent, setInstallEvent] = useState<any>(null);
    const [hint, setHint] = useState(false);

    useEffect(() => {
        if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* not fatal */ });

        try {
            if (sessionStorage.getItem('gg-push-synced') !== '1') {
                sessionStorage.setItem('gg-push-synced', '1');
                syncPush();
            }
        } catch { /* private mode */ }
    }, []);

    useEffect(() => {
        const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvent(e); };
        window.addEventListener('beforeinstallprompt', onPrompt);
        return () => window.removeEventListener('beforeinstallprompt', onPrompt);
    }, []);

    // The hint: phones only, never inside the installed app, never in an app's
    // own built-in browser (Instagram, Facebook…) where it can't be done, and
    // once per device — remembered the moment it appears, so closing it, or
    // not, both count.
    useEffect(() => {
        if (hint || !isPhone() || isStandalone()) return;
        const ios = /\b(iPhone|iPod)\b/.test(navigator.userAgent || '');
        if (ios && !isIOSSafari()) return;
        if (QUIET_PATHS.some((p) => pathname.startsWith(p))) return;
        if (hintSeen()) return;
        const t = setTimeout(() => {
            if (hintSeen()) return;
            rememberHint();
            setHint(true);
        }, 4000);
        return () => clearTimeout(t);
    }, [pathname, hint]);

    const ios = isIOSSafari();
    const close = () => setHint(false);
    const install = async () => {
        try { await installEvent.prompt(); } catch { /* ignored */ }
        setHint(false);
    };

    return (
        <>
            <FirstRunPush />
            {hint && (
                <div className="fixed inset-x-4 bottom-4 z-40 rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-[0_6px_16px_rgba(0,0,0,0.12)]" role="dialog" aria-label="Add to Home Screen">
                    <button type="button" onClick={close} aria-label="Close" className="absolute right-3 top-3 p-1 text-slate-500 hover:text-slate-900">
                        <X className="h-4 w-4" />
                    </button>
                    <p className="pr-6 font-semibold text-slate-900">Add Galloway Getaways to your Home Screen</p>
                    {installEvent && !ios ? (
                        <div className="mt-2 flex items-center justify-between gap-3">
                            <p className="text-slate-600">Open it like an app, with notifications.</p>
                            <button type="button" onClick={install} className="flex-none rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800">
                                Add
                            </button>
                        </div>
                    ) : ios ? (
                        <div className="mt-2">
                            <p className="mb-2 text-slate-600">Open it like an app, with notifications.</p>
                            <AddToHomeScreenSteps />
                        </div>
                    ) : (
                        <p className="mt-0.5 pr-6 text-slate-600">Open your browser&rsquo;s menu, then &lsquo;Add to Home screen&rsquo;.</p>
                    )}
                    {!(installEvent && !ios) && (
                        <button type="button" onClick={close} className="mt-3 w-full rounded-xl bg-emerald-700 px-4 py-2.5 font-semibold text-white hover:bg-emerald-800">
                            Got it
                        </button>
                    )}
                </div>
            )}
        </>
    );
}
