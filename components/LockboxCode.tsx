'use client';

import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { methodNeedsCode } from '@/lib/checkInMethods';

// The door code for one listing.
//
// Saved through its own route rather than with the rest of the listing form,
// because the code does not live on `listings` at all. Five places read that
// table with select('*'), one of them the public listing page — a column there
// would end up in the page source. It lives in a table with no grants for a
// browser, and this is the only way a host reaches it.
//
// The field itself sits under the chosen access option in the "How guests get
// in" panel (CheckInMethodCard); this hook is its load and save.
export function useDoorCode(listingId: string) {
    const [code, setCode] = useState('');
    const [saved, setSaved] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

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

    const save = async (value: string) => {
        setSaving(true);
        try {
            const res = await fetch('/api/listings/access-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ listing: listingId, code: value }),
            });
            const data = await res.json();

            if (data && data.ok) {
                setSaved(data.code || '');
                setCode(data.code || '');
            } else {
                toast.error((data && data.error) || 'Could not save the code.', { theme: 'colored' });
            }
        } catch (err) {
            toast.error('Could not save the code.', { theme: 'colored' });
        }
        setSaving(false);
    };

    return { code, setCode, saved, loading, saving, save };
}

// The method no longer implies a code, but one is stored. It is not deleted:
// losing a credential as a side effect of changing a dropdown is the wrong
// instinct, and the host may be mid-way through a change. Said out loud
// instead, because a template using {lockbox_code} still works and that is
// surprising if the field has vanished.
export default function StaleDoorCode({ method, door }: {
    method?: string | null;
    door: ReturnType<typeof useDoorCode>;
}) {
    if (door.loading || methodNeedsCode(method) || !door.saved) return null;
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
                onClick={() => door.save('')}
                disabled={door.saving}
                className="mt-3 px-4 py-2 border border-amber-300 hover:border-amber-500 text-amber-900 text-sm font-semibold rounded-lg disabled:opacity-50"
            >
                {door.saving ? 'Clearing…' : 'Clear the code'}
            </button>
        </div>
    );
}
