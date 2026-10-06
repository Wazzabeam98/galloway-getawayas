'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { toast } from 'react-toastify';
import Env from '@/config/Env';
import { compressImage } from '@/lib/compressImage';
import { generateRandomNumber, getImageUrl } from '@/lib/utils';

// The editor's Photos, saved as Airbnb's are — there is no Save for them. A new
// photo is written to the listing as soon as it has uploaded, a reorder as soon
// as it is dropped, and a delete once the host has said yes to "Delete this
// photo?". The first photo is the cover; "Make cover photo" moves it to the front.
//
// Desktop: drag a photo to reorder; the star makes it the cover, the × deletes.
// Phone: press and hold a photo to drag it (the others move aside), or tap it
// for a menu — Move earlier, Move later, Make cover photo, Delete photo.

// Writes a change to the photo list. The editor applies it at once and puts it
// back if the write fails; resolves whether it went through.
export type SavePhotos = (change: (current: string[]) => string[]) => Promise<boolean>;

const HOLD_MS = 350; // press this long to pick a photo up
const SLOP = 8; // moving further than this first is a scroll, not a press
const EDGE = 72; // a dragged photo this close to the top or bottom scrolls the page
const TOP_BARS = 81 + 48; // the site header and the editor's tab bar

const moved = (list: string[], from: number, to: number) => {
    const next = [...list];
    const [p] = next.splice(from, 1);
    next.splice(to, 0, p);
    return next;
};

// Where tile i sits while `from` is being dragged over `to`.
const previewIndex = (i: number, from: number, to: number) => {
    if (i === from) return to;
    if (from < to && i > from && i <= to) return i - 1;
    if (from > to && i >= to && i < from) return i + 1;
    return i;
};

type Drag = { from: number; to: number; dx: number; dy: number };

