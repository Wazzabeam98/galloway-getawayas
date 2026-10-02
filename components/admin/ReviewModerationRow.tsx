'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';
import { Star } from 'lucide-react';

// One review on the owner's moderation list, with the control to take it down or
// put it back. The write goes through /api/admin/reviews/hide (service role +
// is_admin), never straight from the browser.
export default function ReviewModerationRow({ review }: {
    review: {
        id: string;
        kind: 'Stay' | 'Experience';
        subject: string;       // listing title or provider business name
        reviewer: string;      // legal name — this is an admin screen
        rating: number;
        comment: string;
        when: string;
        hiddenAt: string | null;
        hiddenReason: string | null;
    };
}) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [reason, setReason] = useState('');
    const hidden = !!review.hiddenAt;

    const act = async (hide: boolean) => {
        if (hide && reason.trim().length < 3) { toast.error('Give a short reason.', { theme: 'colored' }); return; }
        setBusy(true);
        const res = await fetch('/api/admin/reviews/hide', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reviewId: review.id, hidden: hide, reason: reason.trim() }),
        });
        setBusy(false);
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.ok) { toast.error(body.error || 'That didn’t work.', { theme: 'colored' }); return; }
        toast.success(hide ? 'Review taken down.' : 'Review restored.', { theme: 'colored' });
        router.refresh();
    };

    return (
        <div className={`rounded-2xl border p-5 ${hidden ? 'border-slate-200 bg-slate-50' : 'border-slate-200'}`}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">{review.kind}</span>
                <span className="font-semibold text-slate-900">{review.subject}</span>
                {hidden && (
                    <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700">Taken down</span>
                )}
            </div>

            <div className="mt-2 flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-900">{review.reviewer}</span>
                <span className="flex items-center gap-0.5 text-amber-500">
                    {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} className={`h-3.5 w-3.5 ${n <= review.rating ? 'fill-amber-400 text-amber-400' : 'fill-slate-200 text-slate-200'}`} />
                    ))}
                </span>
                <span className="text-xs text-slate-400">{new Date(review.when).toLocaleDateString('en-GB')}</span>
            </div>

            <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{review.comment}</p>

            {hidden ? (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                    {review.hiddenReason && <span className="text-xs text-slate-500">Reason: {review.hiddenReason}</span>}
                    <button
                        type="button"
                        onClick={() => act(false)}
                        disabled={busy}
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-black disabled:opacity-50"
                    >
                        {busy ? '…' : 'Put it back'}
                    </button>
                </div>
            ) : (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Reason (kept on the record)"
                        className="min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-xs"
                    />
                    <button
                        type="button"
                        onClick={() => act(true)}
                        disabled={busy}
                        className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                    >
                        {busy ? '…' : 'Take it down'}
                    </button>
                </div>
            )}
        </div>
    );
}
