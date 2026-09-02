'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { MapPin, X } from 'lucide-react';

// The dismissible nudge. Dismissing writes a stamp to arrival_nudge_prefs (the
// host's own row, RLS-guarded); the server derives "dismissed" from it, and a
// newer booking brings the nudge back. Filling the field makes it vanish on its
// own — this card just hides itself optimistically after a dismiss.
export default function ArrivalNudgeCard({ listingId, title, checkIn }: { listingId: string; title: string; checkIn: string }) {
    const supabase = createClientComponentClient();
    const [dismissed, setDismissed] = useState(false);
    const [busy, setBusy] = useState(false);

    if (dismissed) return null;

    const d = new Date(checkIn);
    const day = isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

    async function dismiss() {
        setBusy(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session && session.user) {
                await supabase.from('arrival_nudge_prefs').upsert(
                    { user_id: session.user.id, listing_id: listingId, dismissed_at: new Date().toISOString() },
                    { onConflict: 'user_id,listing_id' }
                );
            }
        } catch { /* hide anyway */ }
        setDismissed(true);
    }

    return (
        <div className="relative mb-6 rounded-2xl border border-amber-300 bg-amber-50 p-4">
            <button type="button" onClick={dismiss} disabled={busy}
                className="absolute right-3 top-3 text-amber-700/60 hover:text-amber-900" aria-label="Dismiss">
                <X className="h-4 w-4" />
            </button>
            <div className="flex items-start gap-3 pr-6">
                <MapPin className="mt-0.5 h-5 w-5 flex-none text-amber-700" />
                <div>
                    <p className="font-semibold text-amber-900">A guest arrives {day ? 'on ' + day : 'soon'} — {title} has no arrival details yet</p>
                    <p className="mt-1 text-sm text-amber-900/80">
                        Add the last bit of the journey, parking and wifi so they’re not driving past the red postbox in the dark. Takes two minutes.
                    </p>
                    <Link href={`/edit-listing/${listingId}`} className="mt-2.5 inline-block rounded-lg bg-amber-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-amber-800">
                        Add arrival details
                    </Link>
                </div>
            </div>
        </div>
    );
}
