'use client';

import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { getImageUrl, displayName } from '@/lib/utils';
import InviteSheet, { Seat, Profile } from './InviteSheet';

// The group coming on a trip, the way Airbnb shows it — a summary row with the
// party stacked as avatars, opening the shared InviteSheet. The sheet, the share
// channels and every per-seat action live in one component used here and on the
// experience side, so the invite flow is identical everywhere.
//
// SERVER-AUTHORITATIVE, like ExperienceGroup. The seats are NOT read from the
// browser: booking_guests can't be selected client-side (the "order guests
// readable" RLS policy references service_orders, which the authenticated role
// can't read, so any authenticated select on booking_guests throws and the sheet
// saw an empty party while the card, counting off `guests`, showed empty seats).
// So the faces come from server-rendered `initialSeats`, and opening the sheet
// mints the seats through /api/booking-guests and takes the fresh list back.

const PALETTE = ['bg-emerald-600', 'bg-sky-600', 'bg-amber-600', 'bg-rose-600', 'bg-violet-600', 'bg-teal-600'];

function initials(nameOrEmail: string): string {
    const s = (nameOrEmail || '').trim();
    if (!s) return '?';
    const at = s.indexOf('@');
    const base = at > 0 ? s.slice(0, at) : s;
    const words = base.split(/[\s._-]+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return base.slice(0, 2).toUpperCase();
}
function colorFor(seed: string): string {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
}
function avatarSrc(url: string | null | undefined): string | null {
    if (!url) return null;
    return /^https?:\/\//.test(url) ? url : getImageUrl(url);
}
export default function TripGroup({
    bookingId, guests, cottage, when, initialSeats = [], initialProfiles = {},
}: {
    bookingId: string; guests?: number | null; cottage?: string; when?: string;
    initialSeats?: Seat[]; initialProfiles?: Record<string, Profile>;
}) {
    const [people, setPeople] = useState<Seat[]>(initialSeats);
    const [profiles, setProfiles] = useState<Record<string, Profile>>(initialProfiles);
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);

    // Mint this booking's seats (idempotent, capped at guests − 1) and take the
    // fresh list back from the response — the browser can't read the seats
    // directly. Done on OPEN, not on mount, so browsing never creates links.
    const refetch = async () => {
        const res = await fetch('/api/booking-guests', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'ensure-seats', bookingId }),
        }).catch(() => null);
        if (res) {
            try {
                const d = await res.json();
                if (d && Array.isArray(d.seats)) setPeople(d.seats as Seat[]);
                if (d && d.profiles) setProfiles(d.profiles as Record<string, Profile>);
            } catch { /* ignore */ }
        }
    };

    const openSheet = async () => {
        setOpen(true); setLoading(true);
        await refetch();
        setLoading(false);
    };

    const accepted = (p: Seat) => p.status === 'active';
    const nameOf = (p: Seat) => {
        const prof = p.user_id ? profiles[p.user_id] : undefined;
        return (prof && displayName(prof, '')) || p.name || p.email || 'Guest';
    };
    // Just the people, as avatars — the booker plus anyone who has accepted. No
    // count text and no empty-seat placeholders: the group reads as faces and an
    // Invite button, nothing else (the "to fill" wording lives only inside the
    // sheet now). Room to invite is whether the party (minus the booker) still has
    // an unfilled place; when unknown, the button shows.
    const goingPeople = people.filter(accepted);
    const party = guests && guests > 0 ? guests : null;
    const roomLeft = party ? goingPeople.length < party - 1 : true;

    const Avatar = ({ p }: { p: Seat }) => {
        const prof = p.user_id ? profiles[p.user_id] : undefined;
        const photo = avatarSrc(prof && prof.avatar_url);
        if (photo) return <img src={photo} alt="" className="h-9 w-9 flex-none rounded-full object-cover text-xs ring-2 ring-white" />;
        return <div className={'flex h-9 w-9 flex-none items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-white ' + colorFor(p.email || nameOf(p))}>{initials(nameOf(p))}</div>;
    };

    const stackShown = goingPeople.slice(0, 5);
    const overflow = goingPeople.length - stackShown.length;

    return (
        <div className="mt-3 flex items-center gap-3">
            <div className="flex items-center">
                <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white ring-2 ring-white">You</div>
                <div className="flex -space-x-2 pl-1">
                    {stackShown.map((p) => <Avatar key={p.id} p={p} />)}
                    {overflow > 0 && (<div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 ring-2 ring-white">+{overflow}</div>)}
                </div>
            </div>

            {roomLeft && (
                <button
                    type="button"
                    onClick={openSheet}
                    className="inline-flex flex-none items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50"
                >
                    <UserPlus className="h-4 w-4 text-slate-500" /> Invite guests
                </button>
            )}

            <InviteSheet
                open={open}
                onClose={() => setOpen(false)}
                context={{ place: cottage || '', when, noun: 'trip' }}
                people={people}
                profiles={profiles}
                loading={loading}
                refetch={refetch}
            />
        </div>
    );
}
