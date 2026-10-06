'use client';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { toast } from 'react-toastify';
import { Trash2 } from 'lucide-react';
import { feedUrlProblem } from '@/lib/feedUrl';

interface Feed {
    id: string;
    url: string;
    label: string | null;
    last_synced_at: string | null;
    last_status: string | null;
    last_error: string | null;
}

// Calendar sync as short numbered steps, one set per site: copy our link, paste
// it into theirs, copy their export link, paste it here. Most hosts list in more
// than one place, and syncing only one of them is how a host ends up double
// booked, so each site has its own steps and its own connected calendar.
const SITES = [
    {
        key: 'Airbnb',
        importAt: 'In Airbnb, go to Calendar → Availability → Connect calendars and paste it',
        exportAt: 'Copy Airbnb’s export link',
        placeholder: 'https://www.airbnb.co.uk/calendar/ical/….ics',
    },
    {
        key: 'Booking.com',
        importAt: 'In Booking.com, go to Rates & Availability → Sync calendars and paste it',
        exportAt: 'Copy Booking.com’s export link',
        placeholder: 'https://admin.booking.com/hotel/hoteladmin/ical.html?…',
    },
    {
        key: 'Vrbo',
        importAt: 'In Vrbo, go to Calendar → Import & Export → Import a calendar and paste it',
        exportAt: 'Copy Vrbo’s export link from Import & Export → Export calendar',
        placeholder: 'https://www.vrbo.com/icalendar/….ics',
    },
    {
        key: 'Other',
        importAt: 'Paste it into the other site’s calendar import',
        exportAt: 'Copy that site’s export link',
        placeholder: 'https://….ics',
    },
];

export default function IcalFeeds({ listingId, exportUrl }: { listingId: string; exportUrl: string | null }) {
    const supabase = createClientComponentClient();
    const [feeds, setFeeds] = useState<Feed[]>([]);
    const [loading, setLoading] = useState(true);
    const [site, setSite] = useState(SITES[0]);
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [listingId]);

    const copy = () => {
        if (!exportUrl) {
            toast.error('Your link isn’t ready yet — reload the page.', { theme: 'colored' });
            return;
        }
        navigator.clipboard.writeText(exportUrl);
        toast.success('Copied', { theme: 'colored', autoClose: 1500 });
    };

    const save = async () => {
        const trimmed = url.trim();

        if (!trimmed) {
            toast.error('Paste the link first.', { theme: 'colored' });
            return;
        }

        // The same safety rule the server enforces before it ever fetches the
        // feed (public https only, nothing pointing at a private/loopback/metadata
        // address) — checked here too so a host gets a clear message up front
        // rather than a feed that silently never syncs.
        const problem = feedUrlProblem(trimmed);
        if (problem) {
            toast.error(problem, { theme: 'colored' });
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
            label: site.key === 'Other' ? null : site.key,
        });

        setSaving(false);

        if (error) {
            toast.error(error.message, { theme: 'colored' });
            return;
        }

        setUrl('');
        toast.success('Saved', { theme: 'colored', autoClose: 1500 });
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

    const num = 'flex h-6 w-6 flex-none items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white';

    return (
        <div>
            <div role="tablist" aria-label="Site" className="mb-5 flex flex-wrap gap-2">
                {SITES.map((s) => (
                    <button key={s.key} type="button" role="tab" aria-selected={site.key === s.key}
                        onClick={() => { setSite(s); setUrl(''); }}
                        className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${site.key === s.key ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-700 hover:border-slate-500'}`}>
                        {s.key}
                    </button>
                ))}
            </div>

            <ol className="space-y-4">
                <li className="flex gap-3">
                    <span className={num}>1</span>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-800">Copy your Galloway Getaways calendar link</p>
                        <button type="button" onClick={copy}
                            className="mt-2 rounded-xl border px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-500">
                            Copy link
                        </button>
                    </div>
                </li>
                <li className="flex gap-3">
                    <span className={num}>2</span>
                    <p className="min-w-0 flex-1 text-sm text-slate-800">{site.importAt}</p>
                </li>
                <li className="flex gap-3">
                    <span className={num}>3</span>
                    <p className="min-w-0 flex-1 text-sm text-slate-800">{site.exportAt}</p>
                </li>
                <li className="flex gap-3">
                    <span className={num}>4</span>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-800">Paste it here and press Save</p>
                        <div className="mt-2 flex gap-2">
                            <input
                                type="url"
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                placeholder={site.placeholder}
                                aria-label={`${site.key} export link`}
                                className="min-w-0 flex-1 rounded-xl border p-3 text-sm placeholder:text-slate-300"
                            />
                            <button type="button" onClick={save} disabled={saving}
                                className="flex-none rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-50">
                                {saving ? 'Saving…' : 'Save'}
                            </button>
                        </div>
                    </div>
                </li>
            </ol>

            {!loading && feeds.length > 0 && (
                <div className="mt-8">
                    <h3 className="mb-2 text-sm font-semibold text-slate-800">Connected</h3>
                    <div className="space-y-2">
                        {feeds.map((f) => (
                            <div key={f.id} className="flex items-start justify-between gap-3 rounded-xl border px-3 py-2.5">
                                <div className="min-w-0">
                                    <div className="text-sm font-medium text-slate-800">{f.label || 'Calendar'}</div>
                                    <div className="truncate text-xs text-slate-400">{f.url}</div>
                                    {f.last_status === 'failed' && (
                                        <div className="mt-0.5 text-xs text-red-600">
                                            Couldn&apos;t reach it{f.last_error ? ' — ' + f.last_error : ''}
                                        </div>
                                    )}
                                    {f.last_status === 'ok' && <div className="mt-0.5 text-xs text-emerald-700">Syncing</div>}
                                </div>
                                <button type="button" onClick={() => remove(f.id)} title="Remove this calendar"
                                    aria-label={`Remove ${f.label || 'calendar'}`}
                                    className="flex-shrink-0 text-slate-400 hover:text-red-600">
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
