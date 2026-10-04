'use client';

import { Plus, Minus, Trash2, BedDouble, Check } from 'lucide-react';
import { BED_TYPES, deriveCounts, type Room, type Bed } from '@/lib/sleeping';
import { getImageUrl } from '@/lib/utils';

// The host enters beds room by room, the way Airbnb's editor does. The flat
// "bedrooms" and "beds" numbers are DERIVED from this (deriveCounts) and shown
// live, so a host never types a total that can drift from the rooms — the rooms
// are the single source, and the parent writes the derived counts back to
// listings.beds / listings.bedrooms on save.
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

export default function SleepingArrangementsEditor({
    rooms,
    onChange,
    photos = [],
}: {
    rooms: Room[];
    onChange: (rooms: Room[]) => void;
    // The listing's own photos (image paths) the host can choose from for each
    // room, Airbnb-style. Empty while a brand-new listing has none saved yet.
    photos?: string[];
}) {
    const counts = deriveCounts(rooms);

    const update = (next: Room[]) => onChange(renumberBedrooms(next));

    const addRoom = (kind: 'bedroom' | 'common') => {
        const room: Room =
            kind === 'bedroom'
                ? { label: '', kind, beds: [{ type: 'Double bed', count: 1 }] }
                : { label: 'Living room', kind, beds: [{ type: 'Sofa bed', count: 1 }] };
        update([...rooms, room]);
    };

    const removeRoom = (i: number) => update(rooms.filter((_, idx) => idx !== i));

    const setCommonLabel = (i: number, label: string) =>
        update(rooms.map((r, idx) => (idx === i ? { ...r, label } : r)));

    const setRoomPhoto = (i: number, photo: string | null) =>
        update(rooms.map((r, idx) => (idx === i ? { ...r, photo } : r)));

    const addBed = (roomIdx: number) => {
        // Default to a type not already in the room, so a second line is a new
        // bed rather than a duplicate of the first.
        const used = new Set((rooms[roomIdx].beds || []).map((b) => b.type));
        const nextType = BED_TYPES.find((t) => !used.has(t)) || BED_TYPES[0];
        const next = rooms.map((r, idx) =>
            idx === roomIdx ? { ...r, beds: [...r.beds, { type: nextType, count: 1 }] } : r
        );
        update(next);
    };

    const setBed = (roomIdx: number, bedIdx: number, patch: Partial<Bed>) => {
        const next = rooms.map((r, idx) => {
            if (idx !== roomIdx) return r;
            return { ...r, beds: r.beds.map((b, bi) => (bi === bedIdx ? { ...b, ...patch } : b)) };
        });
        update(next);
    };

    const removeBed = (roomIdx: number, bedIdx: number) => {
        const next = rooms.map((r, idx) =>
            idx === roomIdx ? { ...r, beds: r.beds.filter((_, bi) => bi !== bedIdx) } : r
        );
        update(next);
    };

    return (
        <div>
            <div className="flex items-center justify-between">
                <label className="block text-sm font-semibold text-slate-800">Sleeping arrangements</label>
                <span className="text-sm text-slate-500">
                    {counts.bedrooms} bedroom{counts.bedrooms === 1 ? '' : 's'} ·{' '}
                    {counts.beds} bed{counts.beds === 1 ? '' : 's'}
                </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
                Add the beds in each room. The bedroom and bed totals above are worked out from
                these, so you don&apos;t enter them twice.
            </p>

            <div className="mt-3 space-y-3">
                {rooms.map((room, roomIdx) => (
                    <div key={roomIdx} className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                                <BedDouble className="h-4 w-4 flex-none text-slate-500" />
                                {room.kind === 'common' ? (
                                    <input
                                        type="text"
                                        value={room.label}
                                        onChange={(e) => setCommonLabel(roomIdx, e.target.value)}
                                        placeholder="Living room"
                                        maxLength={40}
                                        className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm font-semibold text-slate-900 focus:border-slate-400 focus:outline-none"
                                    />
                                ) : (
                                    <span className="font-semibold text-slate-900">{room.label || 'Bedroom'}</span>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={() => removeRoom(roomIdx)}
                                className="flex-none text-slate-400 hover:text-rose-600"
                                aria-label="Remove room"
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </div>

                        <div className="mt-3 space-y-2">
                            {room.beds.map((bed, bedIdx) => (
                                <div key={bedIdx} className="flex items-center gap-2">
                                    <select
                                        value={bed.type}
                                        onChange={(e) => setBed(roomIdx, bedIdx, { type: e.target.value })}
                                        className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-800 focus:border-slate-400 focus:outline-none"
                                    >
                                        {BED_TYPES.map((t) => (
                                            <option key={t} value={t}>
                                                {t}
                                            </option>
                                        ))}
                                    </select>
                                    <div className="flex items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={() => setBed(roomIdx, bedIdx, { count: Math.max(1, bed.count - 1) })}
                                            className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-slate-600 hover:border-slate-400 disabled:opacity-40"
                                            disabled={bed.count <= 1}
                                            aria-label="Fewer"
                                        >
                                            <Minus className="h-4 w-4" />
                                        </button>
                                        <span className="w-6 text-center text-sm font-medium text-slate-800">
                                            {bed.count}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setBed(roomIdx, bedIdx, { count: Math.min(16, bed.count + 1) })}
                                            className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-slate-600 hover:border-slate-400"
                                            aria-label="More"
                                        >
                                            <Plus className="h-4 w-4" />
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => removeBed(roomIdx, bedIdx)}
                                        className="flex-none text-slate-400 hover:text-rose-600"
                                        aria-label="Remove bed"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            ))}
                        </div>

                        <button
                            type="button"
                            onClick={() => addBed(roomIdx)}
                            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-slate-600 underline hover:text-slate-800"
                        >
                            <Plus className="h-3.5 w-3.5" /> Add a bed
                        </button>

                        {photos.length > 0 && (
                            <div className="mt-4 border-t border-slate-100 pt-3">
                                <div className="mb-2 text-xs font-semibold text-slate-700">
                                    Room photo <span className="font-normal text-slate-400">(optional)</span>
                                </div>
                                <div className="flex gap-2 overflow-x-auto pb-1">
                                    <button
                                        type="button"
                                        onClick={() => setRoomPhoto(roomIdx, null)}
                                        aria-label="No photo"
                                        className={`flex h-14 w-14 flex-none items-center justify-center rounded-lg border-2 ${!room.photo ? 'border-slate-900 bg-slate-50' : 'border-slate-200'}`}
                                    >
                                        <BedDouble className="h-5 w-5 text-slate-400" />
                                    </button>
                                    {photos.map((p) => {
                                        const on = room.photo === p;
                                        return (
                                            <button
                                                key={p}
                                                type="button"
                                                onClick={() => setRoomPhoto(roomIdx, p)}
                                                aria-label="Use this photo"
                                                className={`relative h-14 w-14 flex-none overflow-hidden rounded-lg border-2 ${on ? 'border-slate-900' : 'border-slate-200'}`}
                                            >
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
                    </div>
                ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={() => addRoom('bedroom')}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-400"
                >
                    <Plus className="h-4 w-4" /> Add bedroom
                </button>
                <button
                    type="button"
                    onClick={() => addRoom('common')}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-400"
                >
                    <Plus className="h-4 w-4" /> Add common space
                </button>
            </div>
        </div>
    );
}
