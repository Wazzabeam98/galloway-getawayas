'use client';

import { useEffect, useRef, useState } from 'react';
import { ImageIcon, ImageOff, Plus, Trash2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { EditorCard, EditorPanel } from '@/components/listing-editor/EditorPanel';
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

// Straight to the storage API rather than supabase.storage.upload(), which
// can't report progress. Same bucket, same session, same storage rules.
async function uploadWithProgress(supabase: { auth: { getSession: () => Promise<{ data: { session: { access_token: string } | null } }> } }, file: File, path: string, onProgress: (p: number) => void): Promise<string> {
    const { data: { session } } = await supabase.auth.getSession();
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${Env.SUPABASE_URL}/storage/v1/object/${Env.S3_BUCKET}/${path}`);
        xhr.setRequestHeader('Authorization', `Bearer ${session?.access_token || Env.SUPABASE_KEY}`);
        xhr.setRequestHeader('apikey', Env.SUPABASE_KEY);
        xhr.setRequestHeader('Content-Type', file.type || 'image/jpeg');
        xhr.setRequestHeader('cache-control', 'max-age=3600');
        xhr.setRequestHeader('x-upsert', 'false');
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) { onProgress(1); resolve(path); return; }
            let msg = 'try again';
            try { msg = JSON.parse(xhr.responseText).message || msg; } catch { /* not JSON */ }
            reject(new Error(msg));
        };
        xhr.onerror = () => reject(new Error('the connection dropped'));
        xhr.send(file);
    });
}

export type Upload = { id: string; url: string; progress: number };

// The upload queue, shared by the desktop box (which starts it the moment
// photos are chosen) and the phone's Upload photos page (which starts it on
// Upload). One photo at a time: shrink, upload with progress, then write it to
// the listing. Its local preview is kept for that photo until the stored copy
// has loaded, so a just-added photo never shows as an empty tile.
export function usePhotoUploads(savePhotos: SavePhotos) {
    const supabase = createClientComponentClient();
    const [uploads, setUploads] = useState<Upload[]>([]);
    const [local, setLocal] = useState<Record<string, string>>({});

    const start = async (items: { file: File; url: string }[]) => {
        const queued = items.map((it) => ({ ...it, id: `${Date.now()}_${generateRandomNumber()}` }));
        setUploads((u) => [...u, ...queued.map(({ id, url }) => ({ id, url, progress: 0 }))]);
        for (const q of queued) {
            const setProgress = (progress: number) => setUploads((u) => u.map((x) => (x.id === q.id ? { ...x, progress } : x)));
            let keepPreview = false;
            try {
                const small = await compressImage(q.file);
                const path = await uploadWithProgress(supabase, small, q.id, setProgress);
                if (await savePhotos((cur) => [...cur, path])) {
                    setLocal((l) => ({ ...l, [path]: q.url }));
                    keepPreview = true;
                }
            } catch (err: any) {
                toast.error(`A photo didn\u2019t upload: ${err?.message || 'try again'}`, { theme: 'colored' });
            }
            setUploads((u) => u.filter((x) => x.id !== q.id));
            if (!keepPreview) URL.revokeObjectURL(q.url);
        }
    };
    // The stored copy is showing: the local preview can go.
    const loaded = (path: string) => setLocal((l) => {
        if (!l[path]) return l;
        URL.revokeObjectURL(l[path]);
        const { [path]: _gone, ...rest } = l;
        return rest;
    });
    return { uploads, local, start, loaded };
}

// One photo in the grid. Never a blank white box: grey while it loads (or the
// photo's own preview, just after it was added), and if the file can't be
// shown, says so — the tile still opens its menu, so it can be deleted.
function PhotoImage({ path, index, preview, onLoaded }: { path: string; index: number; preview?: string; onLoaded: (path: string) => void }) {
    const [state, setState] = useState<'loading' | 'ok' | 'failed'>('loading');
    useEffect(() => { setState('loading'); }, [path]);
    return (
        <div className="absolute inset-0 bg-slate-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {preview && state !== 'ok' && <img src={preview} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover pointer-events-none" />}
            {state === 'failed' ? (
                <div data-photo-failed className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-slate-500">
                    <ImageOff className="h-6 w-6" />
                    <span className="text-xs font-medium">Couldn&apos;t load this photo</span>
                </div>
            ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={getImageUrl(path)} alt={`Photo ${index + 1}`} draggable={false}
                    onLoad={() => { setState('ok'); onLoaded(path); }}
                    onError={() => setState('failed')}
                    className={`absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-200 ${state === 'ok' ? 'opacity-100' : 'opacity-0'}`} />
            )}
        </div>
    );
}

export default function PhotosEditor({ photos, savePhotos, isPhone, beforeChange, inSheet = false, uploader }: {
    photos: string[];
    savePhotos: SavePhotos;
    isPhone: boolean;
    // Inside the phone's Photos sheet: the sheet carries the title and its "+"
    // adds photos, so there is no Add box.
    inSheet?: boolean;
    // The phone sheet's upload queue (its Upload photos page feeds it).
    uploader?: ReturnType<typeof usePhotoUploads>;
    // False stops the change before it starts (an owner moderating with no
    // reason written yet).
    beforeChange?: () => boolean;
}) {
    const own = usePhotoUploads(savePhotos);
    const { uploads, local, start, loaded } = uploader || own;
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

    // Desktop: photos start uploading the moment they're chosen, each written
    // to the listing as it lands (shrunk first, the way addhome does it, so a
    // 4000px phone photo never reaches storage).
    const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        if (!files.length || !ok()) return;
        setPreparing(true);
        try { await start(files.map((file) => ({ file, url: URL.createObjectURL(file) }))); } finally { setPreparing(false); }
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

        // In the phone's sheet the sheet's body scrolls, not the page.
        const box = grid.closest<HTMLElement>('[data-sheet-scroll]');
        const scrollTop = () => (box ? box.scrollTop : window.scrollY);
        const scrollBy = (dy: number) => (box ? box.scrollBy(0, dy) : window.scrollBy(0, dy));
        const edges = () => {
            if (!box) return { top: TOP_BARS + EDGE, bottom: window.innerHeight - EDGE };
            const r = box.getBoundingClientRect();
            return { top: r.top + EDGE, bottom: r.bottom - EDGE };
        };

        const tileIndex = (t: EventTarget | null) => {
            const el = (t as HTMLElement | null)?.closest?.('[data-photo-index]') as HTMLElement | null;
            return el ? Number(el.dataset.photoIndex) : -1;
        };

        const place = () => {
            const p = press.current;
            if (!p || !p.dragging) return;
            const dx = p.lastX - p.x;
            const dy = p.lastY + scrollTop() - p.startY;
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
            const { top, bottom } = edges();
            const step = p.lastY < top ? -Math.ceil((top - p.lastY) / 6) : p.lastY > bottom ? Math.ceil((p.lastY - bottom) / 6) : 0;
            if (step) { scrollBy(step); place(); }
            p.raf = requestAnimationFrame(tick);
        };

        const begin = () => {
            const p = press.current;
            if (!p) return;
            p.dragging = true;
            p.slots = Array.from(grid.querySelectorAll<HTMLElement>('[data-photo-index]')).map((el) => {
                const r = el.getBoundingClientRect();
                return { x: r.left + r.width / 2, y: r.top + scrollTop() + r.height / 2 };
            });
            p.startY = p.y + scrollTop();
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
            {!inSheet && <h2 className="text-xl font-bold text-slate-900 mb-1">Photos</h2>}
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
                                <PhotoImage path={path} index={i} preview={local[path]} onLoaded={loaded} />
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
                        <div key={u.id} data-uploading className="relative h-40 rounded-2xl overflow-hidden border-2 border-slate-200 bg-slate-100">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={u.url} alt="" className="w-full h-full object-cover opacity-50" />
                            {isPhone ? (
                                <div className="absolute inset-x-3 bottom-3" aria-label={`Uploading, ${Math.round(u.progress * 100)}%`}>
                                    <div className="mb-1 text-xs font-semibold text-slate-800">{u.progress >= 1 ? 'Finishing…' : `Uploading ${Math.round(u.progress * 100)}%`}</div>
                                    <div className="h-1.5 overflow-hidden rounded-full bg-white/70">
                                        <div className="h-full rounded-full bg-brand transition-[width] duration-200" style={{ width: `${Math.round(u.progress * 100)}%` }} />
                                    </div>
                                </div>
                            ) : (
                                <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-slate-700">Uploading…</span>
                            )}
                        </div>
                    ))}
                </div>
            )}
            {inSheet ? (photos.length === 0 && uploads.length === 0 && (
                <p className="py-10 text-center text-sm text-slate-500">No photos yet. Tap + to add some.</p>
            )) : (
            <label className="h-24 rounded-2xl border-2 border-dashed border-slate-300 hover:border-slate-400 flex flex-col items-center justify-center cursor-pointer text-slate-500 text-sm">
                <span className="font-semibold">
                    {preparing ? 'Preparing your photos...' : '+ Add photos'}
                </span>
                <span className="text-xs mt-0.5">Straight from your phone is fine</span>
                <input type="file" accept="image/png, image/jpeg" multiple onChange={onFiles} className="hidden" disabled={preparing} />
            </label>
            )}

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

// On a phone, Photos is a raised card like Sleeping arrangements: the count,
// the first two photos (the cover first) and "+N more", so scrolling past can
// never move or delete one. Tapping it opens the full editor in the sheet —
// each change there saves as it's made, exactly as on the page before.
export function PhotosCard({ photos, savePhotos, beforeChange }: {
    photos: string[];
    savePhotos: SavePhotos;
    beforeChange?: () => boolean;
}) {
    const [open, setOpen] = useState(false);
    // Adding photos, Airbnb's way: "+" → a small panel with Add photos → the
    // photo library → an Upload photos page. Nothing uploads until Upload.
    const [adding, setAdding] = useState(false);
    const [chosen, setChosen] = useState<{ id: string; file: File; url: string }[] | null>(null);
    const picker = useRef<HTMLInputElement>(null);
    // Lives here, not in the sheet, so photos keep uploading if it's closed.
    const uploader = usePhotoUploads(savePhotos);

    const shown = photos.slice(0, 2);
    const more = photos.length - shown.length;
    const count = photos.length ? `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}` : 'No photos yet';

    const pick = () => { if (!beforeChange || beforeChange()) picker.current?.click(); };
    const onPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        if (!files.length) return;
        const items = files.map((file) => ({ id: `${Date.now()}_${generateRandomNumber()}`, file, url: URL.createObjectURL(file) }));
        setChosen((c) => [...(c || []), ...items]);
    };
    const drop = (id: string) => setChosen((c) => {
        const gone = c?.find((x) => x.id === id);
        if (gone) URL.revokeObjectURL(gone.url);
        return (c || []).filter((x) => x.id !== id);
    });
    const cancel = () => { chosen?.forEach((x) => URL.revokeObjectURL(x.url)); setChosen(null); };
    const upload = () => {
        const items = chosen || [];
        setChosen(null);
        if (items.length) uploader.start(items.map(({ file, url }) => ({ file, url })));
    };

    return (
        <>
            <EditorCard title="Photos" summary={count} onClick={() => setOpen(true)}>
                {shown.length > 0 && (
                    <div className="mt-4 grid grid-cols-2 gap-3">
                        {shown.map((path) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={path} src={uploader.local[path] || getImageUrl(path)} alt="" className="aspect-[4/3] w-full rounded-xl bg-slate-100 object-cover" />
                        ))}
                    </div>
                )}
                {more > 0 && <div className="mt-3 text-sm font-semibold text-slate-700">+{more} more</div>}
            </EditorCard>

            {/* The phone's photo library, several at a time. Off-screen rather
                than display:none, which some phones won't open from a tap. */}
            <input ref={picker} type="file" accept="image/png, image/jpeg" multiple onChange={onPicked}
                className="sr-only" tabIndex={-1} aria-hidden="true" data-photo-picker />

            {open && (
                <EditorPanel title="Photos" onClose={() => setOpen(false)}
                    trailing={
                        <button type="button" onClick={() => setAdding(true)} aria-label="Add photos"
                            className="rounded-full p-1.5 text-slate-900 hover:bg-slate-100">
                            <Plus className="h-6 w-6" />
                        </button>
                    }>
                    <PhotosEditor photos={photos} savePhotos={savePhotos} isPhone beforeChange={beforeChange} inSheet uploader={uploader} />
                </EditorPanel>
            )}

            {adding && (
                <AddPhotosPanel onClose={() => setAdding(false)} onAdd={() => { pick(); setAdding(false); }} />
            )}

            {chosen && (
                <UploadPhotosPage items={chosen} onRemove={drop} onMore={pick} onCancel={cancel} onUpload={upload} />
            )}
        </>
    );
}

// The small panel the sheet's "+" slides up.
function AddPhotosPanel({ onClose, onAdd }: { onClose: () => void; onAdd: () => void }) {
    const [shown, setShown] = useState(false);
    useEffect(() => { const r = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(r); }, []);
    return createPortal(
        <div className={`fixed inset-0 z-[60] flex items-end bg-black/50 transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`} onClick={onClose}>
            <div role="dialog" aria-modal="true" aria-label="Add photos"
                className={`w-full rounded-t-2xl bg-white px-2 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-transform duration-300 ease-out ${shown ? 'translate-y-0' : 'translate-y-full'}`}
                onClick={(e) => e.stopPropagation()}>
                <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-200" />
                <button type="button" onClick={onAdd}
                    className="flex w-full items-center gap-4 rounded-xl px-4 py-4 text-left text-base font-semibold text-slate-900 hover:bg-slate-50">
                    <ImageIcon className="h-6 w-6 text-slate-700" />
                    Add photos
                </button>
            </div>
        </div>,
        document.body,
    );
}

// What the host chose, before anything is sent: remove any, add more, then
// Upload (or Cancel, which throws the choice away).
function UploadPhotosPage({ items, onRemove, onMore, onCancel, onUpload }: {
    items: { id: string; url: string }[];
    onRemove: (id: string) => void;
    onMore: () => void;
    onCancel: () => void;
    onUpload: () => void;
}) {
    useEffect(() => {
        const overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = overflow; };
    }, []);
    const n = items.length;
    return createPortal(
        <div role="dialog" aria-modal="true" aria-label="Upload photos" className="fixed inset-0 z-[60] flex h-[100dvh] flex-col bg-white">
            <div className="flex items-start justify-between px-5 pt-5 pb-3">
                <div>
                    <h2 className="text-2xl font-bold text-slate-900">Upload photos</h2>
                    <p className="mt-0.5 text-sm text-slate-500">{n === 0 ? 'No items selected' : `${n} ${n === 1 ? 'item' : 'items'} selected`}</p>
                </div>
                <button type="button" onClick={onMore} aria-label="Add more photos" className="rounded-full p-1.5 text-slate-900 hover:bg-slate-100">
                    <Plus className="h-6 w-6" />
                </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
                <div className="grid grid-cols-2 gap-3">
                    {items.map((it) => (
                        <div key={it.id} data-chosen className="relative aspect-square overflow-hidden rounded-xl bg-slate-100">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={it.url} alt="" className="h-full w-full object-cover" />
                            <button type="button" onClick={() => onRemove(it.id)} aria-label="Remove this photo"
                                className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-slate-800 shadow">
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </div>
                    ))}
                </div>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <button type="button" onClick={onCancel} className="text-sm font-semibold text-slate-900 underline">Cancel</button>
                <button type="button" onClick={onUpload} disabled={n === 0}
                    className="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-40">
                    Upload
                </button>
            </div>
        </div>,
        document.body,
    );
}
