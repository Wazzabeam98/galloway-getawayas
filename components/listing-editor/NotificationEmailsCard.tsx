'use client';

import { useEffect, useState } from 'react';
import { Mail, Trash2, Clock } from 'lucide-react';
import { toast } from 'react-toastify';
import {
    MAX_NOTIFICATION_EMAILS,
    normalizeNotificationEmail,
    isValidNotificationEmail,
} from '@/lib/notificationEmails';

// The "Notification emails" section of the listing editor. An owner (or a
// full-access co-host) forwards this listing's booking, cancellation, change
// and message emails to a few other addresses — a cleaner, a co-owner — without
// giving them an account or any co-host access. Each address confirms by a
// one-time link before anything is sent, and every copy carries an unsubscribe
// link. The list is kept in listing_notification_subscribers, reached only
// through /api/listings/[id]/notification-emails (service role); this component
// never touches the table directly.

type Subscriber = { id: string; email: string; confirmed: boolean };

export default function NotificationEmailsCard({ listingId }: { listingId: string }) {
    const [subs, setSubs] = useState<Subscriber[]>([]);
    const [loading, setLoading] = useState(true);
    // A co-host without full access can open the editor but not manage this
    // list; the route answers 403 and we say so rather than showing controls
    // that would only fail on save.
    const [blocked, setBlocked] = useState(false);
    const [email, setEmail] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let live = true;
        (async () => {
            try {
                const res = await fetch(`/api/listings/${listingId}/notification-emails`, { cache: 'no-store' });
                if (!live) return;
                if (res.status === 403) { setBlocked(true); return; }
                const data = await res.json().catch(() => ({}));
                if (data && data.ok) setSubs(data.subscribers || []);
            } finally {
                if (live) setLoading(false);
            }
        })();
        return () => { live = false; };
    }, [listingId]);

    const add = async () => {
        const value = normalizeNotificationEmail(email);
        setError(null);
        if (!isValidNotificationEmail(value)) {
            setError('That doesn’t look like an email address.');
            return;
        }
        if (subs.some((s) => normalizeNotificationEmail(s.email) === value)) {
            setError('That address is already on the list.');
            return;
        }
        if (subs.length >= MAX_NOTIFICATION_EMAILS) {
            setError(`You can add up to ${MAX_NOTIFICATION_EMAILS} addresses per property.`);
            return;
        }
        setBusy(true);
        try {
            const res = await fetch(`/api/listings/${listingId}/notification-emails`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: value }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.ok) {
                setError((data && data.error) || 'Couldn’t add that address.');
                return;
            }
            setSubs((prev) => {
                const without = prev.filter((s) => s.id !== data.subscriber.id);
                return [...without, data.subscriber];
            });
            setEmail('');
            if (data.already) {
                toast.info('That address is already confirmed.');
            } else {
                toast.success('We’ve emailed them to confirm.');
            }
        } catch {
            setError('Couldn’t add that address.');
        } finally {
            setBusy(false);
        }
    };

    const remove = async (sub: Subscriber) => {
        setSubs((prev) => prev.filter((s) => s.id !== sub.id));
        try {
            const res = await fetch(`/api/listings/${listingId}/notification-emails`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: sub.id }),
            });
            if (!res.ok) throw new Error('failed');
        } catch {
            // Put it back if the delete didn't take.
            setSubs((prev) => [...prev, sub]);
            toast.error('Couldn’t remove that address.');
        }
    };

    return (
        <section>
            <h2 className="text-xl font-bold text-slate-900 mb-1">Notification emails</h2>
            <p className="text-sm text-slate-500 mb-4">
                Forward this property&apos;s booking, cancellation, change and message emails to up to{' '}
                {MAX_NOTIFICATION_EMAILS} other people — a cleaner or a co-owner, say. They get a copy only,
                with no account and no access to your listing. Each address confirms by a link before anything
                is sent, and every email has an unsubscribe link.
            </p>

            {blocked ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                    Only the owner or a full-access co-host can manage who gets a copy of this property&apos;s emails.
                </div>
            ) : loading ? (
                <div className="text-sm text-slate-400">Loading…</div>
            ) : (
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    {subs.length > 0 ? (
                        <ul className="divide-y divide-slate-100 mb-4">
                            {subs.map((s) => (
                                <li key={s.id} className="flex items-center justify-between gap-3 py-3 first:pt-0">
                                    <div className="min-w-0 flex items-center gap-2.5">
                                        <Mail className="h-4 w-4 flex-none text-slate-400" />
                                        <span className="truncate text-sm text-slate-800">{s.email}</span>
                                    </div>
                                    <div className="flex flex-none items-center gap-3">
                                        {s.confirmed ? (
                                            <span className="text-xs font-medium text-emerald-700">Confirmed</span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
                                                <Clock className="h-3.5 w-3.5" /> Awaiting confirmation
                                            </span>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => remove(s)}
                                            aria-label={`Remove ${s.email}`}
                                            className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-sm text-slate-400 mb-4">No one else gets these emails yet.</p>
                    )}

                    {subs.length < MAX_NOTIFICATION_EMAILS && (
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <input
                                type="email"
                                inputMode="email"
                                autoComplete="off"
                                value={email}
                                onChange={(e) => { setEmail(e.target.value); setError(null); }}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
                                placeholder="name@example.com"
                                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/10"
                            />
                            <button
                                type="button"
                                onClick={add}
                                disabled={busy}
                                className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-40"
                            >
                                {busy ? 'Adding…' : 'Add'}
                            </button>
                        </div>
                    )}

                    {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
                </div>
            )}
        </section>
    );
}
