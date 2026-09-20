'use client';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { UserPlus, User } from 'lucide-react';
import { getImageUrl, displayName } from '@/lib/utils';
import InviteSheet, { Seat, Profile } from './InviteSheet';

// The group coming on a trip, the way Airbnb shows it — a summary row with the
// party stacked as avatars, opening the shared InviteSheet. The sheet, the share
// channels and every per-seat action now live in one component used here and on
// the experience side, so the invite flow is identical everywhere; this file is
// only the trips-card trigger and the booking's own way of reading its seats
// (client-side under RLS — a booking is authenticated-readable, an order is not).

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
function EmptySeat({ size = 'md' }: { size?: 'sm' | 'md' }) {
    const dim = size === 'sm' ? 'h-9 w-9' : 'h-10 w-10';
    return (<div className={'flex flex-none items-center justify-center rounded-full bg-slate-200 text-slate-400 ring-2 ring-white ' + dim}><User className="h-4 w-4" /></div>);
}

export default function TripGroup({
    bookingId, guests, cottage, when,
}: {
    bookingId: string; guests?: number | null; cottage?: string; when?: string;
}) {
    const supabase = createClientComponentClient();
    const [people, setPeople] = useState<Seat[]>([]);
    const [profiles, setProfiles] = useState<Record<string, Profile>>({});
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);

    const load = async () => {
        const { data } = await supabase
            .from('booking_guests')
            .select('id, email, name, status, user_id, invite_token, link_sent_at')
            .eq('booking_id', bookingId)
            .neq('status', 'removed')
            .order('invited_at');
        const rows = (data as Seat[]) || [];
        setPeople(rows);
        const ids = rows.filter((p) => p.user_id).map((p) => p.user_id as string);
        if (ids.length) {
            const { data: profRows } = await supabase.from('profiles').select('id, avatar_url, full_name, preferred_name, show_full_name').in('id', ids);
            const map: Record<string, Profile> = {};
            (profRows as Profile[] | null)?.forEach((p) => { map[p.id] = p; });
            setProfiles(map);
        } else setProfiles({});
        setLoading(false);
    };

    // The card reads without minting — only OPENING the sheet fills the seats, so
    // browsing the trips list never creates links.
    useEffect(() => { load(); }, [bookingId]);

    const openSheet = async () => {
        setOpen(true);
        await fetch('/api/booking-guests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ensure-seats', bookingId }) }).catch(() => {});
        await load();
    };

    if (loading && !open) return null;

    const accepted = (p: Seat) => p.status === 'active';
    const nameOf = (p: Seat) => {
        const prof = p.user_id ? profiles[p.user_id] : undefined;
        return (prof && displayName(prof, '')) || p.name || p.email || 'Guest';
    };
    const going = people.filter(accepted).length;
    const toFill = people.length - going;
    const party = guests && guests > 0 ? guests : null;
    const emptySeats = party ? Math.max(0, party - 1 - people.length) : 0;
    const nothingYet = people.length === 0 && emptySeats === 0;
    const openLabelN = emptySeats || toFill;

    const Avatar = ({ p }: { p: Seat }) => {
        if (!accepted(p)) return <EmptySeat size="sm" />;
        const prof = p.user_id ? profiles[p.user_id] : undefined;
        const photo = avatarSrc(prof && prof.avatar_url);
        if (photo) return <img src={photo} alt="" className="h-9 w-9 flex-none rounded-full object-cover text-xs ring-2 ring-white" />;
        return <div className={'flex h-9 w-9 flex-none items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-white ' + colorFor(p.email || nameOf(p))}>{initials(nameOf(p))}</div>;
    };

    const stackShown = people.slice(0, 5);
    const overflow = people.length - stackShown.length;

    return (
        <div className="mt-3">
            <button type="button" onClick={openSheet} className="group flex w-full items-center gap-3 rounded-xl border border-transparent px-1 py-1 text-left transition hover:border-slate-200 hover:bg-slate-50">
                <div className="flex items-center">
                    <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white ring-2 ring-white">You</div>
                    <div className="flex -space-x-2 pl-1">
                        {stackShown.map((p) => <Avatar key={p.id} p={p} />)}
                        {Array.from({ length: Math.min(emptySeats, overflow > 0 ? 0 : 6 - stackShown.length) }).map((_, i) => (<EmptySeat key={'e' + i} size="sm" />))}
                        {overflow > 0 && (<div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 ring-2 ring-white">+{overflow}</div>)}
                    </div>
                </div>
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-900">
                        {nothingYet ? 'Add the people coming with you' : going === 0 ? 'Invite guests' : 'You and ' + going + ' going' + (openLabelN ? ' · ' + openLabelN + ' to fill' : '')}
                    </div>
                    <div className="text-xs text-slate-500 group-hover:text-slate-700">{nothingYet ? 'Share a link — no email needed.' : 'Manage the group'}</div>
                </div>
                <UserPlus className="h-4 w-4 flex-none text-slate-400 group-hover:text-slate-700" />
            </button>

            <InviteSheet
                open={open}
                onClose={() => setOpen(false)}
                context={{ place: cottage || '', when, noun: 'trip' }}
                people={people}
                profiles={profiles}
                loading={loading}
                refetch={load}
            />
        </div>
    );
}
