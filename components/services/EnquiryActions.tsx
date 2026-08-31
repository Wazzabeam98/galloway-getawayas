'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X } from 'lucide-react';

// Accept / Decline for a signed-in provider, on a pending enquiry.
//
// The email token link is the tradesman's main way to answer; this is the same
// two buttons for when he is already logged in. On accept the host's contact
// details are released to the enquiry (server-side) — so the row he is looking
// at reloads to show them.
export default function EnquiryActions({ enquiryId }: { enquiryId: string }) {
    const router = useRouter();
    const [busy, setBusy] = useState<'yes' | 'no' | null>(null);
    const [error, setError] = useState('');

    async function respond(reply: 'yes' | 'no') {
        setBusy(reply);
        setError('');
        try {
            const res = await fetch('/api/services/enquiries/respond-as-owner', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enquiryId, reply }),
            });
            const data = await res.json();
            if (!res.ok || !data.ok) {
                setError(data.error || 'Could not save that.');
                setBusy(null);
                return;
            }
            // The list is server-rendered; refresh so the row re-chips and,
            // on accept, shows the contact it just released.
            router.refresh();
        } catch {
            setError('Could not save that.');
            setBusy(null);
        }
    }

    return (
        <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-1.5">
                <button
                    onClick={() => respond('yes')}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-1 text-[12.5px] font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg px-3 py-1.5"
                >
                    <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                    {busy === 'yes' ? 'Accepting…' : 'Accept'}
                </button>
                <button
                    onClick={() => respond('no')}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-1 text-[12.5px] font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 rounded-lg px-3 py-1.5"
                >
                    <X className="w-3.5 h-3.5" strokeWidth={2.5} />
                    Decline
                </button>
            </div>
            {error && <div className="text-[11.5px] text-rose-700">{error}</div>}
        </div>
    );
}
