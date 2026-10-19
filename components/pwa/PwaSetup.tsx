'use client';

// The installable-app plumbing, mounted once in the root layout.
//
// 1. Registers the service worker (public/sw.js) — production only, so a dev
//    server's ever-changing chunks are never cached.
// 2. Holds back Chrome's own "Install app" banner, so the site looks and
//    behaves in a browser exactly as it did; the hint below replaces it.
// 3. On a device that already said yes to notifications, makes sure the
//    server has this device against whoever is signed in now — once a visit.
// 4. Phones only, once, dismissible: a small "Add to Home Screen" hint. Never
//    on a page where it would get in the way of paying or signing in, and
//    never inside the Home Screen app itself.

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import { isIOSDevice, isPhone, isStandalone, syncPush } from '@/lib/pushClient';

const HINT_KEY = 'gg-a2hs-hint-seen';
const QUIET_PATHS = ['/booking-confirmed', '/auth', '/homes/', '/account', '/addhome', '/edit-listing'];

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

    useEffect(() => {
        if (!isPhone() || isStandalone()) return;
        if (QUIET_PATHS.some((p) => pathname.startsWith(p))) return;
        try {
            if (localStorage.getItem(HINT_KEY) === '1') return;
        } catch {
            return; // can't remember it, so don't risk showing it every time
        }
        const t = setTimeout(() => {
            // "Once" means once: shown on this visit, never again.
            try { localStorage.setItem(HINT_KEY, '1'); } catch { return; }
            setHint(true);
        }, 4000);
        return () => clearTimeout(t);
    }, [pathname]);

    if (!hint) return null;

    const ios = isIOSDevice();
    const install = async () => {
        try { await installEvent.prompt(); } catch { /* ignored */ }
        setHint(false);
    };

    return (
        <div className="fixed inset-x-4 bottom-4 z-40 rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-[0_6px_16px_rgba(0,0,0,0.12)]" role="dialog" aria-label="Add to Home Screen">
            <button type="button" onClick={() => setHint(false)} aria-label="Close" className="absolute right-3 top-3 text-slate-500 hover:text-slate-900">
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
            ) : (
                <p className="mt-0.5 pr-6 text-slate-600">
                    {ios
                        ? <>Tap the Share button, then &lsquo;Add to Home Screen&rsquo;.</>
                        : <>Open your browser&rsquo;s menu, then &lsquo;Add to Home screen&rsquo;.</>}
                </p>
            )}
        </div>
    );
}
