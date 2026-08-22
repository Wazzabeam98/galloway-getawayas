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

interface Schedule {
    interval: string;
    delayDays: number | null;
    weeklyAnchor: string | null;
    monthlyAnchor: number | null;
}

interface Bank {
    bank_name: string | null;
    last4: string | null;
    sort_code: string | null;
    currency: string;
}

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function titleCase(value: string): string {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
}

function ordinal(n: number): string {
    const suffix = n % 10 === 1 && n !== 11 ? 'st'
        : n % 10 === 2 && n !== 12 ? 'nd'
            : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
    return n + suffix;
}

export default function PaymentsSection() {
    const supabase = createClientComponentClient();

    const [loading, setLoading] = useState(true);
    const [working, setWorking] = useState(false);
    const [status, setStatus] = useState<Status>({ connected: false });
    const [isHost, setIsHost] = useState(false);
    const [schedule, setSchedule] = useState<Schedule | null>(null);
    const [bank, setBank] = useState<Bank | null>(null);
    const [timing, setTiming] = useState('');
    const [savingSchedule, setSavingSchedule] = useState(false);
    const [draftInterval, setDraftInterval] = useState('daily');
    const [draftWeekday, setDraftWeekday] = useState('friday');
    const [draftMonthday, setDraftMonthday] = useState(1);

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

            // Separate call on purpose: the connect route is what tells us
            // whether they are set up at all, and this page has to render
            // something sensible even when Stripe cannot be reached for the
            // detail.
            const payoutRes = await fetch('/api/stripe/payout-schedule');
            const payout = await payoutRes.json();
            if (payout && payout.ok && payout.connected) {
                setSchedule(payout.schedule || null);
                setBank(payout.bank || null);
                setTiming(payout.timing || '');
                if (payout.schedule) {
                    setDraftInterval(payout.schedule.interval || 'daily');
                    if (payout.schedule.weeklyAnchor) setDraftWeekday(payout.schedule.weeklyAnchor);
                    if (payout.schedule.monthlyAnchor) setDraftMonthday(payout.schedule.monthlyAnchor);
                }
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

    const saveSchedule = async () => {
        setSavingSchedule(true);
        try {
            const res = await fetch('/api/stripe/payout-schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    interval: draftInterval,
                    weekly_anchor: draftWeekday,
                    monthly_anchor: draftMonthday,
                }),
            });
            const data = await res.json();

            if (data && data.ok) {
                setSchedule(data.schedule || null);
                setTiming(data.timing || timing);
                toast.success('Payout schedule updated.', { theme: 'colored' });
            } else {
                toast.error((data && data.error) || 'Could not change your payout schedule.', { theme: 'colored' });
            }
        } catch (err) {
            toast.error('Could not reach Stripe. Please try again.', { theme: 'colored' });
        }
        setSavingSchedule(false);
    };

    const scheduleInWords = (s: Schedule | null) => {
        if (!s) return '';
        if (s.interval === 'weekly') {
            return 'Every ' + titleCase(s.weeklyAnchor || 'friday');
        }
        if (s.interval === 'monthly') {
            return 'On the ' + ordinal(s.monthlyAnchor || 1) + ' of each month';
        }
        return 'Every day';
    };

    const unchanged = schedule
        && schedule.interval === draftInterval
        && (draftInterval !== 'weekly' || schedule.weeklyAnchor === draftWeekday)
        && (draftInterval !== 'monthly' || schedule.monthlyAnchor === draftMonthday);

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

                        </div>
                    </div>

                    {/* WHERE THE MONEY GOES — shown here, changed at Stripe.
                        Reading these is allowed and returns the last four
                        digits and the sort code, never the account number.
                        Changing them is Stripe's job: it is the one change
                        worth an identity check, and doing it from a form on
                        this site would remove that check. */}
                    <div className="mt-6 pt-6 border-t">
                        <h4 className="text-sm font-semibold text-slate-900 mb-3">Your bank account</h4>

                        {bank ? (
                            <div className="flex items-center justify-between gap-4 flex-wrap">
                                <div>
                                    <div className="font-medium text-slate-800">
                                        {bank.bank_name || 'Your bank'}
                                    </div>
                                    <div className="text-sm text-slate-500 mt-0.5">
                                        {bank.sort_code ? bank.sort_code + ' · ' : ''}
                                        ending {bank.last4 || '••••'}
                                        {bank.currency ? ' · ' + bank.currency : ''}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => go('dashboard')}
                                    disabled={working}
                                    className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 hover:border-slate-500 text-slate-700 text-sm font-semibold rounded-xl transition disabled:opacity-50"
                                >
                                    {working ? 'Opening...' : 'Change'}
                                    <ExternalLink className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        ) : (
                            <div className="flex items-center justify-between gap-4 flex-wrap">
                                <p className="text-sm text-slate-500">
                                    We couldn&apos;t read your bank details just now.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => go('dashboard')}
                                    disabled={working}
                                    className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 hover:border-slate-500 text-slate-700 text-sm font-semibold rounded-xl transition disabled:opacity-50"
                                >
                                    {working ? 'Opening...' : 'Manage at Stripe'}
                                    <ExternalLink className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        )}

                        <p className="text-xs text-slate-400 mt-2">
                            Changing these happens at Stripe, who check it&apos;s really you before your
                            money starts going somewhere new. Galloway Getaways never sees your account number.
                        </p>
                    </div>

                    {/* HOW OFTEN — this one is ours to change. */}
                    <div className="mt-6 pt-6 border-t">
                        <h4 className="text-sm font-semibold text-slate-900 mb-1">How often you&apos;re paid</h4>
                        <p className="text-sm text-slate-500 mb-4">
                            {timing || 'We release your share the day after your guest checks in.'}
                        </p>

                        <div className="flex flex-wrap gap-2">
                            {['daily', 'weekly', 'monthly'].map((option) => (
                                <button
                                    key={option}
                                    type="button"
                                    onClick={() => setDraftInterval(option)}
                                    className={`px-4 py-2 rounded-xl border text-sm font-semibold transition ${
                                        draftInterval === option
                                            ? 'border-slate-900 bg-slate-900 text-white'
                                            : 'border-slate-300 text-slate-700 hover:border-slate-500'
                                    }`}
                                >
                                    {titleCase(option)}
                                </button>
                            ))}
                        </div>

                        {draftInterval === 'weekly' && (
                            <label className="block mt-4 text-sm text-slate-600">
                                Paid out every
                                <select
                                    value={draftWeekday}
                                    onChange={(e) => setDraftWeekday(e.target.value)}
                                    className="ml-2 border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-slate-900"
                                >
                                    {WEEKDAYS.map((d) => (
                                        <option key={d} value={d}>{titleCase(d)}</option>
                                    ))}
                                </select>
                            </label>
                        )}

                        {draftInterval === 'monthly' && (
                            <label className="block mt-4 text-sm text-slate-600">
                                Paid out on the
                                <select
                                    value={draftMonthday}
                                    onChange={(e) => setDraftMonthday(parseInt(e.target.value, 10))}
                                    className="ml-2 border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-slate-900"
                                >
                                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                                        <option key={d} value={d}>{ordinal(d)}</option>
                                    ))}
                                </select>
                                <span className="ml-2 text-xs text-slate-400">
                                    of each month
                                </span>
                            </label>
                        )}

                        <div className="mt-4 flex items-center gap-3 flex-wrap">
                            <button
                                type="button"
                                onClick={saveSchedule}
                                disabled={savingSchedule || !!unchanged}
                                className="px-5 py-2.5 bg-slate-900 hover:bg-black text-white text-sm font-semibold rounded-xl transition disabled:opacity-40"
                            >
                                {savingSchedule ? 'Saving...' : 'Save'}
                            </button>
                            {schedule && (
                                <span className="text-xs text-slate-400">
                                    Currently: {scheduleInWords(schedule)}
                                </span>
                            )}
                        </div>

                        {/* The complaint this heads off: a host on monthly who
                            thinks Galloway is sitting on their money. */}
                        <div className="mt-5 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                            <p className="text-xs text-slate-600">
                                <strong className="text-slate-800">This changes Stripe&apos;s side, not ours.</strong>{' '}
                                We release your share the day after your guest checks in, whatever you pick here.
                                This setting is how often Stripe forwards what&apos;s built up in your Stripe
                                balance into your bank. Choosing monthly doesn&apos;t mean we pay you later &mdash;
                                it means Stripe holds it for you until then.
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
                                    'Any service fee is deducted before payout',
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
                        'Any service fee is deducted before the payout, so nothing to invoice.',
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
