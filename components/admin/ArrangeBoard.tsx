'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { GripVertical, ChevronUp, ChevronDown, Check } from 'lucide-react';
import { toast } from 'react-toastify';
import { getImageUrl } from '@/lib/utils';

// The admin "Arrange listings" board: drag a row (or use the ▲▼ buttons) to set
// the order the grids show, then Save. Desktop drags with the mouse; phone
// presses and holds a row to pick it up, then slides it. The ▲▼ buttons do the
// same thing without a drag — reliable on any device and reachable by keyboard.
//
// Order is 1..N top-to-bottom. Save posts the ids in order to
// /api/admin/arrange, which writes display_order and busts the home-page cache.

export type ArrangeItem = {
    id: string;
    title: string;
    subtitle: string;
    image: string | null;   // storage key or url; resolved with getImageUrl
    href: string | null;    // where the row links on the live site
    placed: boolean;         // had a display_order already (vs. new, at the bottom)
};

const HOLD_MS = 250; // press this long to pick a row up
const SLOP = 10;     // moving further than this first is a scroll, not a press
const EDGE = 90;     // a dragged row this close to the top/bottom scrolls the page

function moved<T>(list: T[], from: number, to: number): T[] {
    const next = [...list];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    return next;
}

export default function ArrangeBoard({
    kind,
    items,
}: {
    kind: 'listings' | 'experiences';
    items: ArrangeItem[];
}) {
    const [order, setOrder] = useState<ArrangeItem[]>(items);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);

    // Desktop drag.
    const [draggedId, setDraggedId] = useState<string | null>(null);

    const noun = kind === 'listings' ? 'properties' : 'experiences';

    const apply = (next: ArrangeItem[]) => { setOrder(next); setDirty(true); };
    const move = (from: number, to: number) => {
        if (to < 0 || to >= order.length || from === to) return;
        apply(moved(order, from, to));
    };

    // ── Desktop: HTML5 drag, reordering live as the row is dragged over others ──
    const onDragStart = (id: string) => setDraggedId(id);
    const onDragOverRow = (overId: string) => {
        if (!draggedId || draggedId === overId) return;
        const from = order.findIndex((r) => r.id === draggedId);
        const to = order.findIndex((r) => r.id === overId);
        if (from === -1 || to === -1) return;
        apply(moved(order, from, to));
    };
    const onDragEnd = () => setDraggedId(null);

    // ── Phone: press and hold to pick a row up, then slide it ──────────────────
    const listRef = useRef<HTMLOListElement>(null);
    const [heldId, setHeldId] = useState<string | null>(null);
    const press = useRef<{
        id: string; startY: number; lastY: number; dragging: boolean;
        timer: number | undefined; raf: number;
    } | null>(null);
    // Keep the latest order in a ref so the long-lived touch handlers reorder the
    // current list, not the one captured when they were bound.
    const orderRef = useRef(order);
    orderRef.current = order;

    useEffect(() => {
        const list = listRef.current;
        if (!list) return;

        const rowIndexAt = (clientY: number): number => {
            const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-arrange-row]'));
            let best = -1, bestD = Infinity;
            rows.forEach((el) => {
                const r = el.getBoundingClientRect();
                const mid = r.top + r.height / 2;
                const d = Math.abs(mid - clientY);
                if (d < bestD) { bestD = d; best = Number(el.dataset.index); }
            });
            return best;
        };

        const place = () => {
            const p = press.current;
            if (!p || !p.dragging) return;
            const cur = orderRef.current;
            const from = cur.findIndex((r) => r.id === p.id);
            const to = rowIndexAt(p.lastY);
            if (from !== -1 && to !== -1 && from !== to) apply(moved(cur, from, to));
        };

        const tick = () => {
            const p = press.current;
            if (!p || !p.dragging) return;
            const step = p.lastY < EDGE ? -Math.ceil((EDGE - p.lastY) / 6)
                : p.lastY > window.innerHeight - EDGE ? Math.ceil((p.lastY - (window.innerHeight - EDGE)) / 6)
                    : 0;
            if (step) { window.scrollBy(0, step); place(); }
            p.raf = requestAnimationFrame(tick);
        };

        const begin = () => {
            const p = press.current;
            if (!p) return;
            p.dragging = true;
            setHeldId(p.id);
            try { navigator.vibrate?.(10); } catch { /* not on iOS */ }
            p.raf = requestAnimationFrame(tick);
        };

        const handleAt = (t: EventTarget | null) =>
            (t as HTMLElement | null)?.closest?.('[data-arrange-handle]') as HTMLElement | null;

        const onStart = (e: TouchEvent) => {
            if (e.touches.length !== 1) return;
            const handle = handleAt(e.target);
            if (!handle) return;
            const row = handle.closest<HTMLElement>('[data-arrange-row]');
            if (!row) return;
            const t = e.touches[0];
            press.current = {
                id: String(row.dataset.id), startY: t.clientY, lastY: t.clientY,
                dragging: false, raf: 0, timer: window.setTimeout(begin, HOLD_MS),
            };
        };
        const onMove = (e: TouchEvent) => {
            const p = press.current;
            if (!p) return;
            const t = e.touches[0];
            p.lastY = t.clientY;
            if (!p.dragging) {
                if (Math.abs(t.clientY - p.startY) > SLOP) { window.clearTimeout(p.timer); press.current = null; }
                return;
            }
            e.preventDefault(); // the page holds still while a row is carried
            place();
        };
        const finish = () => {
            const p = press.current;
            press.current = null;
            if (!p) return;
            window.clearTimeout(p.timer);
            cancelAnimationFrame(p.raf);
            setHeldId(null);
        };

        // passive:false on move so preventDefault can hold the page still.
        list.addEventListener('touchstart', onStart, { passive: true });
        list.addEventListener('touchmove', onMove, { passive: false });
        list.addEventListener('touchend', finish);
        list.addEventListener('touchcancel', finish);
        return () => {
            list.removeEventListener('touchstart', onStart);
            list.removeEventListener('touchmove', onMove);
            list.removeEventListener('touchend', finish);
            list.removeEventListener('touchcancel', finish);
        };
        // Bound once; the handlers read live state through orderRef.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const save = async () => {
        setSaving(true);
        try {
            const res = await fetch('/api/admin/arrange', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind, order: order.map((r) => r.id) }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.ok) throw new Error(data.error || 'Could not save.');
            setDirty(false);
            toast.success('Order saved. The home page updates now.');
        } catch (err: any) {
            toast.error(err?.message || 'Could not save the order.');
        } finally {
            setSaving(false);
        }
    };

    if (!order.length) {
        return (
            <p className="text-sm text-slate-500">
                No {noun} to arrange yet. They appear here once they are live on the site.
            </p>
        );
    }

    return (
        <div className="pb-24">
            <ol ref={listRef} className="space-y-2">
                {order.map((row, i) => {
                    const held = heldId === row.id;
                    const dragging = draggedId === row.id;
                    const img = row.image ? getImageUrl(row.image) : null;
                    return (
                        <li
                            key={row.id}
                            data-arrange-row
                            data-id={row.id}
                            data-index={i}
                            draggable
                            onDragStart={() => onDragStart(row.id)}
                            onDragOver={(e) => { e.preventDefault(); onDragOverRow(row.id); }}
                            onDragEnd={onDragEnd}
                            className={'flex items-center gap-3 rounded-xl border bg-white p-3 transition '
                                + (held || dragging
                                    ? 'border-slate-900 shadow-[0_6px_16px_rgba(0,0,0,0.12)] opacity-95'
                                    : 'border-slate-200')}
                        >
                            {/* The handle: press and hold on phone, or drag on desktop. */}
                            <span
                                data-arrange-handle
                                aria-hidden
                                className="shrink-0 cursor-grab touch-none text-slate-400 active:cursor-grabbing"
                            >
                                <GripVertical className="h-5 w-5" />
                            </span>

                            <span className="w-6 shrink-0 text-center text-sm font-semibold tabular-nums text-slate-400">
                                {i + 1}
                            </span>

                            {img ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={img} alt="" className="h-12 w-16 shrink-0 rounded-lg object-cover" />
                            ) : (
                                <span className="h-12 w-16 shrink-0 rounded-lg bg-slate-100" />
                            )}

                            <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-2">
                                    <span className="truncate font-medium text-slate-900">{row.title}</span>
                                    {!row.placed && (
                                        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                                            New
                                        </span>
                                    )}
                                </span>
                                {row.subtitle && (
                                    <span className="block truncate text-sm text-slate-500">{row.subtitle}</span>
                                )}
                            </span>

                            {row.href && (
                                <Link
                                    href={row.href}
                                    target="_blank"
                                    className="hidden shrink-0 text-sm text-slate-500 underline hover:text-slate-900 sm:inline"
                                >
                                    View
                                </Link>
                            )}

                            <span className="flex shrink-0 flex-col">
                                <button
                                    type="button"
                                    aria-label="Move up"
                                    disabled={i === 0}
                                    onClick={() => move(i, i - 1)}
                                    className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                                >
                                    <ChevronUp className="h-5 w-5" />
                                </button>
                                <button
                                    type="button"
                                    aria-label="Move down"
                                    disabled={i === order.length - 1}
                                    onClick={() => move(i, i + 1)}
                                    className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                                >
                                    <ChevronDown className="h-5 w-5" />
                                </button>
                            </span>
                        </li>
                    );
                })}
            </ol>

            {/* The save bar sits at the bottom of the screen so it is in reach after
                a long drag, on phone especially. */}
            <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 backdrop-blur">
                <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-6 py-3">
                    <span className="text-sm text-slate-500">
                        {dirty ? 'Unsaved changes' : 'Saved'}
                    </span>
                    <button
                        type="button"
                        onClick={save}
                        disabled={!dirty || saving}
                        className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-40"
                    >
                        {!saving && <Check className="h-4 w-4" />}
                        {saving ? 'Saving…' : 'Save order'}
                    </button>
                </div>
            </div>
        </div>
    );
}