export default function PhotosEditor({ photos, savePhotos, isPhone, beforeChange }: {
    photos: string[];
    savePhotos: SavePhotos;
    isPhone: boolean;
    // False stops the change before it starts (an owner moderating with no
    // reason written yet).
    beforeChange?: () => boolean;
}) {
    const supabase = createClientComponentClient();
    const [uploads, setUploads] = useState<{ id: string; url: string }[]>([]);
    const [preparing, setPreparing] = useState(false);
    const [menuFor, setMenuFor] = useState<number | null>(null);
    const [confirmFor, setConfirmFor] = useState<string | null>(null);

    // Desktop drag and drop.
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

    const ok = () => (beforeChange ? beforeChange() : true);
    const reorder = (from: number, to: number) => {
        if (from === to || !ok()) return;
        savePhotos((cur) => moved(cur, from, to));
    };
    const makeCover = (i: number) => reorder(i, 0);
    const askDelete = (i: number) => { if (ok()) setConfirmFor(photos[i]); };
    const doDelete = async (path: string) => {
        setConfirmFor(null);
        await savePhotos((cur) => cur.filter((p) => p !== path));
    };

    // Shrunk before upload, the way addhome does it, so a 4000px phone photo
    // never reaches storage. Each one is written to the listing as it lands.
    const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        if (!files.length || !ok()) return;

        setPreparing(true);
        const ready: { id: string; file: File; url: string }[] = [];
        for (const file of files) {
            try {
                const small = await compressImage(file);
                ready.push({ id: `${Date.now()}_${generateRandomNumber()}`, file: small, url: URL.createObjectURL(small) });
            } catch {
                toast.error('One of those photos couldn’t be read. Try a different one.', { theme: 'colored' });
            }
        }
        setPreparing(false);
        setUploads((u) => [...u, ...ready.map(({ id, url }) => ({ id, url }))]);

        for (const r of ready) {
            const { data, error } = await supabase.storage.from(Env.S3_BUCKET).upload(r.id, r.file);
            if (error || !data?.path) {
                toast.error(`Photo upload failed: ${error?.message || 'try again'}`, { theme: 'colored' });
            } else {
                const path = data.path;
                await savePhotos((cur) => [...cur, path]);
            }
            setUploads((u) => u.filter((x) => x.id !== r.id));
            URL.revokeObjectURL(r.url);
        }
    };

    // ── Phone: press and hold to drag ──────────────────────────────────────
    const gridRef = useRef<HTMLDivElement>(null);
    const [drag, setDrag] = useState<Drag | null>(null);
    // One frame with no transitions after a drop, so the photos don't slide
    // out from their new places and back again.
    const [settling, setSettling] = useState(false);
    const press = useRef<{
        i: number; x: number; y: number; timer: number | undefined; dragging: boolean;
        slots: { x: number; y: number }[]; startY: number; lastX: number; lastY: number; raf: number;
        to: number; moved: boolean;
    } | null>(null);
    // A drag ends in a click on the photo; that click must not open the menu.
    const swallowClick = useRef(false);
    const photosRef = useRef(photos);
    photosRef.current = photos;
    const saveRef = useRef(reorder);
    saveRef.current = reorder;

    useEffect(() => {
        const grid = gridRef.current;
        if (!isPhone || !grid) return;

        const tileIndex = (t: EventTarget | null) => {
            const el = (t as HTMLElement | null)?.closest?.('[data-photo-index]') as HTMLElement | null;
            return el ? Number(el.dataset.photoIndex) : -1;
        };

        const place = () => {
            const p = press.current;
            if (!p || !p.dragging) return;
            const dx = p.lastX - p.x;
            const dy = p.lastY + window.scrollY - p.startY;
            const me = p.slots[p.i];
            const cx = me.x + dx, cy = me.y + dy;
            let to = p.i, best = Infinity;
            p.slots.forEach((s, k) => {
                const d = (s.x - cx) ** 2 + (s.y - cy) ** 2;
                if (d < best) { best = d; to = k; }
            });
            p.to = to;
            setDrag({ from: p.i, to, dx, dy });
        };

        // While a photo is held near the top or bottom, keep scrolling.
        const tick = () => {
            const p = press.current;
            if (!p || !p.dragging) return;
            const top = TOP_BARS + EDGE, bottom = window.innerHeight - EDGE;
            const step = p.lastY < top ? -Math.ceil((top - p.lastY) / 6) : p.lastY > bottom ? Math.ceil((p.lastY - bottom) / 6) : 0;
            if (step) { window.scrollBy(0, step); place(); }
            p.raf = requestAnimationFrame(tick);
        };

        const begin = () => {
            const p = press.current;
            if (!p) return;
            p.dragging = true;
            p.slots = Array.from(grid.querySelectorAll<HTMLElement>('[data-photo-index]')).map((el) => {
                const r = el.getBoundingClientRect();
                return { x: r.left + r.width / 2, y: r.top + window.scrollY + r.height / 2 };
            });
            p.startY = p.y + window.scrollY;
            try { navigator.vibrate?.(10); } catch { /* not on iOS */ }
            place();
            p.raf = requestAnimationFrame(tick);
        };

        const onStart = (e: TouchEvent) => {
            if (e.touches.length !== 1) return;
            const i = tileIndex(e.target);
            if (i < 0) return;
            const t = e.touches[0];
            press.current = {
                i, x: t.clientX, y: t.clientY, lastX: t.clientX, lastY: t.clientY, dragging: false, moved: false,
                slots: [], startY: 0, raf: 0, to: i, timer: window.setTimeout(begin, HOLD_MS),
            };
        };
        const onMove = (e: TouchEvent) => {
            const p = press.current;
            if (!p) return;
            const t = e.touches[0];
            p.lastX = t.clientX; p.lastY = t.clientY;
            if (!p.dragging) {
                if (Math.abs(t.clientX - p.x) > SLOP || Math.abs(t.clientY - p.y) > SLOP) {
                    // A scroll: let it go.
                    window.clearTimeout(p.timer);
                    press.current = null;
                }
                return;
            }
            e.preventDefault(); // the page holds still while a photo is carried
            p.moved = true;
            place();
        };
        const finish = (drop: boolean) => {
            const p = press.current;
            press.current = null;
            if (!p) return;
            window.clearTimeout(p.timer);
            if (!p.dragging) return;
            cancelAnimationFrame(p.raf);
            swallowClick.current = true;
            window.setTimeout(() => { swallowClick.current = false; }, 400);
            setSettling(true);
            setDrag(null);
            if (drop && p.to !== p.i) saveRef.current(p.i, p.to);
            requestAnimationFrame(() => requestAnimationFrame(() => setSettling(false)));
        };
        const onEnd = () => finish(true);
        const onCancel = () => finish(false);
        // Long-pressing an image would otherwise open the browser's own menu.
        const onContext = (e: Event) => { if (tileIndex(e.target) >= 0) e.preventDefault(); };

        grid.addEventListener('touchstart', onStart, { passive: true });
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onEnd);
        document.addEventListener('touchcancel', onCancel);
        grid.addEventListener('contextmenu', onContext);
        return () => {
            grid.removeEventListener('touchstart', onStart);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onEnd);
            document.removeEventListener('touchcancel', onCancel);
            grid.removeEventListener('contextmenu', onContext);
            if (press.current) { window.clearTimeout(press.current.timer); cancelAnimationFrame(press.current.raf); }
        };
    }, [isPhone]);

    const tileStyle = (i: number): React.CSSProperties | undefined => {
        if (!drag || !press.current) return undefined;
        const slots = press.current.slots;
        if (i === drag.from) {
            return { transform: `translate(${drag.dx}px, ${drag.dy}px) scale(1.04)`, transition: 'none', zIndex: 20 };
        }
        const p = previewIndex(i, drag.from, drag.to);
        if (p === i || !slots[p] || !slots[i]) return { transform: 'translate(0, 0)' };
        return { transform: `translate(${slots[p].x - slots[i].x}px, ${slots[p].y - slots[i].y}px)` };
    };

    return (
        <section>
            <h2 className="text-xl font-bold text-slate-900 mb-1">Photos</h2>
            <p className="text-xs text-slate-400 mb-4">
                {isPhone
                    ? 'Press and hold a photo to drag it. Tap a photo to move it, make it the cover or delete it.'
                    : 'Drag to reorder. Click the star to set the cover photo.'}
            </p>
            {(photos.length > 0 || uploads.length > 0) && (
                <div ref={gridRef} className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                    {photos.map((path, i) => {
                        const cover = i === 0;
                        const lifted = drag?.from === i;
                        return (
                            <div key={path}
                                data-photo-index={i}
                                draggable={!isPhone}
                                onDragStart={() => setDraggedIndex(i)}
                                onDragEnter={() => { if (draggedIndex !== null && draggedIndex !== i) setDragOverIndex(i); }}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={() => { if (draggedIndex !== null) reorder(draggedIndex, i); setDraggedIndex(null); setDragOverIndex(null); }}
                                onDragEnd={() => { setDraggedIndex(null); setDragOverIndex(null); }}
                                onClick={() => { if (isPhone && !swallowClick.current) setMenuFor(i); }}
                                style={tileStyle(i)}
                                className={`relative h-40 rounded-2xl overflow-hidden border-2 group select-none [-webkit-touch-callout:none] ${
                                    isPhone ? '' : 'cursor-grab active:cursor-grabbing'
                                } ${settling ? '' : 'transition-transform duration-200 ease-out'} ${
                                    cover ? 'border-emerald-700' : 'border-slate-200'
                                } ${lifted ? 'shadow-[0_12px_28px_rgba(0,0,0,0.28)]' : ''} ${dragOverIndex === i ? 'ring-2 ring-slate-900 scale-95' : ''} ${draggedIndex === i ? 'opacity-40' : ''}`}
                            >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={getImageUrl(path)} alt={`Photo ${i + 1}`} draggable={false}
                                    className="w-full h-full object-cover pointer-events-none" />
                                {!isPhone && (
                                    <>
                                        <button type="button" onClick={() => { if (!cover) makeCover(i); }}
                                            title={cover ? 'Cover photo' : 'Make cover photo'}
                                            className={`absolute top-2 right-11 w-8 h-8 rounded-full flex items-center justify-center text-sm shadow ${cover ? 'bg-emerald-700 text-white' : 'bg-white/90 text-slate-600 opacity-0 group-hover:opacity-100 transition'}`}>
                                            ★
                                        </button>
                                        <button type="button" onClick={() => askDelete(i)} title="Delete photo"
                                            className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90 text-slate-600 flex items-center justify-center text-sm shadow opacity-0 group-hover:opacity-100 transition">
                                            ×
                                        </button>
                                    </>
                                )}
                                {cover && (
                                    <span className="absolute top-2 left-2 text-xs font-semibold bg-emerald-700 text-white px-2 py-0.5 rounded-full">Cover</span>
                                )}
                            </div>
                        );
                    })}
                    {uploads.map((u) => (
                        <div key={u.id} className="relative h-40 rounded-2xl overflow-hidden border-2 border-slate-200">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={u.url} alt="" className="w-full h-full object-cover opacity-50" />
                            <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-slate-700">Uploading…</span>
                        </div>
                    ))}
                </div>
            )}
            <label className="h-24 rounded-2xl border-2 border-dashed border-slate-300 hover:border-slate-400 flex flex-col items-center justify-center cursor-pointer text-slate-500 text-sm">
                <span className="font-semibold">
                    {preparing ? 'Preparing your photos...' : '+ Add photos'}
                </span>
                <span className="text-xs mt-0.5">Straight from your phone is fine</span>
                <input type="file" accept="image/png, image/jpeg" multiple onChange={onFiles} className="hidden" disabled={preparing} />
            </label>

            {menuFor !== null && photos[menuFor] && (
                <PhotoMenu
                    index={menuFor}
                    count={photos.length}
                    onClose={() => setMenuFor(null)}
                    onEarlier={() => { const i = menuFor; setMenuFor(null); reorder(i, i - 1); }}
                    onLater={() => { const i = menuFor; setMenuFor(null); reorder(i, i + 1); }}
                    onCover={() => { const i = menuFor; setMenuFor(null); makeCover(i); }}
                    onDelete={() => { const i = menuFor; setMenuFor(null); askDelete(i); }}
                />
            )}

            {confirmFor && (
                <ConfirmDelete onCancel={() => setConfirmFor(null)} onConfirm={() => doDelete(confirmFor)} />
            )}
        </section>
    );
}

