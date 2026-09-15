'use client';

import { useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';

// The provider's own editor for the "Things to know" fields — filled in AFTER
// approval, not on sign-up. All three are optional: leave one blank and its row
// simply doesn't appear on the listing. Saves by merging into the existing
// guest_details jsonb (owner RLS + the guest_details column grant), so the other
// guest content — what happens, qualifications — is left untouched.
export default function ThingsToKnowEditor({
    providerId, guestDetails,
}: {
    providerId: string;
    guestDetails: Record<string, any> | null;
}) {
    const supabase = createClientComponentClient();
    const router = useRouter();
    const gd = guestDetails || {};

    const [minAge, setMinAge] = useState<string>(gd.min_age != null ? String(gd.min_age) : '');
    const [activity, setActivity] = useState<string>(typeof gd.activity_level === 'string' ? gd.activity_level : '');
    const [bring, setBring] = useState<string>(typeof gd.what_to_bring === 'string' ? gd.what_to_bring : '');
    const [saving, setSaving] = useState(false);

    const save = async () => {
        setSaving(true);
        // Start from what's there, then set or DELETE each key so clearing a
        // field removes it (an empty value would render as an empty row).
        const next: Record<string, any> = { ...gd };
        const age = parseInt(minAge, 10);
        if (minAge.trim() && age > 0) next.min_age = age; else delete next.min_age;
        if (activity) next.activity_level = activity; else delete next.activity_level;
        if (bring.trim()) next.what_to_bring = bring.trim(); else delete next.what_to_bring;

        const { error } = await supabase
            .from('service_providers')
            .update({ guest_details: next })
            .eq('id', providerId);
        setSaving(false);
        if (error) { toast.error(error.message, { theme: 'colored' }); return; }
        toast.success('Saved.', { theme: 'colored' });
        router.refresh();
    };

    const field = 'mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600';
    const legend = 'text-xs font-semibold uppercase tracking-wide text-slate-500';

    return (
        <div className="space-y-5">
            <label className="block">
                <span className={legend}>Minimum age <span className="font-normal normal-case tracking-normal text-slate-400">(optional)</span></span>
                <input
                    type="number" min={0} inputMode="numeric" value={minAge}
                    onChange={(e) => setMinAge(e.target.value)}
                    placeholder="e.g. 18 — leave blank for all ages"
                    className={field + ' w-40'}
                />
            </label>

            <label className="block">
                <span className={legend}>Activity level <span className="font-normal normal-case tracking-normal text-slate-400">(optional)</span></span>
                <select value={activity} onChange={(e) => setActivity(e.target.value)} className={field}>
                    <option value="">Not specified</option>
                    <option value="gentle">Gentle — suitable for most</option>
                    <option value="moderate">Moderate — some walking or standing</option>
                    <option value="challenging">Challenging — a good level of fitness needed</option>
                </select>
            </label>

            <label className="block">
                <span className={legend}>What to bring <span className="font-normal normal-case tracking-normal text-slate-400">(optional)</span></span>
                <textarea
                    value={bring} onChange={(e) => setBring(e.target.value.slice(0, 600))} rows={4}
                    placeholder={'e.g. Comfortable shoes, a towel, a swimming costume.\nOne per line reads well.'}
                    className={field + ' resize-y'}
                />
            </label>

            <button
                type="button" onClick={save} disabled={saving}
                className="rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
                {saving ? 'Saving…' : 'Save'}
            </button>
        </div>
    );
}
