'use client';

import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { ShieldCheck, ExternalLink, Clock, Banknote } from 'lucide-react';

// An experience provider's payouts — the host's /account → Payments card
// (components/account/PaymentsSection), the same three things in the same
// shape: where the money goes (bank, changed at Stripe), how often Stripe pays
// it out (daily / weekly / monthly), and when it arrives. The owner's alone
// (/api/services/payout-settings and /api/services/connect check it).
//
// providerId: a given business (the earnings page); omitted, their own
// experience business (/account → Payments). Renders nothing for someone who
// has none.

interface Schedule { interval: string; delayDays: number | null; weeklyAnchor: string | null; monthlyAnchor: number | null }
interface Bank { bank_name: string | null; last4: string | null; sort_code: string | null; currency: string }

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const titleCase = (v: string) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : '');
const ordinal = (n: number) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');

export default function ProviderPayoutsCard({ providerId, heading = true }: { providerId?: string; heading?: boolean }) {
    const [loading, setLoading] = useState(true);
    const [provider, setProvider] = useState<{ id: string; name: string; status: string } | null>(null);
    const [connected, setConnected] = useState(false);
    const [payoutsEnabled, setPayoutsEnabled] = useState(false);
    const [schedule, setSchedule] = useState<Schedule | null>(null);
    const [bank, setBank] = useState<Bank | null>(null);
    const [timing, setTiming] = useState('');
    const [working, setWorking] = useState(false);
    const [saving, setSaving] = useState(false);
    const [draftInterval, setDraftInterval] = useState('daily');
    const [draftWeekday, setDraftWeekday] = useState('friday');
    const [draftMonthday, setDraftMonthday] = useState(1);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/services/payout-settings' + (providerId ? '?provider=' + encodeURIComponent(providerId) : ''));
                const d = await res.json();
                if (d && d.ok && d.provider) {
                    setProvider(d.provider);
                    setConnected(!!d.connected);
                    setPayoutsEnabled(!!d.payouts_enabled);
                    setSchedule(d.schedule || null);
                    setBank(d.bank || null);
                    setTiming(d.timing || '');
                    if (d.schedule) {
                        setDraftInterval(d.schedule.interval || 'daily');
                        if (d.schedule.weeklyAnchor) setDraftWeekday(d.schedule.weeklyAnchor);
                        if (d.schedule.monthlyAnchor) setDraftMonthday(d.schedule.monthlyAnchor);
                    }
                }
            } catch { /* leave it empty */ }
            setLoading(false);
        })();
    }, [providerId]);

    // "Change" / "Manage at Stripe" (the Express dashboard), or onboarding.
    const go = async (action: 'onboard' | 'dashboard') => {
        if (!provider) return;
        setWorking(true);
        try {
            const res = await fetch('/api/services/connect', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(action === 'dashboard' ? { providerId: provider.id, action: 'dashboard' } : { providerId: provider.id }),
            });
            const d = await res.json();
            if (d && d.ok && d.url) { window.location.href = d.url; return; }
            toast.error((d && d.error) || 'Could not open Stripe. Please try again.', { theme: 'colored' });
        } catch {
            toast.error('Could not reach Stripe. Please try again.', { theme: 'colored' });
        }
        setWorking(false);
    };

    const save = async () => {
        if (!provider) return;
        setSaving(true);
        try {
            const res = await fetch('/api/services/payout-settings', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ providerId: provider.id, interval: draftInterval, weekly_anchor: draftWeekday, monthly_anchor: draftMonthday }),
            });
            const d = await res.json();
            if (d && d.ok) {
                setSchedule(d.schedule || null);
                setTiming(d.timing || timing);
                toast.success('Payout schedule updated.', { theme: 'colored' });
            } else {
                toast.error((d && d.error) || 'Could not change your payout schedule.', { theme: 'colored' });
            }
        } catch {
            toast.error('Could not reach Stripe. Please try again.', { theme: 'colored' });
        }
        setSaving(false);
    };

    if (loading || !provider) return null;

    const inWords = (s: Schedule | null) => !s ? '' : s.interval === 'weekly' ? 'Every ' + titleCase(s.weeklyAnchor || 'friday')
        : s.interval === 'monthly' ? 'On the ' + ordinal(s.monthlyAnchor || 1) + ' of each month' : 'Every day';
    const unchanged = schedule && schedule.interval === draftInterval
        && (draftInterval !== 'weekly' || schedule.weeklyAnchor === draftWeekday)
        && (draftInterval !== 'monthly' || schedule.monthlyAnchor === draftMonthday);
    const approved = provider.status === 'approved';

    return (
        <div>
            {heading && (
                <>
                    <h3 className="text-lg font-semibold text-slate-900">Payouts for {provider.name}</h3>
                    <p className="mb-4 text-sm text-slate-500">How you get paid for your experience’s bookings.</p>
                </>
            )}
            {connected && payoutsEnabled ? (
                <div className="rounded-2xl border p-6">
                    <div className="flex items-start gap-4">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-50"><ShieldCheck className="h-5 w-5 text-emerald-700" /></div>
                        <div className="flex-1">
                            <div className="flex items-center gap-2">
                                <h3 className="font-semibold text-slate-900">You&apos;re set up for payouts</h3>
                                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">Verified</span>
                            </div>
                            <p className="mt-1 text-sm text-slate-500">Stripe has verified your identity and bank details. Guests&apos; payments are held by Galloway Getaways and your share is released after the experience.</p>
                        </div>
                    </div>

                    <div className="mt-6 border-t pt-6">
                        <h4 className="mb-3 text-sm font-semibold text-slate-900">Your bank account</h4>
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            {bank ? (
                                <div>
                                    <div className="font-medium text-slate-800">{bank.bank_name || 'Your bank'}</div>
                                    <div className="mt-0.5 text-sm text-slate-500">{bank.sort_code ? bank.sort_code + ' · ' : ''}ending {bank.last4 || '••••'}{bank.currency ? ' · ' + bank.currency : ''}</div>
                                </div>
                            ) : (
                                <p className="text-sm text-slate-500">We couldn&apos;t read your bank details just now.</p>
                            )}
                            <button type="button" onClick={() => go('dashboard')} disabled={working}
                                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500 disabled:opacity-50">
                                {working ? 'Opening...' : bank ? 'Change' : 'Manage at Stripe'}
                                <ExternalLink className="h-3.5 w-3.5" />
                            </button>
                        </div>
                        <p className="mt-2 text-xs text-slate-400">Changing these happens at Stripe, who check it&apos;s really you before your money starts going somewhere new. Galloway Getaways never sees your account number.</p>
                    </div>

                    <div className="mt-6 border-t pt-6">
                        <h4 className="mb-1 text-sm font-semibold text-slate-900">How often you&apos;re paid</h4>
                        <p className="mb-4 text-sm text-slate-500">{timing || 'We release your share the day after the experience.'}</p>
                        <div className="flex flex-wrap gap-2">
                            {['daily', 'weekly', 'monthly'].map((o) => (
                                <button key={o} type="button" onClick={() => setDraftInterval(o)}
                                    className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${draftInterval === o ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-700 hover:border-slate-500'}`}>
                                    {titleCase(o)}
                                </button>
                            ))}
                        </div>
                        {draftInterval === 'weekly' && (
                            <label className="mt-4 block text-sm text-slate-600">Paid out every
                                <select value={draftWeekday} onChange={(e) => setDraftWeekday(e.target.value)} className="ml-2 rounded-lg border px-3 py-1.5 text-sm outline-none focus:border-slate-900">
                                    {WEEKDAYS.map((d) => <option key={d} value={d}>{titleCase(d)}</option>)}
                                </select>
                            </label>
                        )}
                        {draftInterval === 'monthly' && (
                            <label className="mt-4 block text-sm text-slate-600">Paid out on the
                                <select value={draftMonthday} onChange={(e) => setDraftMonthday(parseInt(e.target.value, 10))} className="ml-2 rounded-lg border px-3 py-1.5 text-sm outline-none focus:border-slate-900">
                                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{ordinal(d)}</option>)}
                                </select>
                                <span className="ml-2 text-xs text-slate-400">of each month</span>
                            </label>
                        )}
                        <div className="mt-4 flex flex-wrap items-center gap-3">
                            <button type="button" onClick={save} disabled={saving || !!unchanged}
                                className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-40">
                                {saving ? 'Saving...' : 'Save'}
                            </button>
                            {schedule && <span className="text-xs text-slate-400">Currently: {inWords(schedule)}</span>}
                        </div>
                        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                            <p className="text-xs text-slate-600">
                                <strong className="text-slate-800">This changes Stripe&apos;s side, not ours.</strong>{' '}
                                We release your share the day after the experience, whatever you pick here. This setting is how often Stripe forwards what&apos;s built up in your Stripe balance into your bank.
                            </p>
                        </div>
                    </div>
                </div>
            ) : connected ? (
                <div className="rounded-2xl border p-6">
                    <div className="flex items-start gap-4">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-50"><Clock className="h-5 w-5 text-amber-700" /></div>
                        <div className="flex-1">
                            <h3 className="font-semibold text-slate-900">Nearly there</h3>
                            <p className="mt-1 text-sm text-slate-500">You started setting up payouts but Stripe needs a little more before it can pay you. Your share of each booking is held safely until it can.</p>
                            <button type="button" onClick={() => go('onboard')} disabled={working}
                                className="mt-4 rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50">
                                {working ? 'Opening...' : 'Finish setting up payouts'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="rounded-2xl border p-6">
                    <div className="flex items-start gap-4">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100"><Banknote className="h-5 w-5 text-slate-500" /></div>
                        <div className="flex-1">
                            <h3 className="font-semibold text-slate-900">Set up payouts</h3>
                            <p className="mt-1 text-sm text-slate-500">
                                {approved
                                    ? 'Tell us where to send your money. Stripe, our payments provider, will ask for your details and bank account. Your share of each booking is held safely until you do.'
                                    : 'Once your experience is approved you can tell us where to send your money — Stripe will ask for your details and bank account.'}
                            </p>
                            {approved && (
                                <button type="button" onClick={() => go('onboard')} disabled={working}
                                    className="mt-5 rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50">
                                    {working ? 'Opening Stripe...' : 'Set up payouts'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
