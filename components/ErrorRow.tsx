'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';
import { ChevronDown, ChevronRight, Check } from 'lucide-react';

export default function ErrorRow({ row }: { row: any }) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [working, setWorking] = useState(false);

    const when = new Date(row.created_at);
    const isRecent = Date.now() - when.getTime() < 24 * 3600 * 1000;

    const markDone = async () => {
        setWorking(true);
        try {
            const res = await fetch('/api/errors/resolve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: row.id, resolved: !row.resolved }),
            });
            const data = await res.json();

            if (data && data.ok) {
                router.refresh();
                return;
            }
            toast.error((data && data.error) || 'Could not update that.', { theme: 'colored' });
        } catch (err) {
            toast.error('Could not update that.', { theme: 'colored' });
        }
        setWorking(false);
    };

    return (
        <div className={'border rounded-2xl p-4 ' + (row.resolved ? 'opacity-60' : '')}>
            <div className="flex items-start justify-between gap-3">
                <button
                    type="button"
                    onClick={() => setOpen(!open)}
                    className="flex items-start gap-2 text-left min-w-0 flex-1"
                >
                    {open ? (
                        <ChevronDown className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                    ) : (
                        <ChevronRight className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                    )}
                    <span className="min-w-0">
                        <span className="block font-medium text-slate-900 break-words">
                            {row.message}
                        </span>
                        <span className="block text-xs text-slate-500 mt-0.5">
                            <span
                                className={
                                    'inline-block px-1.5 py-0.5 rounded mr-2 font-semibold ' +
                                    (row.source === 'server'
                                        ? 'bg-slate-100 text-slate-700'
                                        : 'bg-blue-50 text-blue-700')
                                }
                            >
                                {row.source === 'server' ? 'Server' : 'Browser'}
                            </span>
                            {row.path && <span className="mr-2">{row.path}</span>}
                            <span className={isRecent ? 'text-red-600 font-medium' : ''}>
                                {when.toLocaleString('en-GB')}
                            </span>
                        </span>
                    </span>
                </button>

                <button
                    type="button"
                    onClick={markDone}
                    disabled={working}
                    title={row.resolved ? 'Put it back on the list' : 'Mark as dealt with'}
                    className={
                        'flex-shrink-0 w-8 h-8 rounded-full border flex items-center justify-center transition ' +
                        (row.resolved
                            ? 'text-emerald-700 border-emerald-200 bg-emerald-50'
                            : 'text-slate-400 hover:text-emerald-700 hover:border-emerald-300')
                    }
                >
                    <Check className="w-4 h-4" />
                </button>
            </div>

            {open && (
                <div className="mt-3 pt-3 border-t space-y-2 text-xs">
                    {row.detail && (
                        <pre className="whitespace-pre-wrap break-words bg-slate-50 p-3 rounded-lg text-slate-700 max-h-64 overflow-auto">
                            {row.detail}
                        </pre>
                    )}
                    {row.user_id && (
                        <div className="text-slate-500">
                            Signed in as <span className="font-mono">{row.user_id}</span>
                        </div>
                    )}
                    {!row.user_id && <div className="text-slate-500">Nobody signed in</div>}
                    {row.user_agent && (
                        <div className="text-slate-400 break-words">{row.user_agent}</div>
                    )}
                    {row.digest && (
                        <div className="text-slate-400">
                            Reference <span className="font-mono">{row.digest}</span> — this is what
                            a guest would have been shown
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