// The phone's menu for one photo, a sheet up from the bottom.
function PhotoMenu({ index, count, onClose, onEarlier, onLater, onCover, onDelete }: {
    index: number; count: number; onClose: () => void;
    onEarlier: () => void; onLater: () => void; onCover: () => void; onDelete: () => void;
}) {
    useEffect(() => {
        const overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = overflow; };
    }, []);
    const item = 'w-full px-5 py-4 text-left text-base font-medium text-slate-900 disabled:text-slate-300';
    return createPortal(
        <div className="fixed inset-0 z-50 flex items-end bg-black/50" onClick={onClose}>
            <div role="dialog" aria-modal="true" aria-label={`Photo ${index + 1}`}
                className="w-full rounded-t-2xl bg-white pb-[max(0.5rem,env(safe-area-inset-bottom))]"
                onClick={(e) => e.stopPropagation()}>
                <div className="border-b border-slate-100 px-5 py-3 text-center text-sm font-semibold text-slate-500">
                    {index === 0 ? 'Cover photo' : `Photo ${index + 1} of ${count}`}
                </div>
                <div className="divide-y divide-slate-100">
                    <button type="button" className={item} disabled={index === 0} onClick={onEarlier}>Move earlier</button>
                    <button type="button" className={item} disabled={index === count - 1} onClick={onLater}>Move later</button>
                    <button type="button" className={item} disabled={index === 0} onClick={onCover}>Make cover photo</button>
                    <button type="button" className={`${item} !text-rose-600`} onClick={onDelete}>Delete photo</button>
                    <button type="button" className={`${item} text-center !text-slate-500`} onClick={onClose}>Cancel</button>
                </div>
            </div>
        </div>,
        document.body,
    );
}

function ConfirmDelete({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onCancel]);
    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6" onClick={onCancel}>
            <div role="alertdialog" aria-modal="true" aria-label="Delete this photo?"
                className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <h2 className="text-lg font-bold text-slate-900">Delete this photo?</h2>
                <p className="mt-1 text-sm text-slate-500">It comes off your listing straight away.</p>
                <div className="mt-6 flex justify-end gap-3">
                    <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-900 underline">Cancel</button>
                    <button type="button" onClick={onConfirm} className="rounded-lg bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-rose-700">Delete</button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
