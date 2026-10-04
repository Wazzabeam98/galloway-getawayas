'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Undo2 } from 'lucide-react';
import { toast } from 'react-toastify';

// The Reactivate button on /admin/accounts. Built like the take-down buttons
// (AdminProviderTakedown, AdminListingRow): a confirm that says what will happen,
// a reason that goes in admin_actions against your name.
export default function AdminReactivateAccount({ userId, name, listings, providers, takenDownByUs }: {
    userId: string;
    name: string;
    listings: string[];      // listings the deactivation hid — they stay hidden
    providers: string[];     // experiences/trades it hid — they come back paused
    takenDownByUs: string[]; // our own take-downs, which reactivation leaves alone
}) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState('');
    const [working, setWorking] = useState(false);

    const down = [...listings, ...providers];

    const apply = async () => {
        setWorking(true);
        const res = await fetch('/api/admin/account/reactivate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, reason }),
        });
        const data = await res.json().catch(() => null);
        setWorking(false);

        if (!data || !data.ok) {
            toast.error((data && data.error) || 'Could not reactivate that account.', { theme: 'colored' });
            return;
        }
        setOpen(false);
        setReason('');
        if (data.warning) toast.warning(data.warning, { theme: 'colored' });
        toast.success(
            'Reactivated.' + (data.emailed ? ' They’ve been emailed.' : ' The email didn’t go — let them know yourself.'),
            { theme: 'colored' }
        );
        router.refresh();
    };

    return (
        <div className="mt-3">
            <button
                type="button"
                onClick={() => setOpen(true)}
                disabled={working}
                className="h-8 px-3 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white disabled:opacity-50"
            >
                <Undo2 className="w-3.5 h-3.5" /> Reactivate
            </button>

            {open && (
                <div
                    className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
                    onClick={() => !working && setOpen(false)}
                >
                    <div className="bg-white rounded-2xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
                        <h3 className="font-bold text-slate-900 mb-2">Reactivate {name}?</h3>

                        <ul className="text-sm text-slate-600 mb-3 list-disc pl-5 space-y-1">
                            <li>They can sign in again, and we email them to say so.</li>
                            {down.length > 0 ? (
                                <li>
                                    {down.join(', ')} {down.length === 1 ? 'stays' : 'stay'} off the site. They put{' '}
                                    {down.length === 1 ? 'it' : 'each one'} back up themselves from their dashboard.
                                </li>
                            ) : (
                                <li>They had nothing listed when they left.</li>
                            )}
                            {providers.length > 0 && (
                                <li>A cancelled trade subscription isn’t restarted. They’re sent the card link again, the same as after a Relist.</li>
                            )}
                        </ul>

                        {takenDownByUs.length > 0 && (
                            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
                                {takenDownByUs.join(', ')} {takenDownByUs.length === 1 ? 'was' : 'were'} taken down by an admin.
                                Reactivating doesn’t change that — relist it from Tradesmen and businesses if it should come back.
                            </p>
                        )}

                        <label className="text-xs font-semibold text-slate-700">
                            Why? This is recorded against your name.
                        </label>
                        <textarea
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            rows={3}
                            autoFocus
                            placeholder="e.g. Emailed asking to come back"
                            className="w-full p-2.5 border rounded-lg text-sm mt-1 mb-4"
                        />

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={apply}
                                disabled={working || reason.trim().length < 3}
                                className="px-4 py-2 bg-slate-900 hover:bg-black text-white text-sm font-semibold rounded-xl disabled:opacity-40"
                            >
                                {working ? 'Saving…' : 'Reactivate'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                disabled={working}
                                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
