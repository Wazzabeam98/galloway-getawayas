'use client';

// Co-host invitations waiting for the signed-in person, with Accept and
// Decline — on the dashboard and the home page, the way Airbnb puts an
// invitation in front of you the moment you sign in, so it can't be missed if
// the email went to junk and no push arrived. Renders nothing when there are
// none, or when nobody is signed in.

import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Users } from 'lucide-react';
import { bookingsChanged } from '@/components/base/useBadgeCounts';

type Invite = { token: string; listingId: string; listingTitle: string; role: 'co_host' | 'staff'; inviterFirst: string };

export default function CohostInvites({ className }: { className?: string }) {
    const [invites, setInvites] = useState<Invite[]>([]);
    const [busy, setBusy] = useState<string | null>(null);

    useEffect(() => {
        fetch('/api/listing-access/pending')
            .then((r) => (r.ok ? r.json() : { invites: [] }))
            .then((d) => setInvites((d && d.invites) || []))
            .catch(() => setInvites([]));
    }, []);

    if (invites.length === 0) return null;

    const answer = async (inv: Invite, accept: boolean) => {
        setBusy(inv.token);
        try {
            const res = await fetch(accept ? '/api/listing-access/accept' : '/api/listing-access/decline', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: inv.token }),
            });
            const d = await res.json().catch(() => null);
            if (!res.ok || !d || !d.ok) {
                toast.error((d && d.error) || 'That didn’t work. Please try again.', { theme: 'colored' });
                return;
            }
            bookingsChanged();
            if (accept) {
                // Into the host side, with the new property in it.
                window.location.assign('/dashboard');
                return;
            }
            setInvites((list) => list.filter((x) => x.token !== inv.token));
            toast.success('Invitation declined.', { theme: 'colored' });
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className={className}>
            <div className="space-y-3">
                {invites.map((inv) => (
                    <div key={inv.token} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_6px_16px_rgba(0,0,0,0.12)] sm:p-5">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex gap-3">
                                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                                    <Users className="h-5 w-5" />
                                </div>
                                <div>
                                    <p className="font-semibold text-slate-900">
                                        {inv.inviterFirst} invited you to {inv.role === 'staff' ? 'help with' : 'co-host'} {inv.listingTitle}
                                    </p>
                                    <p className="mt-0.5 text-sm text-slate-600">
                                        Accept to help manage it on Galloway Getaways. You&rsquo;ll see exactly what you can do once you&rsquo;re in.
                                    </p>
                                </div>
                            </div>
                            <div className="flex flex-none items-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => answer(inv, false)}
                                    disabled={busy === inv.token}
                                    className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:border-slate-900 disabled:opacity-50"
                                >
                                    Decline
                                </button>
                                <button
                                    type="button"
                                    onClick={() => answer(inv, true)}
                                    disabled={busy === inv.token}
                                    className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                                >
                                    Accept
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
