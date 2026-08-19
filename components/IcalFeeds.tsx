'use client';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { toast } from 'react-toastify';
import { Trash2, Plus } from 'lucide-react';

interface Feed {
    id: string;
    url: string;
    label: string | null;
    last_synced_at: string | null;
    last_status: string | null;
    last_error: string | null;
}

// Most hosts list in more than one place, and each platform gives out its own
// export link. Syncing only one of them is how a host ends up double booked.
export default function IcalFeeds({ listingId }: { listingId: string }) {
    const supabase = createClientComponentClient();
    const [feeds, setFeeds] = useState<Feed[]>([]);
    const [loading, setLoading] = useState(true);
    const [label, setLabel] = useState('');
    const [url, setUrl] = useState('');
    const [saving, setSaving] = useState(false);

    const load = async () => {
        const { data } = await supabase
            .from('listing_ical_feeds')
            .select('id, url, label, last_synced_at, last_status, last_error')
            .eq('listing_id', listingId)
            .order('created_at');

        setFeeds(data || []);
        setLoading(false);
    };

    useEffect(() => {
        load();
    }, [listingId]);

    const add = async () => {
        const trimmed = url.trim();

        if (!trimmed) {
            toast.error('Paste the calendar link first.', { theme: 'colored' });
            return;
        }

        if (!/^https?:\/\//i.test(trimmed)) {
            toast.error('That should start with https://', { theme: 'colored' });
            return;
        }

        if (feeds.some((f) => f.url === trimmed)) {
            toast.error('That calendar is already here.', { theme: 'colored' });
            return;
        }

        setSaving(true);

        const { error } = await supabase.from('listing_ical_feeds').insert({
            listing_id: listingId,
            url: trimmed,
            label: label.trim() || null,
        });

        setSaving(false);

        if (error) {
            toast.error(error.message, { theme: 'colored' });
            return;
        }

        setUrl('');
        setLabel('');
        toast.success('Calendar added.', { theme: 'colored' });
        load();
    };

    const remove = async (id: string) => {
        const { error } = await supabase.from('listing_ical_feeds').delete().eq('id', id);

        if (error) {
            toast.error(error.message, { theme: 'colored' });
            return;
        }

        toast.success('Calendar removed.', { theme: 'colored' });
        load();
    };

    return (
        <div>
            <p className="text-xs text-slate-400 mb-4">
                Add the export link from every other site this place is listed on, so bookings made
                there block these dates too. We check them when a guest views your listing. How
                up to date they are depends on how often that site refreshes its own export — this
                isn&apos;t instant at their end either.
            </p>

            {loading ? (
                <p className="text-sm text-slate-400 mb-4">Loading…</p>
            ) : feeds.length === 0 ? (
                <p className="text-sm text-slate-400 mb-4">No calendars connected yet.</p>
            ) : (
                <div className="space-y-2 mb-4">
                    {feeds.map((f) => (
                        <div
                            key={f.id}
                            className="flex items-start justify-between gap-3 border rounded-xl px-3 py-2.5"
                        >
                            <div className="min-w-0">
                                <div className="text-sm font-medium text-slate-800">
                                    {f.label || 'Calendar'}
                                </div>
                                <div className="text-xs text-slate-400 truncate">{f.url}</div>
                                {f.last_status === 'failed' && (
                                    <div className="text-xs text-red-600 mt-0.5">
                                        Couldn&apos;t be reached last time{f.last_error ? ' — ' + f.last_error : ''}
                                    </div>
                                )}
                                {f.last_status === 'ok' && (
                                    <div className="text-xs text-emerald-700 mt-0.5">Syncing fine</div>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={() => remove(f.id)}
                                title="Remove this calendar"
                                className="text-slate-400 hover:text-red-600 flex-shrink-0"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <div className="space-y-2">
                <input
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Where it's from — Airbnb, Booking.com…"
                    className="w-full p-3 border rounded-xl text-sm"
                />
                <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://www.airbnb.com/calendar/ical/....ics"
                    className="w-full p-3 border rounded-xl text-sm"
                />
                <button
                    type="button"
                    onClick={add}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-black text-white text-sm font-semibold rounded-xl disabled:opacity-50"
                >
                    <Plus className="w-4 h-4" />
                    {saving ? 'Adding…' : 'Add calendar'}
                </button>
            </div>
        </div>
    );
}
