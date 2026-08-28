'use client';

import { useState } from 'react';
import Link from 'next/link';

// The launch-morning screen.
//
// The promise made to hosts is "register now, everything goes live on the
// day". That makes this the one place where doing ten things has to cost one
// press, not ten — so selection and a single Approve are the primary control,
// and the per-row buttons are the exception rather than the other way round.
//
// WHAT IT SHOWS THAT A LIST OF NAMES WOULD NOT
//
// Whether each listing is actually finished. The wizard's own rules decide, so
// this cannot disagree with what the host was asked for, and a listing missing
// a price is not selectable at all — an owner approving in a hurry should not
// be able to put a half-finished property on the site by clicking fast.
//
// Declines are one at a time and need a reason, because the reason is the body
// of the email the host receives. One sentence true of ten listings is too
// vague to act on.

export interface QueueItem {
    id: string;
    title: string;
    area: string;
    image: string | null;
    hostName: string;
    /** Empty when the listing is finished. First entry is shown. */
    problems: string[];
    waitingSince: string;
}

export default function ListingReviewQueue({ items }: { items: QueueItem[] }) {
    const ready = items.filter((i) => i.problems.length === 0);

    const [selected, setSelected] = useState<Record<string, boolean>>({});
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [failures, setFailures] = useState<Record<string, string>>({});
    const [decliningId, setDecliningId] = useState<string | null>(null);
    const [reason, setReason] = useState('');

    const chosen = ready.filter((i) => selected[i.id]).map((i) => i.id);

    async function decide(payload: any, describe: (result: any) => string) {
        setBusy(true);
        setMessage('');
        setFailures({});

        try {
            const res = await fetch('/api/admin/listings/decide', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const result = await res.json();

            if (!res.ok || result.ok === false) {
                setMessage(result.error || 'That did not work.');
                return;
            }

            // Per-row failures are put next to the row rather than summed into
            // one sentence — "9 done, 1 failed" is only useful if you can see
            // which one.
            const perRow: Record<string, string> = {};
            for (const outcome of result.outcomes || []) {
                if (!outcome.ok) perRow[outcome.id] = outcome.error || 'Failed.';
            }
            setFailures(perRow);
            setMessage(describe(result));
            setSelected({});
            setDecliningId(null);
            setReason('');

            // The rows that succeeded are gone from the queue now, and the
            // counts above are server-rendered.
            if (result.decided > 0) setTimeout(() => window.location.reload(), 1400);
        } catch {
            setMessage('That did not work.');
        } finally {
            setBusy(false);
        }
    }

    if (items.length === 0) return null;

    return (
        <section className="mb-12">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                <h2 className="text-lg font-bold text-slate-900">Waiting for approval</h2>
                <span className="text-xs text-slate-500">
                    {ready.length} of {items.length} ready to go live
                </span>
            </div>
            <p className="text-sm text-slate-500 mb-4">
                Approving puts a property on the site straight away and emails the host.
                A listing that is not finished cannot be selected.
            </p>

            <div className="flex flex-wrap items-center gap-3 mb-4">
                <button
                    type="button"
                    disabled={busy || ready.length === 0}
                    onClick={() => setSelected(
                        chosen.length === ready.length
                            ? {}
                            : Object.fromEntries(ready.map((i) => [i.id, true]))
                    )}
                    className="text-sm font-semibold text-slate-700 underline disabled:opacity-40"
                >
                    {chosen.length === ready.length && ready.length > 0 ? 'Clear selection' : 'Select all ready'}
                </button>

                <button
                    type="button"
                    disabled={busy || chosen.length === 0}
                    onClick={() => decide(
                        { decision: 'approve', ids: chosen },
                        (r) => r.summary
                    )}
                    className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold disabled:opacity-40"
                >
                    {busy
                        ? 'Working…'
                        : chosen.length === 0
                            ? 'Approve selected'
                            : `Approve ${chosen.length} ${chosen.length === 1 ? 'listing' : 'listings'}`}
                </button>

                {message && <p className="text-sm font-medium text-slate-800">{message}</p>}
            </div>

            <div className="space-y-3">
                {items.map((item) => {
                    const finished = item.problems.length === 0;

                    return (
                        <div
                            key={item.id}
                            className={`border rounded-2xl p-4 flex flex-wrap gap-4 items-start ${finished ? 'bg-white' : 'bg-slate-50'}`}
                        >
                            <input
                                type="checkbox"
                                aria-label={`Select ${item.title}`}
                                disabled={!finished || busy}
                                checked={!!selected[item.id]}
                                onChange={(e) => setSelected((prev) => ({ ...prev, [item.id]: e.target.checked }))}
                                className="mt-1 h-4 w-4 disabled:opacity-30"
                            />

                            {item.image
                                ? <img src={item.image} alt="" className="w-20 h-16 rounded-lg object-cover flex-shrink-0" />
                                : <div className="w-20 h-16 rounded-lg bg-slate-200 flex-shrink-0" />}

                            <div className="flex-1 min-w-[12rem]">
                                <Link href={`/homes/${item.id}`} className="font-semibold text-slate-900 hover:underline">
                                    {item.title}
                                </Link>
                                <p className="text-sm text-slate-500">
                                    {item.area} · {item.hostName} · sent {item.waitingSince}
                                </p>

                                {!finished && (
                                    <p className="text-sm text-amber-800 mt-1">
                                        Not finished — {item.problems[0]}
                                        {item.problems.length > 1 && ` (and ${item.problems.length - 1} more)`}
                                    </p>
                                )}

                                {failures[item.id] && (
                                    <p className="text-sm text-red-700 mt-1">{failures[item.id]}</p>
                                )}
                            </div>

                            <div className="flex flex-col items-end gap-2">
                                <button
                                    type="button"
                                    disabled={busy || !finished}
                                    onClick={() => decide(
                                        { decision: 'approve', id: item.id },
                                        () => 'Approved.'
                                    )}
                                    className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold disabled:opacity-40"
                                >
                                    Approve
                                </button>
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => { setDecliningId(item.id); setReason(''); }}
                                    className="text-xs font-semibold text-slate-500 underline"
                                >
                                    Send back
                                </button>
                            </div>

                            {decliningId === item.id && (
                                <div className="w-full border-t pt-3 mt-1">
                                    <label className="block text-sm font-semibold text-slate-800 mb-1">
                                        What needs changing?
                                    </label>
                                    <p className="text-xs text-slate-500 mb-2">
                                        This is emailed to {item.hostName} word for word, so write it to them.
                                    </p>
                                    <textarea
                                        value={reason}
                                        onChange={(e) => setReason(e.target.value)}
                                        rows={3}
                                        className="w-full p-2.5 border rounded-lg text-sm"
                                        placeholder="The photos are all of the garden — could you add a couple of the inside?"
                                    />
                                    <div className="flex gap-2 mt-2">
                                        <button
                                            type="button"
                                            disabled={busy || !reason.trim()}
                                            onClick={() => decide(
                                                { decision: 'decline', id: item.id, note: reason.trim() },
                                                () => 'Sent back, and the host has been told.'
                                            )}
                                            className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold disabled:opacity-40"
                                        >
                                            Send back to the host
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setDecliningId(null)}
                                            className="px-3 py-1.5 text-xs font-semibold text-slate-500"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
