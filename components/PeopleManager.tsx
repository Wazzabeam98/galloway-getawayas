'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';
import { Trash2, UserPlus, Mail, Crown } from 'lucide-react';

export interface ManagedListing {
    id: string;
    title: string;
    // Whether the person viewing this page owns this listing. Only an owner may
    // create another full-access co-host, so the toggles respect it.
    viewerIsOwner: boolean;
    primaryHost: { name: string; isYou: boolean };
}

export interface Person {
    id: string;
    listing_id: string;
    name: string;
    email: string;
    isYou: boolean;
    status: string;
    can_calendar: boolean;
    can_messages: boolean;
    can_bookings: boolean;
    can_listing: boolean;
    can_earnings: boolean;
}

type PermKey = 'can_calendar' | 'can_messages' | 'can_bookings' | 'can_listing' | 'can_earnings';

const PERMISSIONS: { key: PermKey; label: string; hint: string }[] = [
    { key: 'can_calendar', label: 'Calendar and pricing', hint: 'Block dates, change prices, set fees' },
    { key: 'can_messages', label: 'Guest messages and reviews', hint: 'Read and reply to guests; see reviews' },
    { key: 'can_bookings', label: 'Booking requests', hint: 'See reservations, accept and decline' },
    { key: 'can_listing', label: 'Edit the listing', hint: 'Photos, description, amenities' },
    { key: 'can_earnings', label: 'Earnings', hint: 'See what this property makes' },
];

const PERM_KEYS: PermKey[] = PERMISSIONS.map((p) => p.key);

// The named tiers Airbnb shows, with a Custom fallback for any other mix. Full
// access is the owner's equal.
function accessLevel(p: Record<PermKey, boolean>): string {
    const on = PERM_KEYS.filter((k) => p[k]);
    if (on.length === 5) return 'Full access';
    if (on.length === 1 && p.can_calendar) return 'Calendar only';
    if (on.length === 2 && p.can_calendar && p.can_messages) return 'Calendar and messaging';
    return 'Custom access';
}

const isFull = (p: Record<PermKey, boolean>) => PERM_KEYS.every((k) => p[k]);

