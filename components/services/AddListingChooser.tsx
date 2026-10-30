'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, X, Home, Sparkles } from 'lucide-react';

// The + on the provider's "Your listing" page: the host's + (a round button,
// top right), opening Airbnb's "What would you like to host?" — a holiday let or
// an experience.
//
// One experience business per account is the rule (decided 1 Sep 2026; the
// database holds it as unique(owner_id, trade)). So for someone who already has
// one, the experience option does not start a second sign-up that would only be
// refused — it says so, and points at their menu, where more goes: a baker who
// also does hampers is one listing with more on the list. Someone who only
// co-hosts a business can still start their own.
export default function AddListingChooser({ ownsExperience }: { ownsExperience: boolean }) {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open]);

    const tile = 'flex w-full items-center gap-4 rounded-2xl border border-slate-200 p-4 text-left transition hover:border-slate-900';
    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                title="Create a new listing"
                aria-label="Create a new listing"
                className="w-11 h-11 rounded-full border border-slate-300 hover:bg-slate-100 flex items-center justify-center text-slate-800 transition flex-shrink-0"
            >
                <Plus className="w-5 h-5" />
            </button>
            {open && (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-6" onClick={() => setOpen(false)}>
                    <div role="dialog" aria-modal="true" aria-labelledby="add-listing-title" onClick={(e) => e.stopPropagation()}
                        className="w-full rounded-t-2xl bg-white p-6 sm:max-w-md sm:rounded-2xl">
                        <div className="mb-5 flex items-center justify-between">
                            <h2 id="add-listing-title" className="text-xl font-bold text-slate-900">What would you like to list?</h2>
                            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="space-y-3">
                            <Link href="/addhome" className={tile}>
                                <Home className="h-7 w-7 flex-none text-slate-700" />
                                <span>
                                    <span className="block font-semibold text-slate-900">A holiday let</span>
                                    <span className="block text-sm text-slate-500">A cottage, a house, a cabin — somewhere guests stay.</span>
                                </span>
                            </Link>
                            {ownsExperience ? (
                                <div className="flex w-full items-start gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                    <Sparkles className="mt-0.5 h-7 w-7 flex-none text-slate-400" />
                                    <span>
                                        <span className="block font-semibold text-slate-900">An experience</span>
                                        <span className="block text-sm text-slate-600">
                                            You already have one, and it’s one per account. Add anything else you offer to its menu instead.
                                        </span>
                                        <Link href="/services/dashboard/listing" className="mt-2 inline-block text-sm font-semibold text-slate-900 underline underline-offset-4">
                                            Add to your menu
                                        </Link>
                                    </span>
                                </div>
                            ) : (
                                <Link href="/business/experience" className={tile}>
                                    <Sparkles className="h-7 w-7 flex-none text-slate-700" />
                                    <span>
                                        <span className="block font-semibold text-slate-900">An experience</span>
                                        <span className="block text-sm text-slate-500">Something guests book and do — a class, a sauna, a meal.</span>
                                    </span>
                                </Link>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
