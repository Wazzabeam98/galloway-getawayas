'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import {
    HOST_TRADES,
    tradeLabel,
    isTradeComingSoon,
    registrationBlockers,
} from '@/lib/serviceProviders';
import { GUEST_REGIONS, GUEST_COVERAGE_ALL_KEY } from '@/lib/strings';
import EnquiryForm from '@/components/services/EnquiryForm';
import TradeCard, { type DirectoryProvider } from '@/components/services/TradeCard';

// ONE LIST OF TRADESPEOPLE, THE WHOLE HOST SIDE ON A SINGLE PAGE
//
// This replaces the old signpost (/services) and the trade-tile grid
// (/services/property), and the per-trade shop pages (/services/<trade>) that
// each asked "where is the property?" and ordered by distance. A host who wants
// help with their let lands straight on the tradespeople, laid out like the
// property search: a grid of profile cards, no map, full width. Trade is a
// filter, not a page — pick "Joiner" and the list narrows; there is no separate
// joiner page any more.
//
// TWO FILTERS, STYLED LIKE THE PROPERTY SEARCH
//
// Area (all of Dumfries & Galloway by default, or one of the regions a trade
// tells us it covers) and trade type. A trade nobody covers never appears — its
// option is not offered and no empty category is shown. Coming-soon trades are
// dropped entirely rather than shown greyed out.
//
// WHAT IS NOT HERE
//
// No contact number and no email — the same rule as before: the first approach
// happens through the enquiry, and accepting it is what releases the details.
// The query does not select those columns.

// The host trades that can actually show — every host trade that is open for
// business (coming-soon ones are dropped, not greyed).
const VISIBLE_TRADES = (HOST_TRADES as readonly string[]).filter((t) => !isTradeComingSoon(t));

const ALL_REGION = GUEST_REGIONS.find((r) => r.key === GUEST_COVERAGE_ALL_KEY)!;
const REGION_FILTERS = GUEST_REGIONS.filter((r) => r.key !== GUEST_COVERAGE_ALL_KEY);

type Row = {
    provider: DirectoryProvider;
    regionLabels: string[];
    offered: string[];
    regs: any[];
};

