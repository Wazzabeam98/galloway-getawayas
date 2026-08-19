'use client';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { toast } from 'react-toastify';
import { Trash2, UserPlus, Mail } from 'lucide-react';

interface Access {
    id: string;
    listing_id: string;
    email: string;
    role: string;
    status: string;
    can_calendar: boolean;
    can_messages: boolean;
    can_bookings: boolean;
    can_listing: boolean;
    can_earnings: boolean;
}

const PERMISSIONS: { key: keyof Access; label: string; hint: string }[] = [
    { key: 'can_calendar', label: 'Calendar and pricing', hint: 'Block dates, change prices, set fees' },
    { key: 'can_messages', label: 'Guest messages', hint: 'Read and reply to guests' },
    { key: 'can_bookings', label: 'Booking requests', hint: 'Accept and decline requests' },
    { key: 'can_listing', label: 'Edit the listing', hint: 'Photos, description, amenities' },
    { key: 'can_earnings', label: 'Earnings', hint: 'See what this property makes' },
];

export default function PeopleManager({
    listings,
}: {
    listings: { id: string; title: string }[];
}) {
    const supabase = createClientComponentClient();
    const [rows, setRows] = useState<Access[]>([]);
    const [loading, setLoading] = useState(true);
    const [inviting, setInviting] = useState(false);

    const [listingId, setListingId] = useState(listings[0]?.id || '');
    const [email, setEmail] = useState('');
    const [perms, setPerms] = useState<Record<string, boolean>>({
        can_calendar: true,
        can_messages: true,
        can_bookings: false,
        can_listing: false,
        can_earnings: false,
    });

    const load = async () => {
        const ids = listings.map((l) => l.id);
        if (ids.length === 0) {
            setLoading(false);
            return;
        }

        const { data } = await supabase
            .from('listing_access')
            .select('*')
            .in('listing_id', ids)
            .neq('status', 'revoked')
            .order('invited_at', { ascending: false });

        setRows(data || []);
        setLoading(false);
    };

    useEffect(() => {
        load();
    }, []);

    const call = async (payload: any) => {
        const res = await fetch('/api/listing-access', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        return res.json();
    };

    const invite = async () => {
        setInviting(true);
        const data = await call({
            action: 'invite',
            listingId: listingId,
            email: email,
            role: 'co_host',
            ...perms,
        });
        setInviting(false);

        if (data && data.ok) {
            toast.success('Invitation sent.', { theme: 'colored' });
            setEmail('');
            load();
        } else {
            toast.error((data && data.error) || 'Could not send that invitation.', { theme: 'colored' });
        }
    };

    const togglePermission = async (row: Access, key: string) => {
        const next = { ...row, [key]: !(row as any)[key] };
        setRows((prev) => prev.map((r) => (r.id === row.id ? (next as Access) : r)));

        const data = await call({
            action: 'update',
            accessId: row.id,
            can_calendar: next.can_calendar,
            can_messages: next.can_messages,
            can_bookings: next.can_bookings,
            can_listing: next.can_listing,
            can_earnings: next.can_earnings,
        });

        if (!data || !data.ok) {
            toast.error('Could not save that change.', { theme: 'colored' });
            load();
        }
    };

    const revoke = async (row: Access) => {
        if (!confirm('Remove ' + row.email + ' from this property?')) return;

        const data = await call({ action: 'revoke', accessId: row.id });

        if (data && data.ok) {
            toast.success('Removed.', { theme: 'colored' });
            load();
        } else {
            toast.error('Could not remove them.', { theme: 'colored' });
        }
    };

    const titleOf = (id: string) => listings.find((l) => l.id === id)?.title || 'Listing';

    if (listings.length === 0) {
        return (
            <p className="text-slate-500">
                Once you have a listing, you can invite people to help with it here.
            </p>
        );
    }

    return (
        <div>
            <div className="border rounded-2xl p-6 mb-8">
                <h2 className="font-bold text-slate-900 mb-1">Invite someone</h2>
                <p className="text-sm text-slate-500 mb-5">
                    They&apos;ll get an email. If they don&apos;t have an account yet they&apos;ll be
                    asked to make one first.
                </p>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-semibold text-slate-800 mb-1">
                            Which property
                        </label>
                        <select
                            value={listingId}
                            onChange={(e) => setListingId(e.target.value)}
                            className="w-full p-3 border rounded-xl text-sm bg-white"
                        >
                            {listings.map((l) => (
                                <option key={l.id} value={l.id}>
                                    {l.title}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-800 mb-1">
                            Their email
                        </label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="them@example.com"
                            className="w-full p-3 border rounded-xl text-sm"
                        />
                    </div>

                    <div>
                            <label className="block text-sm font-semibold text-slate-800 mb-2">
                                What they can do
                            </label>
                            <div className="space-y-2">
                                {PERMISSIONS.map((p) => (
                                    <label
                                        key={p.key as string}
                                        className="flex items-start gap-3 border rounded-xl p-3 cursor-pointer hover:border-slate-400"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={!!perms[p.key as string]}
                                            onChange={(e) =>
                                                setPerms({ ...perms, [p.key as string]: e.target.checked })
                                            }
                                            className="mt-0.5 w-4 h-4 rounded accent-emerald-700"
                                        />
                                        <span>
                                            <span className="block text-sm font-medium text-slate-800">
                                                {p.label}
                                            </span>
                                            <span className="block text-xs text-slate-500">{p.hint}</span>
                                        </span>
                                    </label>
                                ))}
                            </div>
                        <p className="text-xs text-slate-400 mt-3">
                            Whatever you tick, only you can cancel a confirmed booking, refund a
                            guest, change payout details, delete the listing, or invite anyone
                            else.
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={invite}
                        disabled={inviting}
                        className="inline-flex items-center gap-2 px-5 py-3 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl disabled:opacity-50"
                    >
                        <UserPlus className="w-4 h-4" />
                        {inviting ? 'Sending…' : 'Send invitation'}
                    </button>
                </div>
            </div>

            <h2 className="font-bold text-slate-900 mb-3">Who has access</h2>

            {loading ? (
                <p className="text-sm text-slate-400">Loading…</p>
            ) : rows.length === 0 ? (
                <p className="text-sm text-slate-400 border rounded-2xl p-5">
                    Nobody else has access to your properties.
                </p>
            ) : (
                <div className="space-y-3">
                    {rows.map((row) => (
                        <div key={row.id} className="border rounded-2xl p-5">
                            <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
                                <div className="min-w-0">
                                    <div className="font-semibold text-slate-900 truncate">
                                        {row.email}
                                    </div>
                                    <div className="text-sm text-slate-500">
                                        {titleOf(row.listing_id)}
                                    </div>
                                    {row.status === 'invited' && (
                                        <div className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                                            <Mail className="w-3 h-3" />
                                            Invited — waiting for them to accept
                                        </div>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => revoke(row)}
                                    title="Remove their access"
                                    className="text-slate-400 hover:text-red-600 flex-shrink-0"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                    {PERMISSIONS.map((p) => {
                                        const on = !!(row as any)[p.key];
                                        return (
                                            <button
                                                key={p.key as string}
                                                type="button"
                                                onClick={() => togglePermission(row, p.key as string)}
                                                className={
                                                    'text-xs font-semibold px-3 py-1.5 rounded-full border transition ' +
                                                    (on
                                                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                                        : 'text-slate-400 hover:border-slate-400')
                                                }
                                            >
                                                {p.label}
                                            </button>
                                        );
                                    })}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
