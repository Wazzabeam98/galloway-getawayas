'use client';

import { useState } from 'react';
import { Star, X, ImagePlus, ChevronLeft, ChevronRight } from 'lucide-react';

export interface PhotoEditorItem {
    /** Stable key for React (the guest passes the storage path). */
    key: string;
    /** A ready-to-render image URL — the caller resolves storage paths. */
    src: string;
}

// The photo grid the host listing editor has — add, drag-to-reorder, choose the
// lead, delete — extracted so the guest sign-up screen reuses the interactions
// rather than growing a second copy. Deliberately model-agnostic: it renders
// resolved src strings and reports every action by index, so the caller keeps
// ownership of the data (the guest uploads immediately and stores paths). The
// controls are always visible rather than hover-gated, because this screen is
// used on a phone as often as a desktop. Reordering is offered two ways for the
// same reason: drag-and-drop for a mouse, and explicit move-left/right buttons on
// each tile for touch (HTML5 drag never fires on a touchscreen, so drag alone
// would leave a phone user unable to reorder at all).
//
// `leadIndex` is a plain prop, not baked in: on the guest side the lead simply
// IS the first photo (order and lead are the same thing), so onSetLead moves a
// photo to the front and leadIndex stays 0 — the instruction copy says so
// plainly rather than borrowing the host's separate-cover wording.
export function PhotoEditorGrid({
    items,
    leadIndex = 0,
    onReorder,
    onRemove,
    onSetLead,
    onAdd,
    uploading,
    addLabel = 'Add photos',
    instruction,
}: {
    items: PhotoEditorItem[];
    leadIndex?: number;
    onReorder: (from: number, to: number) => void;
    onRemove: (index: number) => void;
    onSetLead: (index: number) => void;
    onAdd: (e: React.ChangeEvent<HTMLInputElement>) => void;
    uploading?: boolean;
    addLabel?: string;
    instruction?: string;
}) {
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [overIndex, setOverIndex] = useState<number | null>(null);

    return (
        <div>
            {instruction && <p className="mb-3 text-sm text-slate-500">{instruction}</p>}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:max-w-xl">
                {items.map((item, i) => {
                    const isLead = i === leadIndex;
                    return (
                        <div
                            key={item.key}
                            draggable
                            onDragStart={() => setDragIndex(i)}
                            onDragEnter={() => { if (dragIndex !== null && dragIndex !== i) setOverIndex(i); }}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => { if (dragIndex !== null) onReorder(dragIndex, i); setDragIndex(null); setOverIndex(null); }}
                            onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
                            className={'group relative aspect-square cursor-grab overflow-hidden rounded-xl border-2 bg-slate-50 transition active:cursor-grabbing '
                                + (isLead ? 'border-emerald-600 ' : 'border-slate-200 ')
                                + (overIndex === i ? 'scale-95 ring-2 ring-slate-900 ' : '')
                                + (dragIndex === i ? 'opacity-40 ' : '')}
                        >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={item.src}
                                alt={isLead ? 'Lead photo' : `Photo ${i + 1}`}
                                className="pointer-events-none h-full w-full object-cover"
                            />

                            {/* Make-lead / lead indicator, top-left. */}
                            <button
                                type="button"
                                onClick={() => onSetLead(i)}
                                aria-label={isLead ? 'Leads your listing' : 'Make this the first photo'}
                                title={isLead ? 'Leads your listing' : 'Make this the first photo'}
                                className={'absolute left-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full shadow-sm transition '
                                    + (isLead ? 'bg-emerald-600 text-white' : 'bg-white/90 text-slate-700 hover:bg-white')}
                            >
                                <Star className="h-4 w-4" fill={isLead ? 'currentColor' : 'none'} strokeWidth={2} />
                            </button>

                            {/* Remove, top-right. */}
                            <button
                                type="button"
                                onClick={() => onRemove(i)}
                                aria-label="Remove photo"
                                className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white shadow-sm transition hover:bg-black/75"
                            >
                                <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                            </button>

                            {isLead && (
                                <span className="absolute bottom-1.5 left-1.5 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                                    Leads
                                </span>
                            )}

                            {/* Move left / right — the touch path for reordering,
                                paired with the desktop drag above. Disabled at the
                                ends rather than hidden, so the pair doesn't jump. */}
                            <div className="absolute bottom-1.5 right-1.5 flex gap-1">
                                <button
                                    type="button"
                                    onClick={() => onReorder(i, i - 1)}
                                    disabled={i === 0}
                                    aria-label="Move photo earlier"
                                    title="Move earlier"
                                    className="flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white shadow-sm transition hover:bg-black/75 disabled:cursor-not-allowed disabled:opacity-30"
                                >
                                    <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onReorder(i, i + 1)}
                                    disabled={i === items.length - 1}
                                    aria-label="Move photo later"
                                    title="Move later"
                                    className="flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white shadow-sm transition hover:bg-black/75 disabled:cursor-not-allowed disabled:opacity-30"
                                >
                                    <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
                                </button>
                            </div>
                        </div>
                    );
                })}

                {/* Add tile — the caller owns the change handler (the guest
                    compresses and uploads immediately). */}
                <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 bg-white text-center text-slate-500 transition hover:border-emerald-400">
                    <ImagePlus className="h-6 w-6 text-slate-400" strokeWidth={1.5} />
                    <span className="px-2 text-xs">{uploading ? 'Uploading…' : addLabel}</span>
                    <input type="file" accept="image/*" multiple className="sr-only" onChange={onAdd} disabled={uploading} />
                </label>
            </div>
        </div>
    );
}
