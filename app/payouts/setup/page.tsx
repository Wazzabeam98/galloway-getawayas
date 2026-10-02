'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { ChevronLeft, X, User, Building2, Check } from 'lucide-react';
import EmailFirstStep from '@/components/auth/EmailFirstStep';

// "Add a payout method" — the direct link into Stripe payout setup.
//
// Every prompt to set up payouts points here: the approval email, the
// dashboard banner, and the reminders sent with a booking and before check-in.
// A Stripe onboarding link can't be emailed itself (they expire in minutes and
// work once), so this page makes a fresh one when the host presses Continue.
//
// As on Airbnb, the one question first is who gets paid — a person or a
// company — then Stripe collects the bank and identity details. Signed out, the
// shared email step signs them in and they carry on from here.

type Status = { connected: boolean; payouts_enabled: boolean; details_submitted: boolean } | null;

export default function PayoutSetupPage() {
    const supabase = createClientComponentClient();
    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<any>(null);
    const [status, setStatus] = useState<Status>(null);
    const [type, setType] = useState<'individual' | 'company' | ''>('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        (async () => {
            const { data } = await supabase.auth.getSession();
            setSession(data.session);
            if (data.session) {
                const res = await fetch('/api/stripe/connect').catch(() => null);
                const body = res ? await res.json().catch(() => null) : null;
                if (body && body.ok !== false) setStatus(body);
            }
            setLoading(false);
        })();
    }, [supabase]);

    const start = async () => {
        if (!type) return;
        setBusy(true);
        setError('');
        try {
            const res = await fetch('/api/stripe/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'onboard', businessType: type, returnTo: '/payouts/setup' }),
            });
            const out = await res.json().catch(() => ({}));
            if (out && out.ok && out.url) {
                window.location.href = out.url;
                return;
            }
            setError('We couldn’t open Stripe just now. Please try again in a moment.');
        } catch {
            setError('We couldn’t reach the site. Check your connection and try again.');
        }
        setBusy(false);
    };

    if (loading) return <div className="min-h-[60vh]" />;

    if (!session) {
        return (
            <EmailFirstStep
                eyebrow="Get paid"
                intro="Sign in to add a payout method, so we can pay you for your bookings."
                exitHref="/"
                onSignedIn={() => window.location.reload()}
            />
        );
    }

    // Read live from Stripe on load (GET /api/stripe/connect also saves it), so
    // a host back from Stripe sees the truth before the webhook has landed.
    const done = !!(status && status.payouts_enabled);
    const checking = !done && !!(status && status.details_submitted);
    const started = !!(status && status.connected && !status.payouts_enabled && !status.details_submitted);

    const option = (value: 'individual' | 'company', Icon: any, title: string, detail: string) => (
        <button
            type="button"
            onClick={() => setType(value)}
            aria-pressed={type === value}
            className={'flex w-full items-start gap-4 rounded-2xl border-2 p-5 text-left transition '
                + (type === value ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400')}
        >
            <Icon className="mt-0.5 h-6 w-6 shrink-0 text-slate-700" />
            <span>
                <span className="block font-semibold text-slate-900">{title}</span>
                <span className="mt-0.5 block text-sm text-slate-500">{detail}</span>
            </span>
        </button>
    );

    return (
        <div className="fixed inset-0 z-[60] flex flex-col bg-white">
            <div className="shrink-0 border-b border-slate-100 px-4 sm:px-8">
                <div className="flex h-16 items-center justify-between gap-3">
                    <Link href="/dashboard" className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition">
                        <ChevronLeft className="h-5 w-5" /> Back
                    </Link>
                    <span className="text-sm font-bold tracking-tight text-slate-900">Galloway Getaways</span>
                    <Link href="/dashboard" aria-label="Close" className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition">
                        <X className="h-5 w-5" />
                    </Link>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-md px-4 pb-16 pt-10 sm:px-6 sm:pt-20">
                    <p className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-emerald-700">Get paid</p>

                    {done ? (
                        <>
                            <h1 className="mb-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">Your payouts are set up</h1>
                            <p className="mb-8 flex items-start gap-2 text-slate-600">
                                <Check className="mt-1 h-4 w-4 shrink-0 text-emerald-700" />
                                <span>We&rsquo;ll pay you the day after each guest checks in. Any payouts we were holding go out on the next payout run.</span>
                            </p>
                            <Link href="/dashboard" className="block w-full rounded-xl bg-emerald-700 px-6 py-3 text-center text-sm font-semibold text-white hover:bg-emerald-800">
                                Go to your dashboard
                            </Link>
                        </>
                    ) : checking ? (
                        <>
                            <h1 className="mb-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">Stripe is checking your details</h1>
                            <p className="mb-8 text-slate-600 [text-wrap:pretty]">
                                You&rsquo;ve sent everything Stripe asked for. It usually confirms within minutes, sometimes a day or two. We&rsquo;ll keep holding your payouts until it does, then send them on the next payout run.
                            </p>
                            <Link href="/dashboard" className="block w-full rounded-xl bg-emerald-700 px-6 py-3 text-center text-sm font-semibold text-white hover:bg-emerald-800">
                                Go to your dashboard
                            </Link>
                        </>
                    ) : (
                        <>
                            <h1 className="mb-3 text-3xl font-extrabold tracking-tight text-slate-900 [text-wrap:balance] sm:text-4xl">Add a payout method</h1>
                            <p className="mb-8 text-slate-600 [text-wrap:pretty]">
                                {started
                                    ? 'You started this with Stripe but didn’t finish. Pick up where you left off — we’re holding your payouts until it’s done.'
                                    : 'We pay you through Stripe, the day after each guest checks in. Until you add a payout method, we hold your payouts safely for you.'}
                            </p>

                            <h2 className="mb-3 text-sm font-semibold text-slate-900">Who should we pay?</h2>
                            <div className="space-y-3">
                                {option('individual', User, 'An individual', 'You, as a person — including sole traders.')}
                                {option('company', Building2, 'A company', 'A limited company, partnership or estate.')}
                            </div>

                            {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}

                            <button
                                type="button"
                                onClick={start}
                                disabled={!type || busy}
                                className="mt-6 w-full rounded-xl bg-emerald-700 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                            >
                                {busy ? 'Opening Stripe…' : 'Continue to Stripe'}
                            </button>
                            <p className="mt-4 text-xs text-slate-500">
                                Stripe asks for your bank details and proof of identity. It takes about five minutes.
                            </p>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
