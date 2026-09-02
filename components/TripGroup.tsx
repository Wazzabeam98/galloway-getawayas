'use client';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { toast } from 'react-toastify';
import { UserPlus, X, Mail } from 'lucide-react';

interface Companion {
    id: string;
    email: string;
    name: string | null;
    status: string;
    user_id: string | null;
}

// Lets whoever booked add the people coming with them. They get the address,
// the dates and a way to message the host — not the price, and no way to
// change anything.
export default function TripGroup({ bookingId }: { bookingId: string }) {
    const supabase = createClientComponentClient();
    const [people, setPeople] = useState<Companion[]>([]);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [sending, setSending] = useState(false);

    const load = async () => {
        const { data } = await supabase
            .from('booking_guests')
            .select('id, email, name, status, user_id')
            .eq('booking_id', bookingId)
            .neq('status', 'removed')
            .order('invited_at');

        setPeople(data || []);
        setLoading(false);
    };

    useEffect(() => {
        load();
    }, [bookingId]);

    const invite = async () => {
        if (!email.trim()) {
            toast.error('Enter their email address.', { theme: 'colored' });
            return;
        }

        setSending(true);
        try {
            const res = await fetch('/api/booking-guests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'invite',
                    bookingId: bookingId,
                    email: email.trim(),
                    name: name.trim(),
                }),
            });
            const data = await res.json();

            if (data && data.ok) {
                toast.success('Invitation sent.', { theme: 'colored' });
                setEmail('');
                setName('');
                load();
            } else {
                toast.error((data && data.error) || 'Could not send that.', { theme: 'colored' });
            }
        } catch (err) {
            toast.error('Could not send that.', { theme: 'colored' });
        }
        setSending(false);
    };

    const remove = async (person: Companion) => {
        const who = person.name || person.email;
        if (!confirm('Take ' + who + ' off this trip?')) return;

        const res = await fetch('/api/booking-guests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'remove', guestId: person.id }),
        });
        const data = await res.json();

        if (data && data.ok) {
            load();
        } else {
            toast.error('Could not do that.', { theme: 'colored' });
        }
    };

    if (loading) return null;

    return (
        // mt-2 so the "Add the people" control sits with the secondary actions
        // (Message host) as one group on the trip card, not adrift below them.
        <div className="mt-2">
            {people.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                    {people.map((p) => (
                        <span
                            key={p.id}
                            className="inline-flex items-center gap-1.5 text-xs bg-slate-100 text-slate-700 rounded-full pl-3 pr-1.5 py-1"
                        >
                            {p.name || p.email}
                            {p.status === 'invited' && (
                                <Mail className="w-3 h-3 text-amber-600" />
                            )}
                            <button
                                type="button"
                                onClick={() => remove(p)}
                                className="text-slate-400 hover:text-red-600"
                                title="Take them off this trip"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </span>
                    ))}
                </div>
            )}

            {!open ? (
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-400"
                >
                    <UserPlus className="w-3.5 h-3.5" />
                    {people.length > 0 ? 'Add someone else' : 'Add the people coming with you'}
                </button>
            ) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-sm text-slate-700 mb-3">
                        They&apos;ll see where you&apos;re going, the dates and how to get in, and
                        can message the host. They won&apos;t see what you paid or be able to change
                        anything.
                    </p>

                    <div className="space-y-2">
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Their name (optional)"
                            className="w-full p-2.5 border rounded-lg text-sm"
                        />
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="their@email.com"
                            className="w-full p-2.5 border rounded-lg text-sm"
                        />
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={invite}
                                disabled={sending}
                                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
                            >
                                {sending ? 'Sending…' : 'Send invitation'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="px-3 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
