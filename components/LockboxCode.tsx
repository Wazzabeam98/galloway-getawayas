'use client';

import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { methodNeedsCode } from '@/lib/checkInMethods';
import {
    CODE_RELEASE_CHOICES,
    DEFAULT_CODE_RELEASE_HOURS,
    MAX_CODE_RELEASE_HOURS,
    normaliseReleaseHours,
    normaliseReleaseAtTime,
} from '@/lib/bookingWindows';

// The one setting the control reads and writes: hours before check-in, OR an
// absolute time on the check-in day that overrides it. Mirrors
// CodeReleaseSetting on the server.
export interface ReleaseSetting {
    releaseHours: number;
    releaseAtTime: string | null;
}

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
    // When this code is released to the guest — the host's own choice, saved on
    // the same row as the code. Either a number of hours before check-in
    // (0 = at check-in time) or an absolute time on the check-in day that
    // overrides the hours.
    const [releaseHours, setReleaseHours] = useState<number>(DEFAULT_CODE_RELEASE_HOURS);
    const [releaseAtTime, setReleaseAtTime] = useState<string | null>(null);
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
                    setReleaseAtTime(normaliseReleaseAtTime(data.release_at_time));
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
    // which is the right behaviour: no code, nothing to time. A release setting
    // passed in wins; otherwise the current one rides along.
    const save = async (value: string, release?: ReleaseSetting) => {
        const setting: ReleaseSetting = release || { releaseHours, releaseAtTime };
        setSaving(true);
        try {
            const res = await fetch('/api/listings/access-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    listing: listingId,
                    code: value,
                    release_hours: setting.releaseHours,
                    release_at_time: setting.releaseAtTime,
                }),
            });
            const data = await res.json();

            if (data && data.ok) {
                setSaved(data.code || '');
                setCode(data.code || '');
                if (data.code) {
                    setReleaseHours(normaliseReleaseHours(data.release_hours));
                    setReleaseAtTime(normaliseReleaseAtTime(data.release_at_time));
                }
            } else {
                toast.error((data && data.error) || 'Could not save the code.', { theme: 'colored' });
            }
        } catch (err) {
            toast.error('Could not save the code.', { theme: 'colored' });
        }
        setSaving(false);
    };

    return { code, setCode, saved, releaseHours, setReleaseHours, releaseAtTime, setReleaseAtTime, loading, saving, save };
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
    const disabled = !hasCode || door.saving;

    const PRESET_HOURS = CODE_RELEASE_CHOICES.map((c) => c.hours);
    // The whole control is derived from the saved setting — there is no separate
    // local draft that could drift from what is stored (the trap that makes a
    // calendar tab show a value it never saved). "Custom" is whatever the five
    // presets and "at check-in time" do not cover: an absolute time, or an
    // hours-before value that is not one of the presets.
    const isCustom = door.releaseAtTime !== null
        || (door.releaseHours !== 0 && PRESET_HOURS.indexOf(door.releaseHours) === -1);
    const selectValue = isCustom
        ? 'custom'
        : door.releaseHours === 0 ? 'checkin' : 'h:' + door.releaseHours;
    // Within custom: an absolute time means "on the day"; otherwise "N hours".
    const customMode: 'onday' | 'hours' = door.releaseAtTime !== null ? 'onday' : 'hours';
    // A native time input reads back 'HH:MM'; the stored value is 'HH:MM:SS'.
    const timeValue = (door.releaseAtTime || '08:00').slice(0, 5);
    // The "N hours before" field keeps a real custom value, but seeds to a
    // non-preset default (6) otherwise — a preset value would read as identical
    // to the preset and collapse the panel, so the host could never type one.
    const customHours = door.releaseHours > 0 && PRESET_HOURS.indexOf(door.releaseHours) === -1
        ? door.releaseHours : 6;
    const hoursValue = customMode === 'hours' ? (door.releaseHours > 0 ? door.releaseHours : 6) : customHours;

    const onSelect = (value: string) => {
        if (value === 'custom') {
            // Seed the headline custom shape — a time on the check-in day — so
            // the choice is meaningful the instant it is picked. The host can
            // flip to "hours before" or change the time from there.
            door.save(door.saved, { releaseHours: door.releaseHours, releaseAtTime: '08:00:00' });
        } else if (value === 'checkin') {
            door.save(door.saved, { releaseHours: 0, releaseAtTime: null });
        } else {
            door.save(door.saved, { releaseHours: normaliseReleaseHours(value.slice(2)), releaseAtTime: null });
        }
    };

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
                value={selectValue}
                disabled={disabled}
                onChange={(e) => onSelect(e.target.value)}
                className="w-full sm:w-72 border border-slate-300 rounded-lg p-2.5 text-sm bg-white disabled:opacity-50 disabled:cursor-not-allowed focus-visible:border-slate-900 focus-visible:outline-none"
            >
                {CODE_RELEASE_CHOICES.map((c) => (
                    <option key={c.hours} value={'h:' + c.hours}>{c.label}</option>
                ))}
                <option value="checkin">At check-in time</option>
                <option value="custom">Custom…</option>
            </select>

            {isCustom && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2.5">
                    <label className="flex items-start gap-2 text-sm text-slate-800">
                        <input
                            type="radio"
                            name="code-release-custom"
                            className="mt-0.5"
                            checked={customMode === 'onday'}
                            disabled={disabled}
                            onChange={() => door.save(door.saved, {
                                releaseHours: door.releaseHours,
                                releaseAtTime: normaliseReleaseAtTime(timeValue) || '08:00:00',
                            })}
                        />
                        <span className="flex flex-wrap items-center gap-2">
                            On the day of check-in at
                            <input
                                type="time"
                                value={timeValue}
                                disabled={disabled || customMode !== 'onday'}
                                onChange={(e) => {
                                    const t = normaliseReleaseAtTime(e.target.value);
                                    if (t) door.save(door.saved, { releaseHours: door.releaseHours, releaseAtTime: t });
                                }}
                                className="border border-slate-300 rounded-md px-2 py-1 text-sm bg-white disabled:opacity-50 focus-visible:border-slate-900 focus-visible:outline-none"
                            />
                        </span>
                    </label>

                    <label className="flex items-start gap-2 text-sm text-slate-800">
                        <input
                            type="radio"
                            name="code-release-custom"
                            className="mt-0.5"
                            checked={customMode === 'hours'}
                            disabled={disabled}
                            onChange={() => door.save(door.saved, {
                                releaseHours: customHours,
                                releaseAtTime: null,
                            })}
                        />
                        <span className="flex flex-wrap items-center gap-2">
                            <input
                                type="number"
                                min={1}
                                max={MAX_CODE_RELEASE_HOURS}
                                value={hoursValue}
                                disabled={disabled || customMode !== 'hours'}
                                onChange={(e) => {
                                    const n = Math.min(Math.max(1, Math.round(Number(e.target.value) || 0)), MAX_CODE_RELEASE_HOURS);
                                    door.save(door.saved, { releaseHours: n, releaseAtTime: null });
                                }}
                                className="w-20 border border-slate-300 rounded-md px-2 py-1 text-sm bg-white disabled:opacity-50 focus-visible:border-slate-900 focus-visible:outline-none"
                            />
                            hours before check-in
                        </span>
                    </label>
                </div>
            )}

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
