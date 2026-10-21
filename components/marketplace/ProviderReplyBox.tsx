'use client';

import { useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';
import { useExperienceViewer } from '@/components/marketplace/ExperienceViewer';

// The provider's one public reply to a review, mirroring HostReplyBox on the
// cottage side. It writes host_reply / host_reply_at straight from the browser;
// the "Providers can reply to reviews about them" policy (reviewee_id =
// auth.uid()) is what authorises it, so only the provider the review is about
// can post one. Shown only when the viewer is that provider (canReply).
//
// On the public experience page (edge-cached, the same HTML for everyone) the
// page passes canReply false and the answer arrives after load through
// ExperienceViewer; the dashboard's reviews page passes it directly. A reply
// posted there is kept on screen here, and the page's cached copy refreshed, so
// it doesn't vanish on the router refresh.
export default function ProviderReplyBox({
    reviewId, existingReply, providerFirstName, canReply,
}: {
    reviewId: string;
    existingReply: string | null;
    providerFirstName: string;
    canReply: boolean;
}) {
    const supabase = createClientComponentClient();
    const router = useRouter();
    const viewer = useExperienceViewer();
    const allowed = canReply || !!viewer?.canReply;
    const [posted, setPosted] = useState<string | null>(null);
    const [replying, setReplying] = useState(false);
    const [text, setText] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const shown = existingReply || posted;
    if (shown) {
        return (
            <div className="mt-3 ml-4 border-l-2 border-slate-200 pl-4">
                <p className="mb-1 text-xs font-semibold text-slate-500">Response from {providerFirstName}</p>
                <p className="text-sm text-slate-700">{shown}</p>
            </div>
        );
    }

    if (!allowed) return null;

    if (!replying) {
        return (
            <button
                type="button"
                onClick={() => setReplying(true)}
                className="mt-2 text-xs font-semibold text-slate-500 underline hover:text-slate-800"
            >
                Reply to this review
            </button>
        );
    }

    const submit = async () => {
        if (!text.trim()) return;
        setSubmitting(true);
        const { error } = await supabase
            .from('reviews')
            .update({ host_reply: text.trim(), host_reply_at: new Date().toISOString() })
            .eq('id', reviewId);
        setSubmitting(false);
        if (error) {
            toast.error(error.message, { theme: 'colored' });
            return;
        }
        toast.success('Reply posted.', { theme: 'colored' });
        setPosted(text.trim());
        if (viewer) await viewer.refreshPage();
        router.refresh();
    };

    return (
        <div className="mt-3">
            <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={2}
                placeholder="Write your one-time reply — this will be public..."
                className="mb-2 w-full rounded-lg border p-2.5 text-sm"
            />
            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={submit}
                    disabled={submitting}
                    className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-black disabled:opacity-50"
                >
                    {submitting ? 'Posting...' : 'Post reply'}
                </button>
                <button
                    type="button"
                    onClick={() => setReplying(false)}
                    className="px-4 py-1.5 text-xs font-semibold text-slate-500"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}
