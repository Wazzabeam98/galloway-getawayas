'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatGBP } from '@/lib/formatMoney';
import { disputeReasonProblem, DISPUTE_REASON_MAX } from '@/lib/hostDebtView';

// "Money you owe" on the earnings page — Airbnb's amount-owed panel.
//
// Every debt says what it is for, which booking it came from, what it was, what
// has been recovered so far and what is left. While payouts are coming it
// comes off those, and the host may still pay it now; with none coming it is
// due, and paying is the main action. Either way it can be disputed, which
// stops it being taken and puts it in front of a person.

export interface DebtCard {
    id: string;
    title: string;
    note: string | null;
    status: string;          // owed | disputed | settled | waived
    statusLabel: string;
    original: number;
    recovered: number;
    waived: number;
    outstanding: number;
    created: string;         // DD/MM/YYYY
    booking: { id: string; stay: string; dates: string } | null;
    disputeReason: string | null;
    decisionNote: string | null;
}

export default function HostDebtsPanel({
    debts,
    dueNow,
    owedTotal,
    banner,
}: {
    debts: DebtCard[];
    dueNow: boolean;
    owedTotal: number;
    banner: 'paid' | 'cancelled' | null;
}) {
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [disputing, setDisputing] = useState<string | null>(null);
    const [reason, setReason] = useState('');
    const [sent, setSent] = useState<Record<string, boolean>>({});

    if (!debts.length) return null;

    async function pay(id: string) {
        setBusy(id); setError(null);
        try {
            const r = await fetch('/api/host-debts/pay', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ payoutId: id }),
            });
            const d = await r.json().catch(() => ({}));
            if (d && d.ok && d.url) { window.location.href = d.url; return; }
            setError((d && d.error) || 'Could not start the payment. Try again.');
        } catch {
            setError('Could not start the payment. Try again.');
        }
        setBusy(null);
    }

    async function dispute(id: string) {
        const problem = disputeReasonProblem(reason);
        if (problem) { setError(problem); return; }
        setBusy(id); setError(null);
        try {
            const r = await fetch('/api/host-debts/dispute', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ payoutId: id, reason }),
            });
            const d = await r.json().catch(() => ({}));
            if (d && d.ok) {
                setSent((s) => ({ ...s, [id]: true }));
                setDisputing(null); setReason('');
                window.location.reload();
                return;
            }
            setError((d && d.error) || 'Could not send that. Try again.');
        } catch {
            setError('Could not send that. Try again.');
        }
        setBusy(null);
    }

    return (
        <section id="owed" className="scroll-mt-24 border rounded-2xl p-6 mb-8">
            <div className="flex items-baseline justify-between flex-wrap gap-2">
                <h2 className="font-bold text-slate-900">Money you owe</h2>
                {owedTotal > 0 && (
                    <div className={`text-sm font-semibold ${dueNow ? 'text-red-700' : 'text-slate-700'}`}>
                        {formatGBP(owedTotal)} {dueNow ? 'due now' : 'to come off your payouts'}
                    </div>
                )}
            </div>
            <p className="text-sm text-slate-500 mt-1 mb-5">
                {owedTotal > 0
                    ? (dueNow
                        ? 'You have no payouts coming for this to come off, so it’s due now. Pay it below, or dispute it if you think it’s wrong.'
                        : 'This comes off your next payouts automatically. You can pay it now instead, or dispute it if you think it’s wrong.')
                    : 'Nothing to pay right now.'}
            </p>

            {banner === 'paid' && (
                <p className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                    Thanks — your payment is being confirmed. It shows here as paid within a minute or two.
                </p>
            )}
            {error && (
                <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>
            )}

            <ul className="space-y-4">
                {debts.map((d) => (
                    <li key={d.id} className="rounded-xl border border-slate-200 p-4">
                        <div className="flex items-start justify-between gap-4 flex-wrap">
                            <div className="min-w-0">
                                <div className="font-semibold text-slate-900">{d.title}</div>
                                {d.booking ? (
                                    <Link href={'/dashboard/bookings/' + d.booking.id} className="text-sm text-slate-600 underline underline-offset-2 hover:text-slate-900">
                                        {d.booking.stay} · {d.booking.dates}
                                    </Link>
                                ) : (
                                    <div className="text-sm text-slate-500">Not tied to one booking</div>
                                )}
                                <div className="text-xs text-slate-400 mt-0.5">Raised {d.created}</div>
                            </div>
                            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                d.status === 'disputed' ? 'bg-amber-50 text-amber-800'
                                    : d.status === 'owed' ? (dueNow ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-700')
                                        : 'bg-emerald-50 text-emerald-800'
                            }`}>
                                {d.statusLabel}
                            </span>
                        </div>

                        <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                            <div><dt className="text-slate-500">Amount</dt><dd className="font-medium text-slate-900">{formatGBP(d.original)}</dd></div>
                            <div><dt className="text-slate-500">Recovered so far</dt><dd className="font-medium text-slate-900">{formatGBP(d.recovered)}</dd></div>
                            {d.waived > 0 && (
                                <div><dt className="text-slate-500">Written off</dt><dd className="font-medium text-slate-900">{formatGBP(d.waived)}</dd></div>
                            )}
                            <div><dt className="text-slate-500">Left to pay</dt><dd className="font-bold text-slate-900">{formatGBP(d.outstanding)}</dd></div>
                        </dl>

                        {d.note && <p className="mt-3 text-sm text-slate-600">{d.note}</p>}
                        {d.status === 'disputed' && d.disputeReason && (
                            <p className="mt-3 text-sm text-slate-600">You said: “{d.disputeReason}”</p>
                        )}
                        {d.decisionNote && (
                            <p className="mt-3 text-sm text-slate-600">Our decision: “{d.decisionNote}”</p>
                        )}

                        {d.status === 'owed' && d.outstanding > 0 && !sent[d.id] && (
                            <div className="mt-4 flex flex-wrap items-center gap-3">
                                <button
                                    type="button"
                                    disabled={busy === d.id}
                                    onClick={() => pay(d.id)}
                                    className={`rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-60 ${
                                        dueNow ? 'bg-slate-900 text-white hover:bg-slate-800' : 'border border-slate-300 text-slate-900 hover:border-slate-900'
                                    }`}
                                >
                                    {busy === d.id ? 'Opening…' : 'Pay ' + formatGBP(d.outstanding) + ' now'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setDisputing(disputing === d.id ? null : d.id); setError(null); }}
                                    className="text-sm font-semibold text-slate-700 underline underline-offset-4 hover:text-slate-900"
                                >
                                    Dispute this
                                </button>
                            </div>
                        )}

                        {disputing === d.id && (
                            <div className="mt-4 rounded-xl bg-slate-50 p-4">
                                <label htmlFor={'dispute-' + d.id} className="block text-sm font-semibold text-slate-900">
                                    Why isn’t this right?
                                </label>
                                <p className="text-xs text-slate-500 mt-0.5 mb-2">
                                    One of us will look at it. Nothing is taken from your payouts while we do.
                                </p>
                                <textarea
                                    id={'dispute-' + d.id}
                                    value={reason}
                                    maxLength={DISPUTE_REASON_MAX}
                                    onChange={(e) => setReason(e.target.value)}
                                    rows={4}
                                    className="w-full rounded-lg border border-slate-300 p-3 text-sm focus:border-slate-900 focus:outline-none"
                                />
                                <div className="mt-3 flex gap-3">
                                    <button
                                        type="button"
                                        disabled={busy === d.id}
                                        onClick={() => dispute(d.id)}
                                        className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                                    >
                                        {busy === d.id ? 'Sending…' : 'Send dispute'}
                                    </button>
                                    <button type="button" onClick={() => { setDisputing(null); setReason(''); }} className="text-sm font-semibold text-slate-600">
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
}
