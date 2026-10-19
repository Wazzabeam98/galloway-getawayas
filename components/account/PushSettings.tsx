'use client';

// Account settings → Notifications → Push notifications. One switch per
// category (lib/pushCategories), the way Airbnb lists them. Everything starts
// on except Tips and offers; Account security is always on and says so; Owner
// alerts appear for admins only. Saved through /api/account/push-preferences.

import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Smartphone } from 'lucide-react';
import PushPrompt from '@/components/pwa/PushPrompt';
import { PUSH_CATEGORIES, PUSH_CATEGORY_INFO, pushAllowed, type PushCategory } from '@/lib/pushCategories';

export default function PushSettings() {
    const [push, setPush] = useState<Record<string, unknown> | null>(null);
    const [admin, setAdmin] = useState(false);
    const [saving, setSaving] = useState<PushCategory | null>(null);

    useEffect(() => {
        fetch('/api/account/push-preferences')
            .then((r) => r.json())
            .then((d) => { if (d && d.ok) { setPush(d.push || {}); setAdmin(!!d.isAdmin); } else setPush({}); })
            .catch(() => setPush({}));
    }, []);

    const toggle = async (category: PushCategory) => {
        if (!push) return;
        const next = !pushAllowed(push, category);
        const previous = push;
        setPush({ ...push, [category]: next });
        setSaving(category);
        try {
            const r = await fetch('/api/account/push-preferences', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ category, on: next }),
            });
            if (!r.ok) throw new Error();
        } catch {
            setPush(previous);
            toast.error('That setting couldn’t be saved. Please try again.', { theme: 'colored' });
        }
        setSaving(null);
    };

    const shown = PUSH_CATEGORIES.filter((c) => !PUSH_CATEGORY_INFO[c].adminOnly || admin);

    return (
        <div className="mt-10">
            <div className="flex items-center gap-2 mb-1">
                <Smartphone className="w-5 h-5 text-slate-400" />
                <h3 className="text-lg font-semibold text-slate-900">Push notifications</h3>
            </div>
            <p className="text-slate-500 text-sm mb-4">
                On your phone or computer, wherever you&rsquo;ve turned notifications on for Galloway Getaways.
            </p>

            <PushPrompt context="settings" className="mb-4" always />

            <div className="border rounded-2xl divide-y">
                {shown.map((c) => {
                    const info = PUSH_CATEGORY_INFO[c];
                    const on = push ? pushAllowed(push, c) : info.defaultOn;
                    return (
                        <div key={c} className="flex items-start justify-between gap-4 p-5">
                            <div>
                                <div className="text-sm font-semibold text-slate-900">{info.label}</div>
                                <p className="text-sm text-slate-500 mt-0.5">{info.description}</p>
                            </div>
                            {info.locked ? (
                                <span className="text-sm text-slate-500 shrink-0 pt-0.5">Always on</span>
                            ) : (
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={on}
                                    aria-label={info.label + ' push notifications'}
                                    disabled={!push || saving === c}
                                    onClick={() => toggle(c)}
                                    className={`relative w-12 h-7 rounded-full shrink-0 transition disabled:opacity-50 ${on ? 'bg-emerald-700' : 'bg-slate-300'}`}
                                >
                                    <span className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-all ${on ? 'left-6' : 'left-1'}`} />
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
