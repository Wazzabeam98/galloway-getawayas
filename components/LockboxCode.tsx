'use client';

import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { KeyRound } from 'lucide-react';
import { methodNeedsCode, codeHintFor } from '@/lib/checkInMethods';

// The door code for one listing.
//
// Saved through its own route rather than with the rest of the listing form,
// because the code does not live on `listings` at all. Five places read that
// table with select('*'), one of them the public listing page — a column there
// would end up in the page source. It lives in a table with no grants for a
// browser, and this is the only way a host reaches it.
//
// Deliberately not part of the big Save at the bottom of the page: a host
// changing a door code between guests should not have to save the whole
// listing, and should get a plain yes or no that it took.
export default function LockboxCode({
    listingId,
    method,
}: {
    listingId: string;
    // The check-in method as currently chosen in the form — not as saved, so
    // the field appears the moment somebody picks Lockbox rather than after
    // they save and come back.
    method?: string | null;
}) {
    const [code, setCode] = useState('');
    const [saved, setSaved] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [show, setShow] = useState(false);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            try {
                const res = await fetch('/api/listings/access-code?listing=' + listingId);
                const data = await res.json();
                if (!cancelled && data && data.ok) {
                    setCode(data.code || '');
                    setSaved(data.code || '');
                }
            } catch (err) {
                // An unreachable code field is not worth a toast on page load.
            }
            if (!cancelled) setLoading(false);
        };

        load();
        return () => { cancelled = true; };
    }, [listingId]);

    const save = async () => {
        setSaving(true);
        try {
            const res = await fetch('/api/listings/access-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ listing: listingId, code: code }),
            });
            const data = await res.json();

            if (data && data.ok) {
                setSaved(data.code || '');
                toast.success(data.code ? 'Door code saved.' : 'Door code cleared.', { theme: 'colored' });
            } else {
                toast.error((data && data.error) || 'Could not save the code.', { theme: 'colored' });
            }
        } catch (err) {
            toast.error('Could not save the code.', { theme: 'colored' });
        }
        setSaving(false);
    };

    if (loading) {
        return <p className="text-sm text-slate-400 mt-2">Checking the door code…</p>;
    }

    // The method no longer implies a code, but one is stored. It is not
    // deleted: losing a credential as a side effect of changing a dropdown is
    // the wrong instinct, and the host may be mid-way through a change. Said
    // out loud instead, because a template using {lockbox_code} still works
    // and that is surprising if the field has vanished.
    if (!methodNeedsCode(method)) {
        if (!saved) return null;
        return (
            <div className="mt-6 border border-amber-200 bg-amber-50 rounded-xl p-4">
                <div className="text-sm font-semibold text-amber-900">
                    A door code is still saved for this property
                </div>
                <p className="text-sm text-amber-800 mt-1">
                    Your check-in method no longer involves a code, but one is stored and any
                    message using {'{lockbox_code}'} will still send it. Clear it if it should
                    not be used.
                </p>
                <button
                    type="button"
                    onClick={() => { setCode(''); save(); }}
                    disabled={saving}
                    className="mt-3 px-4 py-2 border border-amber-300 hover:border-amber-500 text-amber-900 text-sm font-semibold rounded-lg disabled:opacity-50"
                >
                    {saving ? 'Clearing…' : 'Clear the code'}
                </button>
            </div>
        );
    }

    return (
        <div className="mt-8">
            <h3 className="font-semibold text-slate-800 mb-1 flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-slate-500" />
                Door code
            </h3>
            <p className="text-sm text-slate-600 mb-1">{codeHintFor(method)}</p>
            <p className="text-sm text-slate-500 mb-3">
                Used by <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">{'{lockbox_code}'}</code>{' '}
                in your check-in message, so the right code goes to each property. It is never shown
                on your listing and never reaches a guest except in that message.
            </p>

            <div className="flex flex-wrap items-center gap-2">
                <input
                    type={show ? 'text' : 'password'}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    // Never a real code, not even as an example. This used to
                    // show one, lifted from a host's own template while writing
                    // the field — which put a live door code into the page
                    // source of the listing editor. Including it in the comment
                    // explaining the fix would have done exactly the same.
                    placeholder="Enter the code"
                    autoComplete="off"
                    className="w-40 border rounded-lg p-2 text-sm outline-none focus:border-slate-900"
                />
                <button
                    type="button"
                    onClick={() => setShow(!show)}
                    className="text-sm text-slate-500 hover:text-slate-900 px-2"
                >
                    {show ? 'Hide' : 'Show'}
                </button>
                <button
                    type="button"
                    onClick={save}
                    disabled={saving || code === saved}
                    className="px-4 py-2 bg-slate-900 hover:bg-black text-white text-sm font-semibold rounded-lg disabled:opacity-40"
                >
                    {saving ? 'Saving…' : 'Save code'}
                </button>
            </div>

            {!saved && (
                <p className="text-xs text-amber-700 mt-2">
                    No code set. If your check-in message uses {'{lockbox_code}'}, it will be held
                    back rather than sent with a gap in it.
                </p>
            )}

            {/* Why the field beats typing the code into a message by hand. A code
                that lives here is read live on each guest's arrival screen, so
                changing it updates everyone at once; a code typed into a message
                is frozen the moment it sends. */}
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-xs text-emerald-900">
                    <span className="font-semibold">Keep the code here, not in a message.</span> A code
                    in this field shows on each guest&apos;s arrival screen, so if you change the
                    lock, every guest sees the new code the moment you save it. A code typed straight
                    into a message can&apos;t be taken back — change the lock and that guest is left
                    with the old one in their thread, and nothing tells them it&apos;s wrong.
                </p>
            </div>

            <p className="text-xs text-slate-400 mt-2">
                Change it between guests whenever you like — the arrival screen always shows the
                current one.
            </p>
        </div>
    );
}
