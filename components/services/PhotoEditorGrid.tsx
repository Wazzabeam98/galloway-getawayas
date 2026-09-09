'use client';

import { useEffect, useRef, useState } from 'react';
import { X, ImagePlus } from 'lucide-react';

export interface PhotoEditorItem {
    /** Stable key for React and for tracking the dragged item across reorders
     *  (the guest passes the storage path). */
    key: string;
    /** A ready-to-render image URL — the caller resolves storage paths. */
    src: string;
}

// The photo grid the host listing editor has — add, reorder, delete — extracted
// so the guest sign-up screen reuses the interactions rather than growing a
// second copy. Model-agnostic: it renders resolved src strings and reports every
// action by index, so the caller keeps ownership of the data (the guest uploads
// immediately and stores paths).
//
// COVER IS THE FIRST PHOTO. There is no separate cover control — dragging a
// photo to the front makes it the cover, on any device. The old star was only a
// workaround for touch drag not working; now that reorder works under touch, it
// is gone.
//
// REORDER WORKS ON MOUSE, TOUCH AND KEYBOARD. It is built on Pointer Events
// (which, unlike HTML5 drag, fire identically for mouse, touch and pen) plus
// arrow-key handling for accessibility — no drag-and-drop dependency for one
// short grid. `touch-action: none` on a tile lets a touch drag it instead of
// scrolling the page; elementFromPoint finds the tile under the pointer and the
// list reorders live as it passes.
export function PhotoEditorGrid({
    items,
    onReorder,
    onRemove,
    onAdd,
    uploading,
    addLabel = 'Add photos',
    instruction,
}: {
    items: PhotoEditorItem[];
    onReorder: (from: number, to: number) => void;
    onRemove: (index: number) => void;
    onAdd: (e: React.ChangeEvent<HTMLInputElement>) => void;
    uploading?: boolean;
    addLabel?: string;
    instruction?: string;
}) {
    // The key of the photo currently being dragged (null when idle). Keyed, not
    // indexed, because the list reorders under the pointer mid-drag, so the
    // dragged item's index keeps changing. Held in a ref as well as state: the
    // move handler must read it synchronously (a pointermove can arrive before a
    // state update has flushed), while the state drives the dimmed-tile styling.
    const dragKeyRef = useRef<string | null>(null);
    const [dragKey, setDragKey] = useState<string | null>(null);
    // After a keyboard move the list reorders and React would drop focus; this
    // re-focuses the moved tile so arrow-repeat keeps working.
    const [focusKey, setFocusKey] = useState<string | null>(null);
    const tileRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    useEffect(() => {
        if (!focusKey) return;
        tileRefs.current.get(focusKey)?.focus();
        setFocusKey(null);
    }, [focusKey, items]);

    const indexOfKey = (key: string) => items.findIndex((it) => it.key === key);

    // The tile under the pointer, by its data-photo-index. Ignores the pointer's
    // own tile and anything outside the grid.
    const tileIndexAt = (x: number, y: number): number | null => {
        const el = document.elementFromPoint(x, y);
        const tile = el && (el as HTMLElement).closest('[data-photo-index]');
        if (!tile) return null;
        const n = Number((tile as HTMLElement).dataset.photoIndex);
        return Number.isInteger(n) ? n : null;
    };

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>, i: number) => {
        // Let the delete button and the add input behave normally.
        if ((e.target as HTMLElement).closest('[data-role="remove"], input, label')) return;
        // Primary button / single touch only.
        if (e.button != null && e.button > 0) return;
        // Capture keeps pointermove/up on this tile as the finger passes over
        // others; a failure (odd pointer id) must not abort the drag.
        try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* not fatal */ }
        dragKeyRef.current = items[i].key;
        setDragKey(items[i].key);
    };

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const key = dragKeyRef.current;
        if (!key) return;
        e.preventDefault();
        const from = indexOfKey(key);
        if (from < 0) return;
        const to = tileIndexAt(e.clientX, e.clientY);
        if (to != null && to !== from) onReorder(from, to);
    };

    const endDrag = () => { dragKeyRef.current = null; setDragKey(null); };

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, i: number) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            if (i > 0) { e.preventDefault(); onReorder(i, i - 1); setFocusKey(items[i].key); }
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            if (i < items.length - 1) { e.preventDefault(); onReorder(i, i + 1); setFocusKey(items[i].key); }
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault(); onRemove(i);
        }
    };

    return (
        <div>
            {instruction && <p className="mb-3 text-sm text-slate-500">{instruction}</p>}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:max-w-xl">
                {items.map((item, i) => {
                    const isCover = i === 0;
                    const isDragging = dragKey === item.key;
                    return (
                        <div
                            key={item.key}
                            ref={(el) => { if (el) tileRefs.current.set(item.key, el); else tileRefs.current.delete(item.key); }}
                            data-photo-index={i}
                            tabIndex={0}
                            role="button"
                            aria-label={`Photo ${i + 1} of ${items.length}${isCover ? ' (cover)' : ''}. Arrow keys reorder — the first photo is the cover. Delete removes.`}
                            onPointerDown={(e) => onPointerDown(e, i)}
                            onPointerMove={onPointerMove}
                            onPointerUp={endDrag}
                            onPointerCancel={endDrag}
                            onKeyDown={(e) => onKeyDown(e, i)}
                            style={{ touchAction: 'none' }}
                            className={'group relative aspect-square touch-none select-none overflow-hidden rounded-xl border-2 bg-slate-50 transition '
                                + 'cursor-grab active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-1 '
                                + (isCover ? 'border-emerald-600 ' : 'border-slate-200 ')
                                + (isDragging ? 'opacity-40 ' : '')}
                        >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={item.src}
                                alt={isCover ? 'Cover photo' : `Photo ${i + 1}`}
                                draggable={false}
                                className="pointer-events-none h-full w-full object-cover"
                            />

                            {isCover && (
                                <span className="absolute left-1.5 top-1.5 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm">
                                    Cover
                                </span>
                            )}

                            {/* Remove, top-right. */}
                            <button
                                type="button"
                                data-role="remove"
                                onClick={() => onRemove(i)}
                                aria-label="Remove photo"
                                className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white shadow-sm transition hover:bg-black/75"
                            >
                                <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                            </button>
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
