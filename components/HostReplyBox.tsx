'use client';

import { useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';

export default function HostReplyBox({ reviewId, existingReply }: { reviewId: string; existingReply: string | null }) {
    const supabase = createClientComponentClient();
    const router = useRouter();
    const [replying, setReplying] = useState(false);
    const [text, setText] = useState('');
    const [submitting, setSubmitting] = useState(false);

    if (existingReply) {
        return (
            <div className="mt-3 ml-4 pl-4 border-l-2 border-slate-200">
                <p className="text-xs font-semibold text-slate-500 mb-1">Response from the host</p>
                <p className="text-sm text-slate-700">{existingReply}</p>
            </div>
        );
    }

    if (!replying) {
        return (
            <button
                type="button"
                onClick={() => setReplying(true)}
                className="text-xs font-semibold text-slate-500 underline hover:text-slate-800 mt-2"
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
        router.refresh();
    };

    return (
        <div className="mt-3">
            <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={2}
                placeholder="Write your one-time reply — this will be public..."
                className="w-full p-2.5 border rounded-lg text-sm mb-2"
            />
            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={submit}
                    disabled={submitting}
                    className="px-4 py-1.5 bg-slate-900 hover:bg-black text-white text-xs font-semibold rounded-lg disabled:opacity-50"
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
