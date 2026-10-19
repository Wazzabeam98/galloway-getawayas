'use client';

// One test of every push type (lib/pushCatalogue), to the admin's own devices.
// Each row sends its own; "Send all" goes through the list four seconds apart
// so the phone shows each one. What the push service answered shows on the row.

import { useState } from 'react';
import { CATALOGUE, cataloguePush, type Side } from '@/lib/pushCatalogue';

type Row = { state: 'waiting' | 'sending' | 'done'; text?: string; good?: boolean };

const GAP_MS = 4000;
const SIDES: Side[] = ['Holiday lets', 'Experiences', 'Trades', 'Account', 'Owner alerts'];

function describe(res: any): { text: string; good: boolean } {
    const r = res && res.report;
    if (!res || !res.ok || !r) return { text: (res && res.error) || 'Could not send.', good: false };
    if (!r.configured) return { text: 'Push isn’t switched on for this site (no keys set).', good: false };
    if (r.devices === 0) return { text: 'No devices: turn notifications on from your dashboard first.', good: false };
    const parts: string[] = [r.accepted + ' of ' + r.devices + (r.devices === 1 ? ' device' : ' devices') + ' accepted'];
    if (r.gone) parts.push(r.gone + ' no longer subscribed (removed)');
    if (r.failed) parts.push(r.failed + ' refused: ' + r.errors.join('; '));
    return { text: parts.join(' · '), good: r.accepted > 0 && r.failed === 0 };
}

async function sendOne(id: string): Promise<{ text: string; good: boolean }> {
    try {
        const r = await fetch('/api/admin/push-test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
        });
        return describe(await r.json().catch(() => null));
    } catch {
        return describe(null);
    }
}

export default function PushTestButton() {
    const [rows, setRows] = useState<Record<string, Row>>({});
    const [running, setRunning] = useState(false);

    const one = async (id: string) => {
        setRows((p) => ({ ...p, [id]: { state: 'sending' } }));
        const d = await sendOne(id);
        setRows((p) => ({ ...p, [id]: { state: 'done', ...d } }));
    };

    const all = async () => {
        setRunning(true);
        setRows(Object.fromEntries(CATALOGUE.map((e) => [e.id, { state: 'waiting' } as Row])));
        for (let i = 0; i < CATALOGUE.length; i++) {
            if (i > 0) await new Promise((r) => setTimeout(r, GAP_MS));
            await one(CATALOGUE[i].id);
        }
        setRunning(false);
    };

    return (
        <div>
            <button
                type="button"
                onClick={all}
                disabled={running}
                className="rounded-xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
                {running ? 'Sending…' : 'Send test notifications'}
            </button>
            <p className="mt-2 text-xs text-slate-500">
                Sends all {CATALOGUE.length}, four seconds apart (about {Math.ceil((CATALOGUE.length * GAP_MS) / 60000)} minutes). Or send one at a time below.
            </p>

            {SIDES.map((side) => (
                <div key={side} className="mt-8">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">{side}</h2>
                    <ul className="divide-y rounded-2xl border">
                        {CATALOGUE.filter((e) => e.side === side).map((e) => {
                            const p = cataloguePush(e);
                            const row = rows[e.id];
                            return (
                                <li key={e.id} className="flex items-start justify-between gap-4 p-4 text-sm">
                                    <div className="min-w-0">
                                        <div className="text-slate-500">{e.event} &middot; {e.who}</div>
                                        <div className="font-semibold text-slate-900">{p ? p.title : '—'}</div>
                                        <div className="text-slate-600">{p ? p.body : ''}</div>
                                        {row && (
                                            <div className={'mt-1 ' + (row.state !== 'done' ? 'text-slate-500' : row.good ? 'text-emerald-800' : 'text-rose-700')}>
                                                {row.state === 'waiting' ? 'Waiting…' : row.state === 'sending' ? 'Sending…' : row.text}
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => one(e.id)}
                                        disabled={running}
                                        className="shrink-0 font-semibold text-slate-900 underline underline-offset-2 disabled:opacity-40"
                                    >
                                        Send
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </div>
    );
}
