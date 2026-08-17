'use client';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { toast } from 'react-toastify';
import {
    Banknote,
    ShieldCheck,
    AlertCircle,
    ExternalLink,
    Clock,
    Check,
} from 'lucide-react';

interface Status {
    connected: boolean;
    charges_enabled?: boolean;
    payouts_enabled?: boolean;
    details_submitted?: boolean;
    requirements_due?: string[];
}

export default function PaymentsSection() {
    const supabase = createClientComponentClient();

    const [loading, setLoading] = useState(true);
    const [working, setWorking] = useState(false);
    const [status, setStatus] = useState<Status>({ connected: false });
    const [isHost, setIsHost] = useState(false);

    const load = async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session && session.user) {
                const { count } = await supabase
                    .from('listings')
                    .select('id', { count: 'exact', head: true })
                    .eq('host_id', session.user.id);
                setIsHost((count || 0) > 0);
            }

            const res = await fetch('/api/stripe/connect');
            const data = await res.json();
            if (data && data.ok) {
                setStatus(data);
            }
        } catch (err) {
            // Leave the default "not connected" state showing.
        }
        setLoading(false);
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const go = async (action: 'onboard' | 'dashboard') => {
        setWorking(true);
        try {
            const res = await fetch('/api/stripe/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: action }),
            });
            const data = await res.json();

            if (data && data.ok && data.url) {
                window.location.href = data.url;
                return;
            }
            toast.error((data && data.error) || 'Could not open Stripe. Please try again.', { theme: 'colored' });
        } catch (err) {
            toast.error('Could not reach Stripe. Please try again.', { theme: 'colored' });
        }
        setWorking(false);
    };

    if (loading) {
        return (
            <div className="border rounded-2xl p-10 text-center">
                <p className="text-slate-400 text-sm animate-pulse">Checking your payout account...</p>
            </div>
        );
    }

    const ready = status.connected && status.payouts_enabled;
    const pending = status.connected && !status.payouts_enabled;

    return (
        <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-1">Payments &amp; payouts</h2>
            <p className="text-slate-500 text-sm mb-8">
                How you get paid for your bookings.
            </p>

            {ready ? (
                <div className="border rounded-2xl p-6">
                    <div className="flex items-start gap-4">
                        <div className="w-11 h-11 rounded-full bg-emerald-50 flex items-center justify-center shrink-0">
                            <ShieldCheck className="w-5 h-5 text-emerald-700" />
                        </div>
                        <div className="flex-1">
                            <div className="flex items-center gap-2">
                                <h3 className="font-semibold text-slate-900">You&apos;re set up for payouts</h3>
                                <span className="text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                                    Verified
                                </span>
                            </div>
                            <p className="text-sm text-slate-500 mt-1">
                                Stripe has verified your identity and bank details. Guests&apos; payments are held by
                                Galloway Getaways and your share is released after check-in.
                            </p>

                            <button
                                type="button"
                                onClick={() => go('dashboard')}
                                disabled={working}
                                className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 border border-slate-300 hover:border-slate-500 text-slate-700 text-sm font-semibold rounded-xl transition disabled:opacity-50"
                            >
                                {working ? 'Opening...' : 'Manage payout details'}
                                <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                            <p className="text-xs text-slate-400 mt-2">
                                Opens Stripe, where you can change your bank account or see your payout history.
                            </p>
                        </div>
                    </div>
                </div>
            ) : pending ? (
                <div className="border rounded-2xl p-6">
                    <div className="flex items-start gap-4">
                        <div className="w-11 h-11 rounded-full bg-amber-50 flex items-center justify-center shrink-0">
                            <Clock className="w-5 h-5 text-amber-700" />
                        </div>
                        <div className="flex-1">
                            <h3 className="font-semibold text-slate-900">Nearly there</h3>
                            <p className="text-sm text-slate-500 mt-1">
                                {status.details_submitted
                                    ? 'Stripe is reviewing what you sent. This usually takes a few minutes, occasionally a day.'
                                    : 'You started setting up payouts but didn\u2019t finish. You can\u2019t be paid until it\u2019s complete.'}
                            </p>

                            {status.requirements_due && status.requirements_due.length > 0 && (
                                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                                    <p className="text-xs font-semibold text-amber-900 mb-1">Stripe still needs:</p>
                                    <p className="text-xs text-amber-800">
                                        {status.requirements_due
                                            .map((r) => r.split('.').join(' ').split('_').join(' '))
                                            .join(', ')}
                                    </p>
                                </div>
                            )}

                            <button
                                type="button"
                                onClick={() => go('onboard')}
                                disabled={working}
                                className="mt-4 px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition disabled:opacity-50"
                            >
                                {working ? 'Opening...' : 'Finish setting up payouts'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="border rounded-2xl p-6">
                    <div className="flex items-start gap-4">
                        <div className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                            <Banknote className="w-5 h-5 text-slate-500" />
                        </div>
                        <div className="flex-1">
                            <h3 className="font-semibold text-slate-900">Set up payouts</h3>
                            <p className="text-sm text-slate-500 mt-1">
                                Before you can take bookings you need to tell us where to send your money. Stripe, our
                                payments provider, will ask for your details and bank account.
                            </p>

                            <ul className="mt-4 space-y-2">
                                {[
                                    'Takes about five minutes',
                                    'You\u2019ll need photo ID and your bank details',
                                    'Galloway Getaways never sees your bank details',
                                    'Your 10% service fee is deducted before payout',
                                ].map((line) => (
                                    <li key={line} className="flex items-start gap-2 text-sm text-slate-600">
                                        <Check className="w-4 h-4 text-emerald-700 mt-0.5 shrink-0" />
                                        <span>{line}</span>
                                    </li>
                                ))}
                            </ul>

                            <button
                                type="button"
                                onClick={() => go('onboard')}
                                disabled={working}
                                className="mt-5 px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition disabled:opacity-50"
                            >
                                {working ? 'Opening Stripe...' : 'Set up payouts'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {!isHost && (
                <div className="mt-6 border rounded-2xl p-5 bg-slate-50">
                    <div className="flex gap-3.5">
                        <AlertCircle className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" />
                        <div>
                            <div className="text-sm font-semibold text-slate-900">You don&apos;t have a listing yet</div>
                            <p className="text-sm text-slate-500 mt-0.5">
                                This section only matters for hosts. Guests don&apos;t need a payout account &mdash; you
                                pay by card at the time of booking.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            <div className="mt-8">
                <h3 className="text-sm font-semibold text-slate-900 mb-3">How you get paid</h3>
                <ol className="space-y-3">
                    {[
                        'A guest books and pays through Galloway Getaways.',
                        'We hold the money until the stay begins, so refunds are always covered.',
                        'Your share is released after check-in and paid to your bank by Stripe.',
                        'Our 10% service fee is deducted before the payout, so nothing to invoice.',
                    ].map((line, i) => (
                        <li key={line} className="flex gap-3 text-sm text-slate-600">
                            <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5">
                                {i + 1}
                            </span>
                            <span>{line}</span>
                        </li>
                    ))}
                </ol>
            </div>
        </div>
    );
}
