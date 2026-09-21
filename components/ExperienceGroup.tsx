'use client';

import { useState } from 'react';
import { UserPlus, User } from 'lucide-react';
import { getImageUrl, displayName } from '@/lib/utils';
import InviteSheet, { Seat, Profile } from './InviteSheet';

// Who's going to a booked experience. The faces are the people actually on it —
// the booker, plus anyone who has accepted — and NOTHING else: an unclaimed seat
// is not shown as a blank placeholder, so a booking that is just you reads as
// just you. Inviting opens the SAME sheet the holiday-let side uses (Copy, Email,
// Messages, WhatsApp, Messenger), so the flow is identical everywhere.
//
// An order's seats aren't client-readable (service_orders is revoked from the
// browser), so unlike the cottage side this reads them through the service-role
// /api/booking-guests route: the faces come from the server-rendered initial
// seats, and opening the sheet mints the seats and refetches.
//
// A companion sees this READ-ONLY (faces only) and, by the page's money wall,
// never a price.

function avatarSrc(url: string | null | undefined): string | null {
    if (!url) return null;
    return /^https?:\/\//.test(url) ? url : getImageUrl(url);
}

function Face({ name, photo }: { name: string; photo: string | null }) {
    if (photo) return <img src={photo} alt="" className="h-11 w-11 flex-none rounded-full object-cover ring-2 ring-white" />;
    return <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-500 ring-2 ring-white">{(name || '?').slice(0, 1).toUpperCase()}</span>;
}

export default function ExperienceGroup({
    orderId,
    bookerName,
    bookerAvatar,
    attendees,
    experienceName,
    readOnly = false,
    initialSeats = [],
    initialProfiles = {},
}: {
    orderId: string;
    bookerName: string;
    bookerAvatar: string | null;
    attendees: number;
    experienceName?: string;
    readOnly?: boolean;
    initialSeats?: Seat[];
    initialProfiles?: Record<string, Profile>;
    // Accepted but unused: the stay-prefill picker is gone now the invite flow is
    // the shared link sheet. Kept optional so the page's call needn't change.
    prefill?: unknown;
}) {
    const [seats, setSeats] = useState<Seat[]>(initialSeats);
    const [profiles, setProfiles] = useState<Record<string, Profile>>(initialProfiles);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    const active = seats.filter((s) => s.status === 'active');
    const cap = Math.max(0, (attendees || 1) - 1);
    const placesToFill = Math.max(0, cap - active.length);

    const nameOf = (s: Seat) => {
        const prof = s.user_id ? profiles[s.user_id] : undefined;
        return (prof && displayName(prof, '')) || s.name || s.email || 'Guest';
    };

    // Mint this order's seats (idempotent, capped) and take the fresh list back.
    // Done on OPEN, not on load, so viewing the page never creates invite links.
    const refetch = async () => {
        const res = await fetch('/api/booking-guests', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'ensure-seats', orderId }),
        }).catch(() => null);
        if (res) {
            try {
                const d = await res.json();
                if (d && Array.isArray(d.seats)) setSeats(d.seats as Seat[]);
                if (d && d.profiles) setProfiles(d.profiles as Record<string, Profile>);
            } catch { /* ignore */ }
        }
    };

    const openSheet = async () => {
        setOpen(true); setLoading(true);
        await refetch();
        setLoading(false);
    };

    // Just the avatars — the booker plus anyone who has accepted — as an
    // overlapping stack. No names and no count text beside them; the group reads
    // as faces and (for the booker) an Invite button, nothing else.
    const faces = (
        <div className="flex items-center -space-x-2">
            <Face name={bookerName} photo={avatarSrc(bookerAvatar)} />
            {active.map((s) => (
                <Face key={s.id} name={nameOf(s)} photo={avatarSrc(s.user_id ? profiles[s.user_id]?.avatar_url : null)} />
            ))}
        </div>
    );

    if (readOnly) {
        return (
            <div>
                {faces}
                {active.length === 0 && <p className="mt-2 text-sm text-slate-500">You’re going to this one.</p>}
            </div>
        );
    }

    return (
        <div>
            {/* Avatar(s) and the invite button share one row, the button sitting
                directly beside the faces rather than pushed out to the far right. */}
            <div className="flex items-center gap-3">
                {faces}

                {placesToFill > 0 && (
                    <button
                        type="button"
                        onClick={openSheet}
                        className="inline-flex flex-none items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50"
                    >
                        <UserPlus className="h-4 w-4 text-slate-500" />
                        {active.length === 0 ? 'Invite guests' : 'Invite more'}
                    </button>
                )}
            </div>

            <InviteSheet
                open={open}
                onClose={() => setOpen(false)}
                context={{ place: experienceName || '', noun: 'experience' }}
                people={seats}
                profiles={profiles}
                loading={loading}
                refetch={refetch}
            />
        </div>
    );
}
