'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import {
    Sparkles, Wrench, Trees, Droplet, Trash2, ChevronRight, ChevronLeft,
    Zap, Hammer, Paintbrush, Home,
} from 'lucide-react';
import {
    tradesFor,
    unclaimedTrades,
    pickerEntries,
    groupByKey,
    groupForTrade,
    tradeLabel,
    statusSummary,
} from '@/lib/serviceProviders';

const TRADE_ICONS: Record<string, any> = {
    sponge: Sparkles,
    bin: Trash2,
    trees: Trees,
    droplet: Droplet,
    electrician: Zap,
    joiner: Hammer,
    plumber: Droplet,
    roofer: Home,
    painter: Paintbrush,
    handyman: Wrench,
};

const GROUP_ICONS: Record<string, any> = {
    maintenance: Wrench,
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
// The same reasoning is why the maintenance trades are a second page at
// ?group=maintenance rather than an expanding panel. Nobody searches for
// "maintenance" — they search for a plumber — so the trades have to be real
// choices with a page of their own, and a roofer must not be something you
// find by opening a drawer labelled handyman.
//
// It is a list rather than a question, because one person can run a cleaning
// firm and a window cleaning round, or plumb and joiner. Those are different
// trades, one listing per trade is what the database enforces, and there is no
// limit on how many somebody holds — so what they already have is shown as it
// stands, and what is left is offered.
//
// No sign-in gate. Somebody can choose their trade first and sign in on the
// application, and the choice survives because it travels in the query string
// rather than in memory.
function TradePicker() {
    const supabase = createClientComponentClient();
    const router = useRouter();
    const params = useSearchParams();

    // Arriving from "change" means they want the list, not the shortcut —
    // otherwise the redirect below would bounce them straight back into the
    // business they were trying to get out of.
    const changing = params.get('change') === '1';
    const group = String(params.get('group') || '');
    const groupMeta = group ? groupByKey(group) : null;

    const [loading, setLoading] = useState(true);
    const [mine, setMine] = useState<any[]>([]);

    useEffect(() => {
        const load = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) return;

                // Each trade is its own business with its own name, so this
                // is a list of businesses rather than one business with
                // several sides to it.
                const { data } = await supabase
                    .from('service_providers')
                    .select('id, trade, business_name, status')
                    .eq('owner_id', session.user.id);

                const listings = data || [];

                // One listing is the only case that exists today, and the
                // decision emails all point here — so a one-row list is a
                // pointless tap on the way to the only thing it could show.
                // With two there is nothing to choose on their behalf.
                //
                // Not done when a group is open: they came here to add a
                // second trade, so sending them back into the first is the
                // opposite of what they asked for.
                if (!changing && !group && listings.length === 1) {
                    router.replace('/services/join/apply?trade=' + encodeURIComponent(listings[0].trade || 'sponge'));
                    return;
                }

                setMine(listings);
            } catch (err) {
                // A failed read just means they see every trade as new, which
                // is the right page for somebody who has never applied.
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [supabase, router, changing, group]);

    const open = (trade: string) =>
        router.push('/services/join/apply?trade=' + encodeURIComponent(trade));

    if (loading) {
        return <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-slate-500">Loading…</div>;
    }

    // ---- step two: the trades inside a group ------------------------------
    if (groupMeta) {
        const taken = mine.map((p: any) => String(p.trade || ''));
        const inGroup = tradesFor('host').filter((t) => groupForTrade(t.key) === groupMeta.key);

        return (
            <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 pb-24">
                <Link
                    href="/services/join"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 mb-6"
                >
                    <ChevronLeft className="w-4 h-4" />
                    Back
                </Link>

                <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
                    What is your trade?
                </h1>
                <p className="text-slate-600 mt-3 mb-8">
                    Pick the one people would ask for by name. You can add another afterwards
                    if you do more than one.
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {inGroup.map((t) => {
                        const Icon = TRADE_ICONS[t.key] || Wrench;
                        const already = taken.indexOf(t.key) !== -1;

                        return (
                            <button
                                key={t.key}
                                type="button"
                                onClick={() => open(t.key)}
                                className="rounded-2xl border border-slate-300 p-4 text-left hover:border-emerald-700 hover:bg-emerald-50/40 transition"
                            >
                                <Icon className="w-7 h-7 text-emerald-700 mb-3" strokeWidth={1.5} />
                                <span className="block font-semibold text-slate-900">{t.label}</span>
                                {already && (
                                    <span className="block text-xs text-slate-500 mt-1">You have this one</span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Said once, here, rather than on every trade that needs it.
                    Somebody who reads it now is not surprised by it later. */}
                <p className="text-xs text-slate-500 mt-8">
                    Gas work needs Gas Safe registration, oil needs OFTEC, and electrical work has to be
                    notified under Part P. We ask for your number and check it before you go live.
                </p>
            </div>
        );
    }

    // ---- step one ---------------------------------------------------------
    const entries = pickerEntries(mine, 'host');
    const left = unclaimedTrades(mine, 'host');
    const hasSome = mine.length > 0;

    return (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 pb-24">
            {/* Every step has a way back: /business chooses between working for
                owners and selling to guests, this chooses the trade, and the
                application has its own back to here. */}
            <Link
                href="/business"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 mb-6"
            >
                <ChevronLeft className="w-4 h-4" />
                Back
            </Link>

            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
                {hasSome ? 'Your businesses' : 'What do you do?'}
            </h1>
            <p className="text-slate-600 mt-3 mb-8">
                {hasSome
                    ? 'Open one to change it, or set up another trade as its own business.'
                    : 'Pick the one that fits best. It decides what we ask you next, and who finds you.'}
            </p>

            {hasSome && (
                <div className="space-y-3 mb-10">
                    {mine.map((p: any) => {
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
                                    {/* The name they trade under, with the
                                        trade underneath. Each one is its own
                                        business and they are often not called
                                        the same thing, so the name is what
                                        tells them apart. */}
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

            {entries.length > 0 && (
                <>
                    {hasSome && (
                        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                            Add another trade
                        </h2>
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {entries.map((entry) => {
                            const Icon = entry.kind === 'group'
                                ? (GROUP_ICONS[entry.key] || Wrench)
                                : (TRADE_ICONS[entry.key] || Sparkles);

                            const href = entry.kind === 'group'
                                ? '/services/join?group=' + encodeURIComponent(entry.key)
                                : null;

                            return (
                                <button
                                    key={entry.kind + ':' + entry.key}
                                    type="button"
                                    onClick={() => (href ? router.push(href) : open(entry.key))}
                                    className="rounded-2xl border border-slate-300 p-4 text-left hover:border-emerald-700 hover:bg-emerald-50/40 transition"
                                >
                                    <Icon className="w-7 h-7 text-emerald-700 mb-3" strokeWidth={1.5} />
                                    <span className="block font-semibold text-slate-900">{entry.label}</span>
                                    {entry.kind === 'group' && (
                                        <span className="block text-xs text-slate-500 mt-1">{entry.hint}</span>
                                    )}
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
