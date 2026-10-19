'use client';

// "Turn on notifications" — shown only where it means something: a guest who
// has just booked or just sent a message, a host on their dashboard. The
// browser's own permission prompt opens ONLY from the button here, never on
// page load.
//
// Renders nothing when there is nothing to ask: already on, already refused,
// "Not now" pressed before, or a browser that cannot push. On an iPhone in
// Safari (which can only push from a Home Screen app) it explains that step
// instead of offering a button that cannot work.

import { useEffect, useState } from 'react';
import {
    askDismissed,
    dismissAsk,
    enablePush,
    needsHomeScreenFirst,
    permission,
    pushSupported,
} from '@/lib/pushClient';

type Context = 'booking' | 'message' | 'host' | 'settings';

const WHY: Record<Context, string> = {
    booking: 'Get a notification when your host confirms or messages you.',
    message: 'Get a notification when they reply.',
    host: 'Get a notification the moment a booking or message comes in.',
    settings: 'Notifications aren\u2019t on for this device yet.',
};

// `always`: account settings shows the offer even after "Not now" elsewhere.
export default function PushPrompt({ context, className, always }: { context: Context; className?: string; always?: boolean }) {
    const [mode, setMode] = useState<'hidden' | 'ask' | 'ios' | 'done'>('hidden');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (needsHomeScreenFirst()) {
            // Only worth saying if push is set up on the site at all.
            if (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && (always || !askDismissed('ios'))) setMode('ios');
            return;
        }
        if (askDismissed() && !always) return;
        if (pushSupported() && permission() === 'default') setMode('ask');
    }, []);

    if (mode === 'hidden') return null;

    const close = () => { dismissAsk(mode === 'ios' ? 'ios' : 'ask'); setMode('hidden'); };

    const turnOn = async () => {
        setBusy(true);
        const result = await enablePush();
        setBusy(false);
        if (result === 'granted') { setMode('done'); dismissAsk(); return; }
        // Refused or failed: don't keep asking.
        close();
    };

    return (
        <div className={className}>
            <div role="status" className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
                {mode === 'done' ? (
                    <p className="text-slate-700">Notifications are on for this device.</p>
                ) : mode === 'ios' ? (
                    <>
                        <p className="font-semibold text-slate-900">Get notifications on your iPhone</p>
                        <p className="mt-0.5 text-slate-600">
                            Add Galloway Getaways to your Home Screen first: tap the Share button, then
                            &lsquo;Add to Home Screen&rsquo;. Open it from there and you can turn notifications on.
                        </p>
                        <button type="button" onClick={close} className="mt-3 font-semibold text-slate-900 underline underline-offset-2">
                            Got it
                        </button>
                    </>
                ) : (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <p className="font-semibold text-slate-900">Turn on notifications?</p>
                            <p className="mt-0.5 text-slate-600">{WHY[context]}</p>
                        </div>
                        <div className="flex flex-none items-center gap-4">
                            <button type="button" onClick={close} className="font-semibold text-slate-700 underline underline-offset-2">
                                Not now
                            </button>
                            <button
                                type="button"
                                onClick={turnOn}
                                disabled={busy}
                                className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                            >
                                Turn on
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
