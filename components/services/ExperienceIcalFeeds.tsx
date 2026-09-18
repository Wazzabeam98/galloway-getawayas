'use client';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { toast } from 'react-toastify';
import { Trash2, Plus, AlertTriangle, Copy, CalendarClock } from 'lucide-react';

interface Clash {
    date: string; start: string; end: string; summary: string;
    conflict: { kind: 'booking' | 'declared'; time: string; detail: string };
}
interface Feed {
    id: string;
    url: string;
    label: string | null;
    last_synced_at: string | null;
    last_status: string | null;
    last_error: string | null;
    clashes: Clash[] | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function niceDate(key: string): string {
    const d = new Date(key + 'T00:00:00Z');
    if (isNaN(d.getTime())) return key;
    return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
}

// The provider's calendar sync — the operational twin of blocking a day, so it
// lives on the calendar dashboard, not the listing. Export their sessions out;
// import their personal calendar in so an outside commitment blocks the hour. The
// clash panel is the safety net: when the database refused to block an hour
// because a booking already owns it, the provider is TOLD which event and which
// booking, rather than a personal appointment quietly cancelling a guest.
export default function ExperienceIcalFeeds({ providerId, icalToken }: { providerId: string; icalToken: string }) {
    const supabase = createClientComponentClient();
    const [feeds, setFeeds] = useState<Feed[]>([]);
    const [loading, setLoading] = useState(true);
    const [label, setLabel] = useState('');
    const [url, setUrl] = useState('');
    const [saving, setSaving] = useState(false);
    const [exportUrl, setExportUrl] = useState('');

    useEffect(() => {
        if (typeof window !== 'undefined' && icalToken) {
            setExportUrl(`${window.location.origin}/api/experiences/ical/${providerId}?token=${icalToken}`);
        }
    }, [providerId, icalToken]);

    const load = async () => {
        const { data } = await supabase
            .from('provider_ical_feeds')
            .select('id, url, label, last_synced_at, last_status, last_error, clashes')
            .eq('provider_id', providerId)
            .order('created_at');
        setFeeds((data as Feed[]) || []);
        setLoading(false);
    };

    useEffect(() => { load(); /* eslint-disable-next-line */ }, [providerId]);

    const add = async () => {
        const trimmed = url.trim();
        if (!trimmed) { toast.error('Paste the calendar link first.', { theme: 'colored' }); return; }
        if (!/^https?:\/\//i.test(trimmed)) { toast.error('That should start with https://', { theme: 'colored' }); return; }
        if (feeds.some((f) => f.url === trimmed)) { toast.error('That calendar is already here.', { theme: 'colored' }); return; }

        setSaving(true);
        const { error } = await supabase.from('provider_ical_feeds').insert({
            provider_id: providerId, url: trimmed, label: label.trim() || null,
        });
        setSaving(false);
        if (error) { toast.error(error.message, { theme: 'colored' }); return; }
        setUrl(''); setLabel('');
        toast.success('Calendar added — it’ll sync within a few hours.', { theme: 'colored' });
        load();
    };

    const remove = async (id: string) => {
        const { error } = await supabase.from('provider_ical_feeds').delete().eq('id', id);
        if (error) { toast.error(error.message, { theme: 'colored' }); return; }
        toast.success('Calendar removed.', { theme: 'colored' });
        load();
    };

    const copyExport = () => {
        if (!exportUrl) return;
        navigator.clipboard.writeText(exportUrl);
        toast.success('Export link copied.', { theme: 'colored' });
    };

    const allClashes = feeds.flatMap((f) => (f.clashes || []).map((c) => ({ feed: f.label || 'Imported calendar', ...c })));

    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2">
                <CalendarClock className="h-5 w-5 text-slate-500" aria-hidden />
                <h2 className="text-lg font-bold text-slate-900">Calendar sync</h2>
            </div>

            {/* The clash warnings — first, because they're the point. */}
            {allClashes.length > 0 && (
                <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-amber-900">
                        <AlertTriangle className="h-4 w-4 flex-none" aria-hidden />
                        {allClashes.length === 1 ? 'A calendar clash' : allClashes.length + ' calendar clashes'} — a booking kept the hour
                    </div>
                    <p className="mt-1 text-xs text-amber-800">
                        These times are booked, so we didn’t block them from your other calendar. Your booking stands — but you’re double-booked with yourself. Move the outside event, or cancel the booking.
                    </p>
                    <ul className="mt-3 space-y-2">
                        {allClashes.map((c, i) => (
                            <li key={i} className="rounded-lg bg-white/70 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
                                <span className="font-semibold">“{c.summary}”</span> on <span className="font-semibold">{niceDate(c.date)}</span>, {c.start}–{c.end}
                                <span className="block text-xs text-amber-800">
                                    clashes with {c.conflict.kind === 'declared' ? 'your session' : 'a booking'} at {c.conflict.time} — {c.conflict.detail}
                                    <span className="text-amber-600"> · from {c.feed}</span>
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Export */}
            <div className="mt-5">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your sessions, in your calendar</div>
                <p className="mt-1 text-xs text-slate-400">
                    Subscribe to this in Google, Apple or Outlook to see your bookings, declared sessions and blocked hours there. Keep the link private — it’s a window into your bookings.
                </p>
                <div className="mt-2 flex items-center gap-2">
                    <input readOnly value={exportUrl || 'Generating…'} className="min-w-0 flex-1 truncate rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-600" />
                    <button type="button" onClick={copyExport} disabled={!exportUrl} className="inline-flex flex-none items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-black disabled:opacity-50">
                        <Copy className="h-3.5 w-3.5" /> Copy
                    </button>
                </div>
            </div>

            {/* Import */}
            <div className="mt-6 border-t border-slate-100 pt-5">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Block your busy hours</div>
                <p className="mt-1 text-xs text-slate-400">
                    Add the export link from your own calendar (Google/Apple/Outlook), so an appointment there blocks a guest booking that hour. A booked or declared hour is never overwritten — you’ll be warned above instead.
                </p>

                {loading ? (
                    <p className="mt-3 text-sm text-slate-400">Loading…</p>
                ) : feeds.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-400">No calendars connected yet.</p>
                ) : (
                    <div className="mt-3 space-y-2">
                        {feeds.map((f) => (
                            <div key={f.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5">
                                <div className="min-w-0">
                                    <div className="text-sm font-medium text-slate-800">{f.label || 'Calendar'}</div>
                                    <div className="truncate text-xs text-slate-400">{f.url}</div>
                                    {f.last_status === 'failed' && (
                                        <div className="mt-0.5 text-xs text-red-600">Couldn’t be reached last time{f.last_error ? ' — ' + f.last_error : ''}</div>
                                    )}
                                    {f.last_status === 'ok' && (
                                        <div className="mt-0.5 text-xs text-emerald-700">Syncing fine{(f.clashes && f.clashes.length) ? ' · ' + f.clashes.length + ' clash' + (f.clashes.length === 1 ? '' : 'es') : ''}</div>
                                    )}
                                    {!f.last_status && (
                                        <div className="mt-0.5 text-xs text-slate-400">Not synced yet</div>
                                    )}
                                </div>
                                <button type="button" onClick={() => remove(f.id)} title="Remove this calendar" className="flex-shrink-0 text-slate-400 hover:text-red-600">
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                <div className="mt-3 space-y-2">
                    <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Where it's from — Google, Apple, Outlook…" className="w-full rounded-xl border border-slate-300 p-3 text-sm" />
                    <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/....ics" className="w-full rounded-xl border border-slate-300 p-3 text-sm" />
                    <button type="button" onClick={add} disabled={saving} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-50">
                        <Plus className="h-4 w-4" /> {saving ? 'Adding…' : 'Add calendar'}
                    </button>
                </div>
            </div>
        </div>
    );
}