export default function PeopleManager({
    listings,
    people,
}: {
    listings: ManagedListing[];
    people: Person[];
}) {
    const router = useRouter();
    const [inviting, setInviting] = useState(false);

    const [listingId, setListingId] = useState(listings[0]?.id || '');
    const [email, setEmail] = useState('');
    const [perms, setPerms] = useState<Record<PermKey, boolean>>({
        can_calendar: true,
        can_messages: true,
        can_bookings: false,
        can_listing: false,
        can_earnings: false,
    });

    const call = async (payload: any) => {
        const res = await fetch('/api/listing-access', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        return res.json();
    };

    const selected = listings.find((l) => l.id === listingId);
    const inviteWouldBeFull = isFull(perms);
    const inviteBlocked = inviteWouldBeFull && selected ? !selected.viewerIsOwner : false;

    const invite = async () => {
        if (inviteBlocked) {
            toast.error('Only the owner can give a co-host full access.', { theme: 'colored' });
            return;
        }
        setInviting(true);
        const data = await call({ action: 'invite', listingId, email, role: 'co_host', ...perms });
        setInviting(false);

        if (data && data.ok) {
            toast.success('Invitation sent.', { theme: 'colored' });
            setEmail('');
            router.refresh();
        } else {
            toast.error((data && data.error) || 'Could not send that invitation.', { theme: 'colored' });
        }
    };

    const togglePermission = async (row: Person, key: PermKey) => {
        const next = { ...row, [key]: !row[key] } as Person;
        const owner = listings.find((l) => l.id === row.listing_id)?.viewerIsOwner;
        if (isFull(next) && !owner) {
            toast.error('Only the owner can give a co-host full access.', { theme: 'colored' });
            return;
        }

        const data = await call({
            action: 'update',
            accessId: row.id,
            can_calendar: next.can_calendar,
            can_messages: next.can_messages,
            can_bookings: next.can_bookings,
            can_listing: next.can_listing,
            can_earnings: next.can_earnings,
        });

        if (data && data.ok) {
            router.refresh();
        } else {
            toast.error((data && data.error) || 'Could not save that change.', { theme: 'colored' });
        }
    };

    const revoke = async (row: Person) => {
        if (!confirm('Remove ' + row.name + ' from this property?')) return;
        const data = await call({ action: 'revoke', accessId: row.id });
        if (data && data.ok) {
            toast.success('Removed.', { theme: 'colored' });
            router.refresh();
        } else {
            toast.error('Could not remove them.', { theme: 'colored' });
        }
    };

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
                        <label className="block text-sm font-semibold text-slate-800 mb-1">Which property</label>
                        <select
                            value={listingId}
                            onChange={(e) => setListingId(e.target.value)}
                            className="w-full p-3 border rounded-xl text-sm bg-white"
                        >
                            {listings.map((l) => (
                                <option key={l.id} value={l.id}>{l.title}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-800 mb-1">Their email</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="them@example.com"
                            className="w-full p-3 border rounded-xl text-sm"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-800 mb-2">What they can do</label>
                        <div className="space-y-2">
                            {PERMISSIONS.map((p) => (
                                <label
                                    key={p.key}
                                    className="flex items-start gap-3 border rounded-xl p-3 cursor-pointer hover:border-slate-400"
                                >
                                    <input
                                        type="checkbox"
                                        checked={!!perms[p.key]}
                                        onChange={(e) => setPerms({ ...perms, [p.key]: e.target.checked })}
                                        className="mt-0.5 w-4 h-4 rounded accent-emerald-700"
                                    />
                                    <span>
                                        <span className="block text-sm font-medium text-slate-800">{p.label}</span>
                                        <span className="block text-xs text-slate-500">{p.hint}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                        <p className="text-xs text-slate-400 mt-3">
                            Every permission ticked makes a full-access co-host — your equal. They can
                            still never see your payout bank details, delete the listing, or change who
                            the primary host is. {inviteBlocked && (
                                <span className="text-amber-700 font-medium">Only the owner can give full access.</span>
                            )}
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={invite}
                        disabled={inviting || inviteBlocked}
                        className="inline-flex items-center gap-2 px-5 py-3 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl disabled:opacity-50"
                    >
                        <UserPlus className="w-4 h-4" />
                        {inviting ? 'Sending…' : 'Send invitation'}
                    </button>
                </div>
            </div>

            <h2 className="font-bold text-slate-900 mb-3">Who has access</h2>

            <div className="space-y-8">
                {listings.map((l) => {
                    const cohosts = people.filter((p) => p.listing_id === l.id);
                    return (
                        <div key={l.id}>
                            <div className="text-sm font-semibold text-slate-500 mb-3">{l.title}</div>

                            {/* The primary host — the owner — sits at the top, as on
                                Airbnb. Their seat never changes from here. */}
                            <div className="border rounded-2xl p-5 mb-3 bg-slate-50">
                                <div className="flex items-center gap-2">
                                    <Crown className="w-4 h-4 text-amber-500 flex-none" />
                                    <span className="font-semibold text-slate-900">
                                        {l.primaryHost.name}{l.primaryHost.isYou ? ' (you)' : ''}
                                    </span>
                                    <span className="text-xs font-semibold text-slate-500 ml-auto">Primary host</span>
                                </div>
                            </div>

                            {cohosts.length === 0 ? (
                                <p className="text-sm text-slate-400 border rounded-2xl p-5">
                                    No co-hosts yet.
                                </p>
                            ) : (
                                <div className="space-y-3">
                                    {cohosts.map((row) => {
                                        const level = accessLevel(row);
                                        return (
                                            <div key={row.id} className="border rounded-2xl p-5">
                                                <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
                                                    <div className="min-w-0">
                                                        <div className="font-semibold text-slate-900 truncate">
                                                            {row.name}{row.isYou ? ' (you)' : ''}
                                                        </div>
                                                        <div className="text-sm text-slate-500">
                                                            Co-host · {level}
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
                                                        const on = row[p.key];
                                                        return (
                                                            <button
                                                                key={p.key}
                                                                type="button"
                                                                onClick={() => togglePermission(row, p.key)}
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
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
