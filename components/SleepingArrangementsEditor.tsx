'use client';

import { useState } from 'react';
import { Plus, BedDouble, Check, ChevronRight } from 'lucide-react';
import { BED_TYPES, bedSummary, bedsLeftToPlace, deriveCounts, type Room, type Bed } from '@/lib/sleeping';
import { getImageUrl } from '@/lib/utils';
import { EditorCard, EditorPanel, PanelSave, saved } from '@/components/listing-editor/EditorPanel';
import { NumberStepper, bigFieldCls } from '@/components/services/wizardKit';

// Sleeping arrangements, Airbnb's way: a raised card with the first three
// rooms, which opens the rooms as cards; a room opens its bed-type counters.
// The listing's total bed count caps the counters — once every bed is placed
// in a room, every + greys out. The bedroom count is derived from the rooms
// (deriveCounts) and the parent writes it back on save.
//
// Controlled: the parent owns the rooms array. Bedroom cards are auto-numbered
// (Bedroom 1, 2, …) and renumbered on every change; a common space (a sofa bed
// in the living room) keeps the name the host gives it.

function renumberBedrooms(rooms: Room[]): Room[] {
    let n = 0;
    return rooms.map((r) => {
        if (r.kind === 'bedroom') {
            n += 1;
            return { ...r, label: `Bedroom ${n}` };
        }
        return r;
    });
}

function plural(n: number, word: string) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function RoomThumb({ room, className }: { room: Room; className: string }) {
    return room.photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={getImageUrl(room.photo)} alt="" className={`${className} object-cover`} />
    ) : (
        <div className={`${className} flex items-center justify-center bg-slate-100`}>
            <BedDouble className="h-6 w-6 text-slate-400" />
        </div>
    );
}

export default function SleepingArrangementsEditor({
    rooms,
    onChange,
    photos = [],
    totalBeds,
}: {
    rooms: Room[];
    // The editor writes the listing here; false means it didn't go through,
    // and the room's sheet stays open.
    onChange: (rooms: Room[]) => unknown;
    // The listing's own photos (image paths) the host can choose from for each
    // room, Airbnb-style. Empty while a brand-new listing has none saved yet.
    photos?: string[];
    // listings.beds — the most beds that can be placed across the rooms.
    totalBeds: number;
}) {
    const [open, setOpen] = useState(false);
    // The room being edited, as a draft: Cancel throws it away, Done keeps it.
    // index null is a room being added.
    const [editing, setEditing] = useState<{ index: number | null; room: Room } | null>(null);

    const counts = deriveCounts(rooms);
    const update = (next: Room[]) => onChange(renumberBedrooms(next));

    const startNew = (kind: 'bedroom' | 'common') =>
        setEditing({ index: null, room: kind === 'bedroom' ? { label: 'New bedroom', kind, beds: [] } : { label: 'Living room', kind, beds: [] } });

    const done = async () => {
        if (!editing) return;
        const room = { ...editing.room, beds: editing.room.beds.filter((b) => b.count > 0) };
        if (!(await saved(update(editing.index === null ? [...rooms, room] : rooms.map((r, i) => (i === editing.index ? room : r)))))) return;
        setEditing(null);
    };

    const removeRoom = async () => {
        if (!editing || editing.index === null) return;
        if (!(await saved(update(rooms.filter((_, i) => i !== editing.index))))) return;
        setEditing(null);
    };

    const summary = `${plural(counts.bedrooms, 'bedroom')} · ${plural(counts.beds, 'bed')}`;
    // Two across on a phone, three from md up; "+N more" counts what's hidden.
    const shown = rooms.slice(0, 3);
    const morePhone = rooms.length - Math.min(rooms.length, 2);
    const moreWide = rooms.length - shown.length;

    return (
        <div>
            <EditorCard title="Sleeping arrangements" summary={summary} onClick={() => setOpen(true)}>
                {shown.length > 0 && (
                    <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3">
                        {shown.map((room, i) => (
                            <div key={i} className={`min-w-0 ${i === 2 ? 'hidden md:block' : ''}`}>
                                <RoomThumb room={room} className="aspect-[4/3] w-full rounded-xl" />
                                <div className="mt-1.5 truncate text-sm font-semibold text-slate-900">{room.label || 'Bedroom'}</div>
                                <div className="truncate text-xs text-slate-500">{bedSummary(room.beds)}</div>
                            </div>
                        ))}
                    </div>
                )}
                {morePhone > 0 && <div className="mt-3 text-sm font-semibold text-slate-700 md:hidden">+{morePhone} more</div>}
                {moreWide > 0 && <div className="mt-3 hidden text-sm font-semibold text-slate-700 md:block">+{moreWide} more</div>}
            </EditorCard>

            {open && !editing && (
                // Each room saves on its own screen, so this list has no Save — the X closes it.
                <EditorPanel title="Where do guests sleep?" onClose={() => setOpen(false)}>
                    {/* Kept: the cap on beds isn't guessable. */}
                    <p className="mb-4 text-base text-slate-600">{counts.beds} of {plural(totalBeds, 'bed')} placed</p>
                    <div className="space-y-3">
                        {rooms.map((room, i) => (
                            <button key={i} type="button" onClick={() => setEditing({ index: i, room: { ...room, beds: room.beds.map((b) => ({ ...b })) } })}
                                className="flex w-full items-center gap-4 rounded-2xl border-2 border-slate-200 p-4 text-left hover:border-slate-300">
                                <RoomThumb room={room} className="h-14 w-14 flex-none rounded-lg" />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-base font-semibold text-slate-900">{room.label || 'Bedroom'}</span>
                                    <span className="block truncate text-sm text-slate-500">{bedSummary(room.beds)}</span>
                                </span>
                                <ChevronRight className="h-5 w-5 flex-none text-slate-400" />
                            </button>
                        ))}
                    </div>
                    {/* Every bed placed: nothing left to put in a new room. */}
                    {bedsLeftToPlace(totalBeds, rooms) > 0 && (
                    <div className="mt-5 flex flex-wrap gap-3">
                        <button type="button" onClick={() => startNew('bedroom')}
                            className="inline-flex items-center gap-1.5 rounded-full border-2 border-slate-200 px-4 py-2.5 text-base font-semibold text-slate-800 hover:border-slate-300">
                            <Plus className="h-4 w-4" /> Add bedroom
                        </button>
                        <button type="button" onClick={() => startNew('common')}
                            className="inline-flex items-center gap-1.5 rounded-full border-2 border-slate-200 px-4 py-2.5 text-base font-semibold text-slate-800 hover:border-slate-300">
                            <Plus className="h-4 w-4" /> Add common space
                        </button>
                    </div>
                    )}
                </EditorPanel>
            )}

            {editing && (
                <RoomPanel
                    draft={editing.room}
                    setDraft={(room) => setEditing({ ...editing, room })}
                    left={bedsLeftToPlace(totalBeds, [...rooms.filter((_, i) => i !== editing.index), editing.room])}
                    photos={photos}
                    isNew={editing.index === null}
                    onCancel={() => setEditing(null)}
                    onDone={done}
                    onRemove={removeRoom}
                />
            )}
        </div>
    );
}

