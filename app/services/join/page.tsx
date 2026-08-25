'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { Sparkles, Wrench, Trees, Droplet, Trash2 } from 'lucide-react';
import { Suspense } from 'react';
import { tradesFor } from '@/lib/serviceProviders';

const TRADE_ICONS: Record<string, any> = {
    sponge: Sparkles,
    bin: Trash2,
    spanner: Wrench,
    trees: Trees,
    droplet: Droplet,
};

// Step one, and a route of its own rather than a step inside the form.
//
// Everything about this works better as a URL: the back button goes back to
// the choice instead of off the site, a refresh keeps you where you were, and
// the "change" link on the application is an ordinary link rather than a state
// reset. A `step` variable would have needed history entries pushed by hand to
// get any of that.
//
// No sign-in gate here on purpose. Somebody can choose their trade first and
// sign in on the application, and the choice survives because it travels in
// the query string rather than in memory.
function TradePicker() {
    const supabase = createClientComponentClient();
    const router = useRouter();
    const params = useSearchParams();

    // Arriving from "change" on the application means they are deliberately
    // revisiting a decision they have already made, so the redirect below has
    // to stand aside or the two pages bounce them back and forth.
    const changing = params.get('change') === '1';

    const [checking, setChecking] = useState(true);

    useEffect(() => {
        const check = async () => {
            try {
                if (changing) return;

                const { data: { session } } = await supabase.auth.getSession();
                if (!session) return;

                const { data: existing } = await supabase
                    .from('service_providers')
                    .select('trade')
                    .eq('owner_id', session.user.id)
                    .maybeSingle();

                // They have applied before. Asking them what they do a second
                // time is asking a question we already know the answer to.
                if (existing) {
                    router.replace('/services/join/apply?trade=' + encodeURIComponent(existing.trade || 'sponge'));
                    return;
                }
            } catch (err) {
                // A failed check just means they see the picker, which is the
                // right page for somebody who has never applied.
            } finally {
                setChecking(false);
            }
        };
        check();
    }, [supabase, router, changing]);

    if (checking) {
        return <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-slate-500">Loading…</div>;
    }

    const trades = tradesFor('host');

    return (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 pb-24">
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
                What do you do?
            </h1>
            <p className="text-slate-600 mt-3 mb-8">
                Pick the one that fits best. It decides what we ask you next, and who finds you.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {trades.map((t) => {
                    const Icon = TRADE_ICONS[t.key] || Sparkles;
                    return (
                        <button
                            key={t.key}
                            type="button"
                            onClick={() => router.push('/services/join/apply?trade=' + encodeURIComponent(t.key))}
                            className="rounded-2xl border border-slate-300 p-4 text-left hover:border-emerald-700 hover:bg-emerald-50/40 transition"
                        >
                            <Icon className="w-7 h-7 text-emerald-700 mb-3" strokeWidth={1.5} />
                            <span className="block font-semibold text-slate-900">{t.label}</span>
                        </button>
                    );
                })}
            </div>

        </div>
    );
}

export default function JoinPage() {
    // useSearchParams needs a boundary, the same as the query-string reader in
    // the root layout.
    return (
        <Suspense fallback={<div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-slate-500">Loading…</div>}>
            <TradePicker />
        </Suspense>
    );
}
