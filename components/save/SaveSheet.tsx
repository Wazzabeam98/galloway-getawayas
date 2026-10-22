'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
    useSaved, addToWishlist, removeFromWishlist, createWishlist, inWishlist,
    type SavedKind,
} from '@/lib/savedStore';

// "Save to wishlist" — the guest's wishlists as photo tiles with "N saved", tap
// one to add (or remove), and "Create new wishlist" at the bottom. Airbnb's
// shape. Reads and writes through the browser store (RLS-gated to the owner).
export default function SaveSheet({
    open,
    onClose,
    kind,
    id,
    onFirstSaved,
}: {
    open: boolean;
    onClose: () => void;
    kind: SavedKind;
    id: string;
    onFirstSaved?: () => void;
}) {
    const state = useSaved();
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const [busy, setBusy] = useState(false);

    if (typeof document === 'undefined' || !open) return null;

    const toggle = async (wishlistId: string) => {
        if (busy) return;
        setBusy(true);
        try {
            if (inWishlist(state, wishlistId, kind, id)) {
                await removeFromWishlist(wishlistId, kind, id);
            } else {
                await addToWishlist(wishlistId, kind, id);
                if (onFirstSaved) onFirstSaved();
            }
            onClose();
        } finally {
            setBusy(false);
        }
    };

    const create = async () => {
        if (busy) return;
        const name = newName.trim() || 'My wishlist';
        setBusy(true);
        try {
            const wid = await createWishlist(name);
            if (wid) {
                await addToWishlist(wid, kind, id);
                if (onFirstSaved) onFirstSaved();
            }
            setCreating(false);
            setNewName('');
            onClose();
        } finally {
            setBusy(false);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
            <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                    <h3 className="text-base font-bold text-slate-900">Save to wishlist</h3>
                    <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1 text-slate-400 hover:bg-slate-100">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><path d="M18 6 6 18M6 6l12 12" /></svg>
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    {!state.loaded ? (
                        <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
                    ) : (
                        <div className="grid grid-cols-2 gap-3">
                            {state.wishlists.map((w) => {
                                const on = inWishlist(state, w.id, kind, id);
                                return (
                                    <button
                                        key={w.id}
                                        type="button"
                                        onClick={() => toggle(w.id)}
                                        disabled={busy}
                                        className="group text-left disabled:opacity-60"
                                    >
                                        <div className={'relative aspect-square overflow-hidden rounded-xl bg-slate-100 ring-2 ' + (on ? 'ring-slate-900' : 'ring-transparent')}>
                                            {w.cover ? (
                                                <img src={w.cover} alt="" className="h-full w-full object-cover" />
                                            ) : (
                                                <div className="flex h-full w-full items-center justify-center text-slate-300">
                                                    <svg viewBox="0 0 24 24" fill="currentColor" className="h-8 w-8"><path d="M12 21s-7.5-4.6-10-9A5.3 5.3 0 0 1 12 5a5.3 5.3 0 0 1 10 7c-2.5 4.4-10 9-10 9Z" /></svg>
                                                </div>
                                            )}
                                            {on && (
                                                <div className="absolute right-1.5 top-1.5 rounded-full bg-slate-900 p-1 text-white">
                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-3.5 w-3.5"><path d="m5 13 4 4L19 7" /></svg>
                                                </div>
                                            )}
                                        </div>
                                        <div className="mt-1.5 truncate text-sm font-medium text-slate-900">{w.name}</div>
                                        <div className="text-xs text-slate-500">{w.count} saved</div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="border-t border-slate-100 p-4">
                    {creating ? (
                        <div className="flex items-center gap-2">
                            <input
                                autoFocus
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="Wishlist name"
                                maxLength={60}
                                className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
                                onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
                            />
                            <button type="button" onClick={create} disabled={busy} className="flex-none rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
                                Create
                            </button>
                        </div>
                    ) : (
                        <button type="button" onClick={() => setCreating(true)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:border-slate-400">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M12 5v14M5 12h14" /></svg>
                            Create new wishlist
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}
