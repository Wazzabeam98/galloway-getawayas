'use client';

// The installed app's first question, the way Airbnb's app asks it: the first
// time Galloway Getaways is opened from the Home Screen, a card asks to turn on
// notifications, straight away. Not signed in yet? It waits and appears the
// moment they sign in. "Turn on" opens the iPhone's own permission question;
// "Not now" puts it off — a booking or a message may ask again, but never
// within a week (lib/pushClient). Asked once per device; an answer either way
// settles it.
//
// Only in the installed app (never in a browser tab), only where push works,
// only while the iPhone hasn't been asked yet.

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { Bell } from 'lucide-react';
import {
    askDismissed,
    dismissAsk,
    enablePush,
    firstRunDone,
    isStandalone,
    markFirstRunDone,
    permission,
    pushSupported,
    shouldAskOnFirstRun,
} from '@/lib/pushClient';

export default function FirstRunPush() {
    const pathname = usePathname() || '/';
    const [signedIn, setSignedIn] = useState(false);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);

    // Follow the sign-in, so the card can appear the moment someone signs in.
    useEffect(() => {
        if (!isStandalone()) return;
        const supabase = createClientComponentClient();
        supabase.auth.getSession().then(({ data }) => setSignedIn(!!(data && data.session)));
        const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(!!session));
        return () => sub.subscription.unsubscribe();
    }, []);

    useEffect(() => {
        if (open) return;
        if (shouldAskOnFirstRun({
            standalone: isStandalone(),
            supported: pushSupported(),
            permission: String(permission()),
            signedIn,
            firstRunDone: firstRunDone(),
            snoozed: askDismissed(),
            path: pathname,
        })) setOpen(true);
    }, [signedIn, pathname, open]);

    if (!open) return null;

    const notNow = () => { dismissAsk(); markFirstRunDone(); setOpen(false); };
    const turnOn = async () => {
        setBusy(true);
        await enablePush();
        setBusy(false);
        markFirstRunDone();
        setOpen(false);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="first-run-push-title">
            <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                    <Bell className="h-6 w-6" />
                </div>
                <h2 id="first-run-push-title" className="text-lg font-semibold text-slate-900">Turn on notifications</h2>
                <p className="mt-1 text-sm text-slate-600">
                    Hear straight away about bookings, messages and changes to your trips.
                </p>
                <button
                    type="button"
                    onClick={turnOn}
                    disabled={busy}
                    className="mt-5 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                    Turn on
                </button>
                <button type="button" onClick={notNow} disabled={busy} className="mt-3 w-full py-2 text-sm font-semibold text-slate-700 underline underline-offset-2">
                    Not now
                </button>
            </div>
        </div>
    );
}
