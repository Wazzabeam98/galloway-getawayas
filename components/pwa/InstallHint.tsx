'use client';

// "Add Galloway Getaways to your Home Screen" — the way Airbnb's site suggests
// its app: to signed-in people only, AFTER the page's own content (it sits
// between the page and the footer, in the flow), so it never covers an
// invitation, a booking or anything else they came to act on.
//
// Phones only. Never inside the installed app, never in an app's built-in
// browser (Instagram, Facebook…) where it can't be done, never on a page about
// paying, signing in or editing. Once per device: remembered the moment it
// appears, in the page's own note and in a cookie the server sets for a year
// (Safari wipes page storage after a week without a visit — /api/pwa/seen).

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { X } from 'lucide-react';
import { isIOSSafari, isPhone, isStandalone } from '@/lib/pushClient';
import AddToHomeScreenSteps from './AddToHomeScreenSteps';

const HINT_KEY = 'gg-a2hs-hint-seen';
const HINT_COOKIE = 'gg_a2hs_seen';
const INSTALL_EVENT = 'gg:install-available';
export const QUIET_PATHS = ['/booking-confirmed', '/auth', '/homes/', '/account', '/addhome', '/edit-listing', '/payouts', '/invite', '/trip-invite'];

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

export default function InstallHint() {
    const pathname = usePathname() || '/';
    const [show, setShow] = useState(false);
    const [installEvent, setInstallEvent] = useState<any>(null);

    useEffect(() => {
        const pick = () => setInstallEvent((window as any).__ggInstallEvent || null);
        pick();
        window.addEventListener(INSTALL_EVENT, pick);
        return () => window.removeEventListener(INSTALL_EVENT, pick);
    }, []);

    useEffect(() => {
        if (show || !isPhone() || isStandalone()) return;
        const ios = /\b(iPhone|iPod)\b/.test(navigator.userAgent || '');
        if (ios && !isIOSSafari()) return;
        if (QUIET_PATHS.some((p) => pathname.startsWith(p))) return;
        if (hintSeen()) return;
        let live = true;
        // Signed-in people only.
        createClientComponentClient().auth.getSession().then(({ data }) => {
            if (!live || !data || !data.session || hintSeen()) return;
            rememberHint();
            setShow(true);
        });
        return () => { live = false; };
    }, [pathname, show]);

    if (!show) return null;

    const ios = isIOSSafari();
    const close = () => setShow(false);
    const install = async () => {
        try { await installEvent.prompt(); } catch { /* ignored */ }
        setShow(false);
    };

    return (
        <section aria-label="Add to Home Screen" className="mx-auto w-full max-w-7xl px-4 pb-8 pt-2 sm:px-6">
            <div className="relative rounded-2xl border border-slate-200 bg-white p-4 text-sm">
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
        </section>
    );
}