export default function TradeDirectory() {
    const supabase = createClientComponentClient();
    const router = useRouter();
    const searchParams = useSearchParams();

    const [loading, setLoading] = useState(true);
    const [rows, setRows] = useState<Row[]>([]);
    const [listings, setListings] = useState<any[]>([]);
    const [session, setSession] = useState<any>(null);
    const [asking, setAsking] = useState<Row | null>(null);

    // Filters. Area defaults to everywhere; trade defaults to all. Both are read
    // once from the URL so a link like /services?trade=joiner lands filtered.
    const [area, setArea] = useState<string>('all');
    const [tradeKey, setTradeKey] = useState<string>(searchParams?.get('trade') || 'all');

    useEffect(() => {
        const load = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setSession(session);

            if (session?.user) {
                // The host's own cottages, so the enquiry can be attached to one
                // without asking them to type an address we already hold.
                const { data: mine } = await supabase
                    .from('listing_private')
                    .select('id, title, location')
                    .eq('host_id', session.user.id)
                    .order('created_at', { ascending: true });
                setListings(mine || []);
            }

            // Every open host trade, approved and paid. No contact columns — see
            // the note at the top of the file. Guest experiences are excluded by
            // asking only for the visible host trades.
            //
            // A trade that has taken their listing down (owner_paused), or that
            // we have (admin_hidden_at), never comes back from this read: those
            // columns are private to the browser, so the database's public
            // SELECT policy drops the rows itself (20261004160000) — the same
            // rule visibleInDirectory applies on the server.
            const { data: provRows } = await supabase
                .from('service_providers')
                .select('id, business_name, description, logo, headshot, photos, trade, callout_fee, hourly_rate, flat_fee, provides_quote, callout_waived, registration_number, does_gas, does_oil, does_emergency, does_scheduled')
                .in('trade', VISIBLE_TRADES)
                .eq('status', 'approved')
                .neq('subscription_status', 'unpaid');

            const list = (provRows || []) as DirectoryProvider[];
            const ids = list.map((p) => p.id);

            let areas: any[] = [];
            let extras: any[] = [];
            let registrations: any[] = [];
            if (ids.length) {
                const [a, ex, rg] = await Promise.all([
                    supabase.from('service_areas').select('provider_id, label').in('provider_id', ids),
                    supabase.from('service_provider_extras').select('provider_id, extra_key, offered').in('provider_id', ids),
                    supabase.from('service_provider_registrations').select('provider_id, scheme, number, verified_at, verified_number, expires_at').in('provider_id', ids),
                ]);
                areas = a.data || [];
                extras = ex.data || [];
                registrations = rg.data || [];
            }

            const built: Row[] = list
                .map((provider) => {
                    const regionLabels = areas
                        .filter((x) => x.provider_id === provider.id)
                        .map((x) => String(x.label))
                        .filter(Boolean);
                    const offered = extras
                        .filter((e) => e.provider_id === provider.id && e.offered)
                        .map((e) => String(e.extra_key));
                    const regs = registrations.filter((r) => r.provider_id === provider.id);
                    return { provider, regionLabels, offered, regs };
                })
                // A registration that has run out takes them off the list entirely
                // — the same rule the enquiry route enforces. An expired Gas Safe
                // is the difference between a registered engineer and somebody who
                // was one last year.
                .filter((row) => registrationBlockers(
                    { trade: row.provider.trade, does_gas: row.provider.does_gas, does_oil: row.provider.does_oil },
                    row.regs,
                ).length === 0);

            setRows(built);
            setLoading(false);
        };

        load();
    }, [supabase]);

    // The trade options only include trades that actually have somebody on the
    // list — a trade nobody covers is not offered.
    const tradeOptions = useMemo(() => {
        const present = new Set(rows.map((r) => r.provider.trade));
        return VISIBLE_TRADES
            .filter((t) => present.has(t))
            .map((t) => ({ key: t, label: tradeLabel(t) }));
    }, [rows]);

    // The area and trade filters, both plain ANDs. A region matches when the
    // provider ticked that region OR ticked "all of Dumfries & Galloway".
    const shown = useMemo(() => {
        const wantedRegion = REGION_FILTERS.find((r) => r.key === area);
        return rows.filter((row) => {
            if (tradeKey !== 'all' && row.provider.trade !== tradeKey) return false;
            if (wantedRegion) {
                const covers = row.regionLabels.some(
                    (l) => l === wantedRegion.label || l === ALL_REGION.label,
                );
                if (!covers) return false;
            }
            return true;
        });
    }, [rows, area, tradeKey]);

    // Deep link from a profile page: /services?ask=<id> opens that trade's
    // enquiry as soon as the list is in. Fires once.
    const askId = searchParams?.get('ask') || '';
    const [askOpened, setAskOpened] = useState(false);
    useEffect(() => {
        if (!askId || askOpened || asking || loading) return;
        const row = rows.find((r) => r.provider.id === askId);
        if (row) { setAsking(row); setAskOpened(true); }
    }, [askId, askOpened, asking, loading, rows]);

    const filtered = tradeKey !== 'all' || area !== 'all';
    const areaLabel = REGION_FILTERS.find((r) => r.key === area)?.label || '';

    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-14">
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900">
                Tradespeople for your property
            </h1>
            <p className="mt-3 max-w-2xl text-slate-600">
                Local trades who cover holiday lets across Dumfries &amp; Galloway. See who they
                are and what they charge, then ask one — you agree the job with them directly.
            </p>
            {/* The host is the one paying, so the host is the one who needs telling.
                Trades pay a flat subscription; nothing is taken per job (see the
                tradesperson agreement). This line was on /services/property until
                that page became a redirect. */}
            <p className="mt-2 max-w-2xl text-sm text-slate-500">
                We take nothing from what you pay them.
            </p>

            {/* The filter bar — the property search's own look: a white lifted
                bar with labelled fields. Area on the left, trade on the right. */}
            <div className="mt-6 flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_6px_16px_rgba(0,0,0,0.12)] sm:flex-row sm:divide-x sm:divide-slate-200">
                <label className="flex-1 px-5 py-3">
                    <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Area</span>
                    <select
                        value={area}
                        onChange={(e) => setArea(e.target.value)}
                        className="mt-1 w-full cursor-pointer border-none bg-transparent p-0 text-base font-medium text-slate-900 focus:outline-none focus:ring-0"
                    >
                        <option value="all">{ALL_REGION.label}</option>
                        {REGION_FILTERS.map((r) => (
                            <option key={r.key} value={r.key}>{r.label}</option>
                        ))}
                    </select>
                </label>
                <label className="flex-1 border-t border-slate-200 px-5 py-3 sm:border-t-0">
                    <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Trade</span>
                    <select
                        value={tradeKey}
                        onChange={(e) => setTradeKey(e.target.value)}
                        className="mt-1 w-full cursor-pointer border-none bg-transparent p-0 text-base font-medium text-slate-900 focus:outline-none focus:ring-0"
                    >
                        <option value="all">All trades</option>
                        {tradeOptions.map((t) => (
                            <option key={t.key} value={t.key}>{t.label}</option>
                        ))}
                    </select>
                </label>
            </div>

            {loading ? (
                <p className="mt-10 text-slate-500">Loading…</p>
            ) : shown.length > 0 ? (
                <div className="mt-8 grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
                    {shown.map((row) => (
                        <TradeCard
                            key={row.provider.id}
                            provider={row.provider}
                            regionLabels={row.regionLabels}
                            regs={row.regs}
                            onAsk={() => setAsking(row)}
                        />
                    ))}
                </div>
            ) : (
                /* The property search's empty state — a plain bordered box that
                   says what was searched, not a broken-looking site. */
                <div className="mt-8 rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center">
                    <h3 className="text-lg font-semibold text-slate-800">
                        {filtered ? 'No tradespeople match that' : 'No tradespeople listed yet'}
                    </h3>
                    <p className="mx-auto mt-1 max-w-md text-slate-500">
                        {filtered
                            ? `Nobody covers ${areaLabel || 'that area'}${tradeKey !== 'all' ? ' for ' + tradeLabel(tradeKey).toLowerCase() : ''} yet. Try a wider area or another trade.`
                            : 'We are signing up local trades now. Check back soon.'}
                    </p>
                    {filtered && (
                        <button
                            type="button"
                            onClick={() => { setArea('all'); setTradeKey('all'); }}
                            className="mt-5 inline-block rounded-full bg-emerald-700 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800"
                        >
                            Show all trades
                        </button>
                    )}
                </div>
            )}

            {asking && (
                <EnquiryForm
                    provider={asking.provider}
                    trade={asking.provider.trade}
                    listings={listings}
                    listingId={listings[0]?.id || ''}
                    session={session}
                    offered={asking.offered}
                    onClose={() => setAsking(null)}
                />
            )}
        </div>
    );
}
