'use client';

import { useState } from 'react';
import { KeyRound, Lock, Hash, Users, MapPin, DoorOpen } from 'lucide-react';
import { EditorCard, EditorPanel, PanelSave, saved } from '@/components/listing-editor/EditorPanel';
import StaleDoorCode, { useDoorCode } from '@/components/LockboxCode';
import { methodNeedsCode, codeLabelFor, checkInMethodTitle, isSelfCheckIn } from '@/lib/checkInMethods';

const CHECKIN_METHODS: { label: string; icon: any; note: string }[] = [
    { label: 'Lockbox', icon: KeyRound, note: 'Guests collect a key from a lockbox at the property.' },
    { label: 'Smart lock', icon: Lock, note: 'Guests let themselves in with a code on a smart lock.' },
    { label: 'Keypad', icon: Hash, note: 'A keypad on the door with a code you provide.' },
    { label: 'Host greets you', icon: Users, note: "You'll meet guests at the property to hand over keys." },
    { label: 'Keys collected nearby', icon: MapPin, note: 'Guests pick keys up from a nearby address.' },
    { label: 'Building staff', icon: DoorOpen, note: 'A concierge or building staff let guests in.' },
];

// "Self check-in · Lockbox" — the method on a raised card, the options behind
// it. The method saves with the listing; the door code (Lockbox, Smart lock,
// Keypad) saves on the panel's Save through its own route — see LockboxCode.
export default function CheckInMethodCard({ listingId, method, onChange }: {
    listingId: string;
    method: string;
    onChange: (method: string) => unknown;
}) {
    const door = useDoorCode(listingId);
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(method);
    // null until the host types: a code still loading when the panel opened
    // must never be "saved" back as blank.
    const [code, setCode] = useState<string | null>(null);

    const openPanel = () => { setDraft(method); setCode(null); setOpen(true); };

    const save = async () => {
        if (!(await saved(onChange(draft)))) return;
        if (methodNeedsCode(draft) && code !== null && code !== door.saved) door.save(code);
        setOpen(false);
    };

    const summary = !method ? 'Not set' : isSelfCheckIn(method) ? `${checkInMethodTitle(method)} · ${method}` : method;

    return (
        <>
            <EditorCard title="How guests get in" summary={summary} onClick={openPanel} />
            <StaleDoorCode method={method} door={door} />
            {open && (
                <EditorPanel title="How guests get in" onClose={() => setOpen(false)} footer={<PanelSave onClick={save} disabled={door.saving} />}>
                    <div className="space-y-3">
                        {CHECKIN_METHODS.map(({ label, icon: Icon, note }) => {
                            const selected = draft === label;
                            return (
                                <div key={label} className={`rounded-2xl border-2 transition ${selected ? 'border-slate-900' : 'border-slate-200 hover:border-slate-400'}`}>
                                    <button type="button" onClick={() => setDraft(label)} aria-pressed={selected}
                                        className="flex w-full items-start gap-3 p-4 text-left">
                                        <Icon className="mt-0.5 h-5 w-5 flex-none text-slate-700" />
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-sm font-semibold text-slate-900">{label}</span>
                                            <span className="mt-0.5 block text-xs text-slate-500">{note}</span>
                                        </span>
                                        <span className={`mt-0.5 h-5 w-5 flex-none rounded-full border-2 ${selected ? 'border-[6px] border-slate-900' : 'border-slate-300'}`} />
                                    </button>
                                    {selected && methodNeedsCode(label) && (
                                        <div className="px-4 pb-4">
                                            <label htmlFor="door-code" className="mb-1 block text-xs font-semibold text-slate-700">{codeLabelFor(label)}</label>
                                            {door.loading ? (
                                                <p className="text-sm text-slate-400">Loading…</p>
                                            ) : (
                                                <input
                                                    id="door-code"
                                                    type="text"
                                                    value={code ?? door.saved}
                                                    onChange={(e) => setCode(e.target.value)}
                                                    // Never a real code, not even as an example — a
                                                    // placeholder lands in the page source.
                                                    placeholder="Enter the code"
                                                    autoComplete="off"
                                                    className="w-full rounded-lg border border-slate-300 p-2.5 text-sm outline-none focus:border-slate-900 sm:w-48"
                                                />
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </EditorPanel>
            )}
        </>
    );
}
