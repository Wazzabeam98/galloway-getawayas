'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { openAuthPanel } from '@/components/auth/AuthPanel';
import { useSaved, renameWishlist, deleteWishlist } from '@/lib/savedStore';

// One wishlist: its saved stays and experiences as a grid like Airbnb's, with
// rename and delete. Client-only (private to the owner, never cached).
export default function WishlistDetail({ id }: { id: string }) {
    const state = useSaved();
    const router = useRouter();
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);

    if (state.loaded && !state.signedIn) {
        return (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
                <p className="text-slate-600">Sign in to see this wishlist.</p>
                <button type="button" onClick={() => openAuthPanel('/wishlists/' + id)} className="mt-6 inline-flex rounded-xl bg-emerald-700 px-6 py-3 text-base font-semibold text-white hover:bg-emerald-800">
                    Sign in
                </button>
            </div>
        );
    }

    if (!state.loaded) return <p className="text-slate-400">Loading…</p>;

    const wishlist = state.wishlists.find((w) => w.id === id);
    if (!wishlist) {
        return (
            <div>
                <Link href="/wishlists" className="text-sm text-slate-500 hover:underline">&larr; Wishlists</Link>
                <p className="mt-6 text-slate-600">This wishlist no longer exists.</p>
            </div>
        );
    }

    const cards = state.cards[id] || [];

    const startRename = () => { setName(wishlist.name); setEditing(true); };
    const saveRename = async () => {
        const next = name.trim();
        if (!next || next === wishlist.name) { setEditing(false); return; }
        setBusy(true);
        try { await renameWishlist(id, next); setEditing(false); } finally { setBusy(false); }
    };
    const remove = async () => {
        if (!confirm('Delete “' + wishlist.name + '”? The places in it won’t be deleted — just this list.')) return;
        setBusy(true);
        try { await deleteWishlist(id); router.push('/wishlists'); } finally { setBusy(false); }
    };

    return (
        <div>
            <Link href="/wishlists" className="text-sm text-slate-500 hover:underline">&larr; Wishlists</Link>

            <div className="mt-3 flex items-center justify-between gap-3">
                {editing ? (
                    <div className="flex flex-1 items-center gap-2">
                        <input
                            autoFocus value={name} maxLength={60}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setEditing(false); }}
                            className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-xl font-bold outline-none focus:border-slate-900"
                        />
                        <button type="button" onClick={saveRename} disabled={busy} className="flex-none rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50">Save</button>
                    </div>
                ) : (
                    <>
                        <h1 className="text-3xl font-bold text-slate-900">{wishlist.name}</h1>
                        <div className="flex flex-none items-center gap-1">
                            <button type="button" onClick={startRename} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100">Rename</button>
                            <button type="button" onClick={remove} disabled={busy} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">Delete</button>
                        </div>
                    </>
                )}
            </div>
            <p className="mt-1 text-sm text-slate-500">{cards.length} saved</p>

            {cards.length === 0 ? (
                <p className="mt-6 text-slate-600">Nothing saved here yet.</p>
            ) : (
                <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {cards.map((c) => (
                        <Link key={c.kind + c.id} href={c.href} className="group">
                            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-slate-100">
                                {c.photo ? (
                                    <img src={c.photo} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
                                ) : (
                                    <div className="flex h-full w-full items-center justify-center text-slate-300 text-3xl font-semibold">{c.title.slice(0, 1)}</div>
                                )}
                                <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-black/5">
                                    {c.kind === 'stay' ? 'Stay' : 'Experience'}
                                </span>
                            </div>
                            <div className="mt-2 truncate font-semibold text-slate-900">{c.title}</div>
                            <div className="truncate text-sm text-slate-500">{c.subtitle}</div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