function RoomPanel({ draft, setDraft, left, photos, isNew, onCancel, onDone, onRemove }: {
    draft: Room;
    setDraft: (room: Room) => void;
    left: number;
    photos: string[];
    isNew: boolean;
    onCancel: () => void;
    onDone: () => Promise<void>;
    onRemove: () => Promise<void>;
}) {
    // Every bed type as a counter, plus any older type a room already holds.
    const types = [...BED_TYPES, ...draft.beds.map((b) => b.type).filter((t) => !BED_TYPES.includes(t))];
    const countOf = (type: string) => draft.beds.find((b) => b.type === type)?.count || 0;
    // Save and Remove write the listing; one at a time, "Saving…" meanwhile.
    const [busy, setBusy] = useState(false);
    const run = async (action: () => Promise<void>) => {
        if (busy) return;
        setBusy(true);
        try { await action(); } finally { setBusy(false); }
    };

    const setCount = (type: string, count: number) => {
        const has = draft.beds.some((b) => b.type === type);
        const beds: Bed[] = has
            ? draft.beds.map((b) => (b.type === type ? { ...b, count } : b))
            : [...draft.beds, { type, count }];
        setDraft({ ...draft, beds });
    };

    return (
        <EditorPanel
            title={draft.kind === 'common' ? 'What’s in this space?' : `What beds are in ${isNew ? 'this bedroom' : draft.label}?`}
            onClose={onCancel}
            footer={<PanelSave onClick={() => run(onDone)} disabled={busy} />}
        >
            {draft.kind === 'common' && (
                <div className="mb-4">
                    <label htmlFor="room-name" className="block text-base font-semibold text-slate-800">Room name</label>
                    <input id="room-name" type="text" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                        placeholder="Living room" maxLength={40} className={bigFieldCls} />
                </div>
            )}

            <div className="divide-y divide-slate-100">
                {types.map((type) => {
                    const n = countOf(type);
                    return (
                        <div key={type} className="flex items-center justify-between gap-3 py-3" role="group" aria-label={type}>
                            <span className="text-base font-medium text-slate-800">{type}</span>
                            {/* The cap: + stops once every bed is placed (or at 16). */}
                            <NumberStepper value={String(n)} min={0} max={Math.min(16, n + Math.max(0, left))} solid
                                onChange={(v) => setCount(type, Math.max(0, Math.min(16, n + Math.max(0, left), Number(v) || 0)))} />
                        </div>
                    );
                })}
            </div>

            {photos.length > 0 && (
                <div className="mt-5 border-t border-slate-100 pt-4">
                    <div className="mb-2 text-base font-semibold text-slate-800">
                        Room photo <span className="font-normal text-slate-500">(optional)</span>
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                        <button type="button" onClick={() => setDraft({ ...draft, photo: null })} aria-label="No photo"
                            className={`flex h-14 w-14 flex-none items-center justify-center rounded-lg border-2 ${!draft.photo ? 'border-slate-900 bg-slate-50' : 'border-slate-200'}`}>
                            <BedDouble className="h-5 w-5 text-slate-400" />
                        </button>
                        {photos.map((p) => {
                            const on = draft.photo === p;
                            return (
                                <button key={p} type="button" onClick={() => setDraft({ ...draft, photo: p })} aria-label="Use this photo"
                                    className={`relative h-14 w-14 flex-none overflow-hidden rounded-lg border-2 ${on ? 'border-slate-900' : 'border-slate-200'}`}>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={getImageUrl(p)} alt="" className="h-full w-full object-cover" />
                                    {on && (
                                        <span className="absolute inset-0 flex items-center justify-center bg-black/30">
                                            <Check className="h-4 w-4 text-white" />
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {!isNew && (
                <button type="button" onClick={() => run(onRemove)} disabled={busy} className="mt-5 text-sm font-semibold text-rose-600 underline">
                    Remove room
                </button>
            )}
        </EditorPanel>
    );
}
