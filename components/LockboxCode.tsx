'use client';

import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { methodNeedsCode } from '@/lib/checkInMethods';
import { CODE_RELEASE_CHOICES, DEFAULT_CODE_RELEASE_HOURS, normaliseReleaseHours } from '@/lib/bookingWindows';

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
    // How long before check-in this code is released to the guest — the host's
    // own choice, saved on the same row as the code.
    const [releaseHours, setReleaseHours] = useState<number>(DEFAULT_CODE_RELEASE_HOURS);
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
                    setReleaseHours(normaliseReleaseHours(data.release_hours));
                }
            } catch (err) {
                // An unreachable code field is not worth a toast on page load.
            }
            if (!cancelled) setLoading(false);
        };

        load();
        return () => { cancelled = true; };
    }, [listingId]);

    // Saves the code and its release window together, because they share a row —
    // clearing the code (empty value) removes the row and the window with it,
    // which is the right behaviour: no code, nothing to time.
    const save = async (value: string, release: number = releaseHours) => {
        setSaving(true);
        try {
            const res = await fetch('/api/listings/access-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ listing: listingId, code: value, release_hours: release }),
            });
            const data = await res.json();

            if (data && data.ok) {
                setSaved(data.code || '');
                setCode(data.code || '');
                if (data.code) setReleaseHours(normaliseReleaseHours(data.release_hours));
            } else {
                toast.error((data && data.error) || 'Could not save the code.', { theme: 'colored' });
            }
        } catch (err) {
            toast.error('Could not save the code.', { theme: 'colored' });
        }
        setSaving(false);
    };

    return { code, setCode, saved, releaseHours, setReleaseHours, loading, saving, save };
}

// When the code is handed to the guest — the host's choice, defaulting to 24
// hours before check-in. The same window governs the guest's reservation card
// and the scheduled check-in message, so they can never hand the code over at
// different moments. Only meaningful once a code exists, so it waits for one.
export function DoorCodeRelease({ door }: { door: ReturnType<typeof useDoorCode> }) {
    if (door.loading) return null;
    // Keyed off the SAVED code, not an in-progress edit: the window applies to
    // the code that is actually stored.
    const hasCode = !!door.saved.trim();
    return (
        <div className="mt-4">
            <label htmlFor="code-release" className="block text-sm font-medium text-slate-800">
                When should the guest get this code?
            </label>
            <p className="text-xs text-slate-500 mt-0.5 mb-2">
                It appears on their reservation and in their check-in message at the same moment —
                not before. Your call; it&rsquo;s your security.
            </p>
            <select
                id="code-release"
                value={door.releaseHours}
                disabled={!hasCode || door.saving}
                onChange={(e) => {
                    const next = normaliseReleaseHours(e.target.value);
                    door.setReleaseHours(next);
                    // Persist with the code that is actually stored on the row.
                    door.save(door.saved, next);
                }}
                className="w-full sm:w-72 border border-slate-300 rounded-lg p-2.5 text-sm bg-white disabled:opacity-50 disabled:cursor-not-allowed focus-visible:border-slate-900 focus-visible:outline-none"
            >
                {CODE_RELEASE_CHOICES.map((c) => (
                    <option key={c.hours} value={c.hours}>{c.label}</option>
                ))}
            </select>
            {!hasCode && (
                <p className="text-xs text-slate-400 mt-1.5">Set a code above first, then choose when it&rsquo;s released.</p>
            )}
        </div>
    );
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
