'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { Sparkles, Wrench, Trees, Droplet, Trash2, ChevronRight } from 'lucide-react';
import { tradesFor, unclaimedTrades, tradeLabel, statusSummary } from '@/lib/serviceProviders';

const TRADE_ICONS: Record<string, any> = {
    sponge: Sparkles,
    bin: Trash2,
    spanner: Wrench,
    trees: Trees,
    droplet: Droplet,
};

const STATUS_STYLE: Record<string, string> = {
    pending_review: 'bg-amber-100 text-amber-900',
    approved: 'bg-emerald-100 text-emerald-900',
    declined: 'bg-rose-100 text-rose-900',
    hidden: 'bg-slate-200 text-slate-700',
    draft: 'bg-slate-200 text-slate-700',
};

// Step one, and a route of its own rather than a step inside the form.
//
// Everything about this works better as a URL: the back button goes back to
// the choice instead of off the site, a refresh keeps you where you were, and
// the "change" link on the application is an ordinary link rather than a state
// reset.
//
// It is a list rather than a question, because one person can run a cleaning
// firm and a window cleaning round. Those are different trades, and one
// business per trade is what the database now enforces — so what they already
// have is shown as it stands, and what is left is offered.
//
// No sign-in gate. Somebody can choose their trade first and sign in on the
// application, and the choice survives because it travels in the query string
// rather than in memory.
function TradePicker() {
    const supabase = createClientComponentClient();
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [mine, setMine] = useState<any[]>([]);

    useEffect(() => {
        const load = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) return;

                const { data } = await supabase
                    .from('service_providers')
                    .select('id, trade, business_name, status')
                    .eq('owner_id', session.user.id);

                setMine(data || []);
            } catch (err) {
                // A failed read just means they see every trade as new, which
                // is the right page for somebody who has never applied.
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [supabase]);

    const open = (trade: string) =>
        router.push('/services/join/apply?trade=' + encodeURIComponent(trade));

    if (loading) {
        return <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-slate-500">Loading…</div>;
    }

    const left = unclaimedTrades(mine, 'host');
    const hasSome = mine.length > 0;

    return (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 pb-24">
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
                {hasSome ? 'Your businesses' : 'What do you do?'}
            </h1>
            <p className="text-slate-600 mt-3 mb-8">
                {hasSome
                    ? 'Open one to change it, or add another trade.'
                    : 'Pick the one that fits best. It decides what we ask you next, and who finds you.'}
            </p>

            {hasSome && (
                <div className="space-y-3 mb-10">
                    {mine.map((p) => {
                        const Icon = TRADE_ICONS[p.trade] || Sparkles;
                        const summary = statusSummary(p.status);
                        return (
                            <button
                                key={p.id}
                                type="button"
                                onClick={() => open(p.trade)}
                                className="w-full flex items-center gap-3 rounded-2xl border border-slate-300 p-4 text-left hover:border-emerald-700 transition"
                            >
                                <Icon className="w-6 h-6 text-emerald-700 shrink-0" strokeWidth={1.5} />
                                <span className="min-w-0 flex-1">
                                    <span className="block font-semibold text-slate-900 truncate">
                                        {p.business_name || tradeLabel(p.trade)}
                                    </span>
                                    <span className="block text-sm text-slate-500">{tradeLabel(p.trade)}</span>
                                </span>
                                <span
                                    className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${
                                        STATUS_STYLE[p.status] || STATUS_STYLE.draft
                                    }`}
                                >
                                    {summary.label}
                                </span>
                                <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                            </button>
                        );
                    })}
                </div>
            )}

            {left.length > 0 && (
                <>
                    {hasSome && (
                        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                            Add another trade
                        </h2>
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {left.map((t) => {
                            const Icon = TRADE_ICONS[t.key] || Sparkles;
                            return (
                                <button
                                    key={t.key}
                                    type="button"
                                    onClick={() => open(t.key)}
                                    className="rounded-2xl border border-slate-300 p-4 text-left hover:border-emerald-700 hover:bg-emerald-50/40 transition"
                                >
                                    <Icon className="w-7 h-7 text-emerald-700 mb-3" strokeWidth={1.5} />
                                    <span className="block font-semibold text-slate-900">{t.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </>
            )}

            {left.length === 0 && hasSome && (
                <p className="text-sm text-slate-500">
                    You have signed up for every trade we cover.
                </p>
            )}
        </div>
    );
}

export default function JoinPage() {
    return (
        <Suspense fallback={<div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-slate-500">Loading…</div>}>
            <TradePicker />
        </Suspense>
    );
}
