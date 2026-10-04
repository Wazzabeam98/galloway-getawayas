'use client';

import { EyeOff, ShieldAlert } from 'lucide-react';
import { toast } from 'react-toastify';

// The provider's own take-down, in the words each side needs. One control for
// both editors — the experience listing editor and the trade business editor —
// so the two can't drift: the same banner, the same "Take it down" / "Put it
// back up", the same route (/api/services/listing/pause).
//
// `who` is the audience the listing faces: guests book an experience, hosts
// enquire with a trade. `billing` is only for a trade on the £20 plan:
// 'subscription' (a card on file — paused while down) or 'free' (still in the
// free period, which keeps running).

export type PauseWho = 'guests' | 'hosts';
export type PauseBilling = 'subscription' | 'free' | null;

export async function savePaused(providerId: string, paused: boolean): Promise<boolean> {
    const res = await fetch('/api/services/listing/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, paused }),
    });
    const json = await res.json().catch(() => ({ ok: false, error: 'Could not save' }));
    if (!json.ok) { toast.error(json.error || 'Could not save', { theme: 'colored' }); return false; }
    toast.success(paused ? 'Your listing is taken down.' : 'Your listing is back up.', { theme: 'colored' });
    return true;
}

function downLine(who: PauseWho): string {
    return who === 'guests'
        ? 'Guests can’t find or book it. Bookings you’ve already confirmed still stand.'
        : 'Hosts can’t find you or send you new enquiries. Enquiries and jobs you already have carry on.';
}

function billingLine(billing: PauseBilling): string {
    if (billing === 'subscription') return 'Your £20 a month is paused while it’s down and restarts when it goes back up.';
    if (billing === 'free') return 'Your free period keeps running while it’s down.';
    return '';
}

// The strip at the top of the editor, shown only while it's down — so a hidden
// listing is never a silent surprise. When WE took it down, the provider can't
// lift it, so it says so instead of offering a button that wouldn't work.
export function TakenDownBanner({ paused, adminHidden, pausing, onPutBack, who, billing }: {
    paused: boolean; adminHidden: boolean; pausing: boolean; onPutBack: () => void; who: PauseWho; billing?: PauseBilling;
}) {
    if (adminHidden) {
        return (
            <div className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 p-4">
                <div className="flex items-start gap-2.5">
                    <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-700" />
                    <div>
                        <div className="font-semibold text-slate-900">We’ve taken your listing down</div>
                        <p className="text-sm text-slate-600">
                            {downLine(who)} If you think this is a mistake, reply to any email from us and we’ll look at it.
                        </p>
                    </div>
                </div>
            </div>
        );
    }
    if (!paused) return null;
    const extra = billingLine(billing || null);
    return (
        <div className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-2.5">
                    <EyeOff className="mt-0.5 h-5 w-5 text-amber-700" />
                    <div>
                        <div className="font-semibold text-slate-900">Your listing is taken down</div>
                        <p className="text-sm text-slate-600">{downLine(who)}{extra ? ' ' + extra : ''}</p>
                    </div>
                </div>
                <button type="button" onClick={onPutBack} disabled={pausing}
                    className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-60">
                    {pausing ? '…' : 'Put it back up'}
                </button>
            </div>
        </div>
    );
}

// The Listing status section, at the bottom of the editor — the editor doesn't
// push a live provider toward taking their listing down.
export function ListingStatusSection({ paused, adminHidden, pausing, onToggle, who, billing }: {
    paused: boolean; adminHidden: boolean; pausing: boolean; onToggle: () => void; who: PauseWho; billing?: PauseBilling;
}) {
    const liveLine = who === 'guests'
        ? 'Your listing is live and bookable.'
        : 'Your listing is live — hosts can find you and send enquiries.';
    const downShort = who === 'guests'
        ? 'Your listing is taken down — guests can’t find or book it.'
        : 'Your listing is taken down — hosts can’t find you or send new enquiries.';
    const takeDownDetail = who === 'guests'
        ? 'It stops taking new bookings and disappears from the marketplace. Bookings you’ve already confirmed still stand and stay in your diary — putting it back up later is instant, with no re-approval.'
        : 'You stop appearing in the directory and can’t be sent new enquiries. Enquiries and jobs you already have carry on as normal — putting it back up later is instant, with no re-approval.';
    const putBackDetail = who === 'guests'
        ? 'It goes back live immediately — no review. Guests can find and book it again.'
        : 'It goes back live immediately — no review. Hosts can find you and send enquiries again.';
    const extra = billingLine(billing || null);

    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
            <h2 className="text-xl font-bold text-slate-900">Listing status</h2>
            <p className="mt-1 text-sm text-slate-500">
                {adminHidden ? 'We’ve taken your listing down.' : paused ? downShort : liveLine}
            </p>
            {adminHidden ? (
                <div className="mt-4 rounded-xl border border-slate-200 p-4 text-sm text-slate-600">
                    Only we can put it back up. If you think this is a mistake, reply to any email from us and we’ll look at it.
                </div>
            ) : (
                <div className="mt-4 rounded-xl border border-slate-200 p-4">
                    <div className="font-semibold text-slate-900">
                        {paused ? 'Put your listing back up' : 'Take your listing down for a while'}
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                        {paused ? putBackDetail : takeDownDetail}{extra ? ' ' + extra : ''}
                    </p>
                    <button type="button" onClick={onToggle} disabled={pausing}
                        className={`mt-4 rounded-xl px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60 ${paused ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-slate-800 hover:bg-slate-900'}`}>
                        {pausing ? '…' : paused ? 'Put it back up' : 'Take it down'}
                    </button>
                </div>
            )}
        </section>
    );
}
