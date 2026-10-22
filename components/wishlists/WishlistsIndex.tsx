'use client';

import Link from 'next/link';
import { openAuthPanel } from '@/components/auth/AuthPanel';
import { useSaved } from '@/lib/savedStore';

// The traveller's Wishlists page: every wishlist as a photo tile with "N saved",
// each opening its grid of saved stays and experiences. Loads on the client, so
// nothing private is ever server-rendered or cached.
export default function WishlistsIndex() {
    const state = useSaved();

    if (state.loaded && !state.signedIn) {
        return (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
                <h2 className="text-xl font-bold text-slate-900">Your wishlists</h2>
                <p className="mt-2 text-slate-600">Sign in to see the places you’ve saved.</p>
                <button
                    type="button"
                    onClick={() => openAuthPanel('/wishlists')}
                    className="mt-6 inline-flex rounded-xl bg-emerald-700 px-6 py-3 text-base font-semibold text-white transition hover:bg-emerald-800"
                >
                    Sign in
                </button>
            </div>
        );
    }

    return (
        <div>
            <h1 className="text-3xl font-bold text-slate-900">Wishlists</h1>

            {!state.loaded ? (
                <p className="mt-6 text-slate-400">Loading…</p>
            ) : state.wishlists.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-8 text-center">
                    <p className="text-slate-600">No wishlists yet. Tap the heart on any place to save it.</p>
                    <Link href="/holiday-cottages" className="mt-4 inline-flex rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800">
                        Browse places to stay
                    </Link>
                </div>
            ) : (
                <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
                    {state.wishlists.map((w) => (
                        <Link key={w.id} href={`/wishlists/${w.id}`} className="group">
                            <div className="relative aspect-square overflow-hidden rounded-2xl bg-slate-100">
                                {w.cover ? (
                                    <img src={w.cover} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
                                ) : (
                                    <div className="flex h-full w-full items-center justify-center text-slate-300">
                                        <svg viewBox="0 0 24 24" fill="currentColor" className="h-10 w-10"><path d="M12 21s-7.5-4.6-10-9A5.3 5.3 0 0 1 12 5a5.3 5.3 0 0 1 10 7c-2.5 4.4-10 9-10 9Z" /></svg>
                                    </div>
                                )}
                            </div>
                            <div className="mt-2 truncate font-semibold text-slate-900">{w.name}</div>
                            <div className="text-sm text-slate-500">{w.count} saved</div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
