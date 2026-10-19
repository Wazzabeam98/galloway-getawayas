'use client';

import { useState } from 'react';
import { TEST_PUSH_KINDS, TEST_PUSH_LABELS, type TestPushKind } from '@/lib/pushTest';

type Row = { state: 'waiting' | 'sending' | 'done'; text?: string; good?: boolean };

const GAP_MS = 10000;

function describe(res: any): { text: string; good: boolean } {
    const r = res && res.report;
    if (!res || !res.ok || !r) return { text: (res && res.error) || 'Could not send.', good: false };
    if (!r.configured) return { text: 'Push isn’t switched on for this site (no keys set).', good: false };
    if (r.devices === 0) return { text: 'No devices: turn notifications on from your dashboard first.', good: false };
    const parts: string[] = [];
    parts.push(r.accepted + ' of ' + r.devices + (r.devices === 1 ? ' device' : ' devices') + ' accepted');
    if (r.gone) parts.push(r.gone + ' no longer subscribed (removed)');
    if (r.failed) parts.push(r.failed + ' refused: ' + r.errors.join('; '));
    return { text: parts.join(' · '), good: r.accepted > 0 && r.failed === 0 };
}

export default function PushTestButton() {
    const [rows, setRows] = useState<Partial<Record<TestPushKind, Row>>>({});
    const [running, setRunning] = useState(false);

    const run = async () => {
        setRunning(true);
        setRows(Object.fromEntries(TEST_PUSH_KINDS.map((k) => [k, { state: 'waiting' }])));
        for (let i = 0; i < TEST_PUSH_KINDS.length; i++) {
            const kind = TEST_PUSH_KINDS[i];
            if (i > 0) await new Promise((r) => setTimeout(r, GAP_MS));
            setRows((prev) => ({ ...prev, [kind]: { state: 'sending' } }));
            let res: any = null;
            try {
                const r = await fetch('/api/admin/push-test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ kind }),
                });
                res = await r.json().catch(() => null);
            } catch { /* shown as could not send */ }
            const d = describe(res);
            setRows((prev) => ({ ...prev, [kind]: { state: 'done', ...d } }));
        }
        setRunning(false);
    };

    return (
        <div>
            <button
                type="button"
                onClick={run}
                disabled={running}
                className="rounded-xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
                {running ? 'Sending…' : 'Send test notifications'}
            </button>

            {Object.keys(rows).length > 0 && (
                <ul className="mt-6 divide-y rounded-2xl border">
                    {TEST_PUSH_KINDS.map((k) => {
                        const row = rows[k];
                        if (!row) return null;
                        return (
                            <li key={k} className="p-4 text-sm">
                                <div className="font-semibold text-slate-900">{TEST_PUSH_LABELS[k]}</div>
                                <div className={'mt-0.5 ' + (row.state !== 'done' ? 'text-slate-500' : row.good ? 'text-emerald-800' : 'text-rose-700')}>
                                    {row.state === 'waiting' ? 'Waiting…' : row.state === 'sending' ? 'Sending…' : row.text}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
