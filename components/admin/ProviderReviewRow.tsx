'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';

const STATUS_STYLE: Record<string, string> = {
    pending_review: 'bg-amber-50 text-amber-900 border-amber-200',
    approved: 'bg-emerald-50 text-emerald-900 border-emerald-200',
    declined: 'bg-rose-50 text-rose-900 border-rose-200',
    draft: 'bg-slate-100 text-slate-700 border-slate-200',
    hidden: 'bg-slate-100 text-slate-700 border-slate-200',
};

const STATUS_LABEL: Record<string, string> = {
    pending_review: 'Waiting',
    approved: 'Live',
    declined: 'Declined',
    draft: 'Draft, not sent',
    hidden: 'Hidden',
};

export default function ProviderReviewRow({
    provider,
    areas,
    photoUrls,
}: {
    provider: any;
    areas: string[];
    photoUrls: string[];
}) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [decliningOpen, setDecliningOpen] = useState(false);
    const [note, setNote] = useState('');

    const decide = async (decision: 'approve' | 'decline') => {
        if (decision === 'decline' && !note.trim()) {
            toast.error('Say why — it goes to them in the email.', { theme: 'colored' });
            return;
        }

        setBusy(true);

        const res = await fetch('/api/admin/providers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: provider.id, decision, note: note.trim() }),
        });

        setBusy(false);

        const body = await res.json().catch(() => ({}));

        if (!res.ok) {
            toast.error(body.error || 'That did not save.', { theme: 'colored' });
            return;
        }

        // The decision is saved either way. But the business only knows about
        // it if the email went, so saying nothing about a send that failed
        // would leave them waiting on a decision that has already been made.
        if (body.emailed === false) {
            toast.warning(
                (decision === 'approve' ? 'Approved' : 'Declined')
                    + ', but the email did not send — tell them yourself.',
                { theme: 'colored', autoClose: false }
            );
        } else {
            toast.success(decision === 'approve' ? 'Approved.' : 'Declined.', { theme: 'colored' });
        }

        setDecliningOpen(false);
        router.refresh();
    };

    const pending = provider.status === 'pending_review';

    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="font-bold text-slate-900">{provider.business_name}</h3>
                    <p className="text-sm text-slate-600 mt-0.5">
                        {provider.tradeLabel}
                        {' · '}
                        {provider.audience === 'both' ? 'guests and owners' : provider.audience === 'guest' ? 'guests' : 'owners'}
                        {provider.kind === 'in_house' ? ' · in-house' : ''}
                    </p>
                </div>
                <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border ${STATUS_STYLE[provider.status] || STATUS_STYLE.draft}`}>
                    {STATUS_LABEL[provider.status] || provider.status}
                </span>
            </div>

            {provider.description && (
                <p className="text-sm text-slate-700 mt-3 whitespace-pre-line">{provider.description}</p>
            )}

            <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm mt-4">
                <div className="flex gap-2">
                    <dt className="text-slate-500 shrink-0">Covers</dt>
                    <dd className="text-slate-900">{areas.length ? areas.join(', ') : <span className="text-rose-700">nowhere</span>}</dd>
                </div>
                <div className="flex gap-2">
                    <dt className="text-slate-500 shrink-0">Contact</dt>
                    <dd className="text-slate-900 truncate">{provider.contact_email}{provider.contact_phone ? ' · ' + provider.contact_phone : ''}</dd>
                </div>
            </dl>

            {photoUrls.length > 0 && (
                <div className="flex gap-2 mt-4">
                    {photoUrls.map((u) => (
                        <img key={u} src={u} alt="" className="w-24 h-20 object-cover rounded-lg bg-slate-100" />
                    ))}
                </div>
            )}

            {pending && (
                <div className="mt-5 pt-4 border-t border-slate-200">
                    {!decliningOpen ? (
                        <div className="flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={() => decide('approve')}
                                disabled={busy}
                                className="rounded-full bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2.5 text-sm font-semibold transition disabled:opacity-60"
                            >
                                {busy ? 'Saving…' : 'Approve'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setDecliningOpen(true)}
                                disabled={busy}
                                className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-500 transition"
                            >
                                Decline
                            </button>
                        </div>
                    ) : (
                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-1.5">
                                Why? They will see this.
                            </label>
                            <textarea
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                rows={3}
                                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                                placeholder="We need a bit more detail about what you offer before we can list you."
                            />
                            <div className="flex gap-3 mt-3">
                                <button
                                    type="button"
                                    onClick={() => decide('decline')}
                                    disabled={busy}
                                    className="rounded-full bg-rose-700 hover:bg-rose-800 text-white px-5 py-2.5 text-sm font-semibold transition disabled:opacity-60"
                                >
                                    {busy ? 'Saving…' : 'Send decline'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setDecliningOpen(false)}
                                    className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
