'use client';

// "Turn on notifications?" — offered where it means something: a guest who has
// just booked or sent a message, a host on their dashboard, and always in
// Account settings. The installed app also asks on first open (FirstRunPush).
// The iPhone's permission question opens ONLY from the "Turn on" button.
//
// "Not now" holds for a week (lib/pushClient askDismissed); after that a
// booking or a message may ask again. Account settings shows it regardless.
//
// iPhone Safari can't push — only the Home Screen app can — so outside Account
// settings this shows nothing there (the one-time Add to Home Screen hint does
// that job). In Account settings it says how, with Safari's icons.

import { useEffect, useState } from 'react';
import { askDismissed, dismissAsk, enablePush, needsHomeScreenFirst, permission, pushSupported } from '@/lib/pushClient';
import AddToHomeScreenSteps from './AddToHomeScreenSteps';

type Context = 'booking' | 'message' | 'host' | 'settings';

const WHY: Record<Context, string> = {
    booking: 'Get a notification when your host confirms or messages you.',
    message: 'Get a notification when they reply.',
    host: 'Get a notification the moment a booking or message comes in.',
    settings: 'Notifications aren’t on for this device yet.',
};

// `always`: Account settings shows the offer even after "Not now" elsewhere.
export default function PushPrompt({ context, className, always }: { context: Context; className?: string; always?: boolean }) {
    const [mode, setMode] = useState<'hidden' | 'ask' | 'ios' | 'done'>('hidden');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (needsHomeScreenFirst()) {
            if (always && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) setMode('ios');
            return;
        }
        if (!always && askDismissed()) return;
        if (pushSupported() && permission() === 'default') setMode('ask');
    }, [always]);

    if (mode === 'hidden') return null;

    const notNow = () => { dismissAsk(); setMode('hidden'); };

    const turnOn = async () => {
        setBusy(true);
        const result = await enablePush();
        setBusy(false);
        if (result === 'granted') { setMode('done'); return; }
        // Refused at the iPhone's own question: that's their answer, and the
        // browser won't ask again anyway.
        setMode('hidden');
    };

    return (
        <div className={className}>
            <div role="status" className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
                {mode === 'done' ? (
                    <p className="text-slate-700">Notifications are on for this device.</p>
                ) : mode === 'ios' ? (
                    <>
                        <p className="font-semibold text-slate-900">Get notifications on your iPhone</p>
                        <p className="mt-0.5 mb-2 text-slate-600">Add Galloway Getaways to your Home Screen, then open it from there and turn notifications on.</p>
                        <AddToHomeScreenSteps />
                    </>
                ) : (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <p className="font-semibold text-slate-900">Turn on notifications?</p>
                            <p className="mt-0.5 text-slate-600">{WHY[context]}</p>
                        </div>
                        <div className="flex flex-none items-center gap-4">
                            {!always && (
                                <button type="button" onClick={notNow} className="font-semibold text-slate-700 underline underline-offset-2">
                                    Not now
                                </button>
                            )}
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
