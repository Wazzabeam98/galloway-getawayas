'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { ShieldCheck, MapPin, Clock } from 'lucide-react';
import {
    COVERAGE_TOWNS,
    townByKey,
    coversPoint,
    milesBetween,
    tradeLabel,
    canBeEnquiredAbout,
    calloutLine,
    capabilityFor,
    registrationVerified,
    registrationExpired,
    registrationBlockers,
    schemeLabel,
    initialsFor,
    pricingModelFor,
} from '@/lib/serviceProviders';
import EnquiryForm from '@/components/services/EnquiryForm';

// Who covers you, for one trade.
//
// ORDERED BY DISTANCE, AND NOTHING ELSE
//
// Not by rating, not by how much anybody pays, not by how fast they answer.
// Distance from the town the host picked is a fact about the world, it needs
// no scoring system nobody would trust, and it does not read like a position
// that was sold. The day there is a better order it should be an argued
// change, not something that crept in.
//
// WHAT IS NOT ON THIS PAGE, AND WHAT THAT IS WORTH
//
// A phone number and an email address. The decision of 26 Aug 2026 keeps
// contact details off a provider's listing so the first approach happens on
// the platform — see lib/contactDetails.ts. The enquiry IS that approach, and
// accepting it is what releases the details. The one exception is an
// emergency, where the number is the whole point; see the form.
//
// So this query does not ask for `contact_phone` or `contact_email`, and it
// must not start: whatever this page selects is in the network response
// whether or not anything renders it.
//
// BE CLEAR ABOUT WHAT THAT DOES AND DOES NOT ACHIEVE. It stops this page
// leaking them. It does not make them private — 20260829_provider_status_grants
// grants `select` on the whole of service_providers to anon, so anybody with
// the public key can read every approved provider's number directly. Not
// fetching them here is politeness, not a wall, and the wall wants a table of
// its own. Do not read this comment as a guarantee.

interface Provider {
    id: string;
    business_name: string;
    description: string;
    logo: string | null;
    trade: string;
    callout_fee: any;
    hourly_rate: any;
    callout_waived: boolean;
    does_gas: boolean;
    does_oil: boolean;
}

export default function TradeShopPage({ params }: { params: { trade: string } }) {
    const supabase = createClientComponentClient();
    const trade = String(params.trade || '');

    const [loading, setLoading] = useState(true);
    const [townKey, setTownKey] = useState('kirkcudbright');
    const [providers, setProviders] = useState<Provider[]>([]);
    const [areas, setAreas] = useState<any[]>([]);
    const [prices, setPrices] = useState<any[]>([]);
    const [extras, setExtras] = useState<any[]>([]);
    const [registrations, setRegistrations] = useState<any[]>([]);
    const [listings, setListings] = useState<any[]>([]);
    const [session, setSession] = useState<any>(null);
    const [asking, setAsking] = useState<Provider | null>(null);

    const known = canBeEnquiredAbout(trade);

    useEffect(() => {
        if (!known) { setLoading(false); return; }

        const load = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setSession(session);

            if (session?.user) {
                const { data: mine } = await supabase
                    .from('listings')
                    .select('id, title, location, bedrooms, latitude, longitude')
                    .eq('host_id', session.user.id);
                setListings(mine || []);

                // The town is a guess from their own property rather than a
                // question, and it is only a default — a host with a cottage
                // in Wigtown and a flat in Moffat changes it.
                const first = (mine || [])[0];
                if (first) {
                    const match = COVERAGE_TOWNS.filter(
                        (t) => String(first.location || '').toLowerCase().indexOf(t.label.toLowerCase()) !== -1
                    )[0];
                    if (match) setTownKey(match.key);
                }
            }

            const { data: rows } = await supabase
                .from('service_providers')
                .select('id, business_name, description, logo, trade, callout_fee, hourly_rate, callout_waived, does_gas, does_oil')
                .eq('trade', trade)
                .eq('status', 'approved');

            const list = (rows || []) as Provider[];
            setProviders(list);

            const ids = list.map((p) => p.id);
            if (ids.length) {
                const [a, pr, ex, rg] = await Promise.all([
                    supabase.from('service_areas').select('provider_id, label, centre_lat, centre_lng, radius_miles').in('provider_id', ids),
                    supabase.from('service_provider_prices').select('provider_id, band_key, price, typical_hours').in('provider_id', ids),
                    supabase.from('service_provider_extras').select('provider_id, extra_key, offered').in('provider_id', ids),
                    supabase.from('service_provider_registrations').select('provider_id, scheme, number, verified_at, verified_number, expires_at').in('provider_id', ids),
                ]);
                setAreas(a.data || []);
                setPrices(pr.data || []);
                setExtras(ex.data || []);
                setRegistrations(rg.data || []);
            }

            setLoading(false);
        };

        load();
    }, [trade, known, supabase]);

    const town = townByKey(townKey);

    const shown = useMemo(() => {
        if (!town) return [];

        return providers
            .map((provider) => {
                const mine = areas.filter((a) => a.provider_id === provider.id);
                const regs = registrations.filter((r) => r.provider_id === provider.id);
                const offered = extras
                    .filter((e) => e.provider_id === provider.id && e.offered)
                    .map((e) => String(e.extra_key));

                const distance = mine.length
                    ? Math.min(...mine.map((a) =>
                        milesBetween(a.centre_lat, a.centre_lng, town.lat, town.lng)))
                    : Infinity;

                return { provider, areas: mine, regs, offered, distance };
            })
            .filter((row) => coversPoint(row.areas as any, town.lat, town.lng))
            // A registration that has run out is not a detail to show in small
            // print — it is the difference between a Gas Safe engineer and
            // somebody who was one last year. They come off the list entirely,
            // the same rule the enquiry route enforces on the way in.
            .filter((row) => registrationBlockers(
                {
                    trade,
                    does_gas: row.provider.does_gas,
                    does_oil: row.provider.does_oil,
                },
                row.regs
            ).length === 0)
            .sort((a, b) => a.distance - b.distance);
    }, [providers, areas, registrations, extras, town, trade]);

    if (!known) {
        return (
            <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
                <h1 className="text-2xl font-bold text-slate-900">Not this one yet</h1>
                <p className="text-slate-600 mt-3">
                    That trade cannot be enquired about through the site yet.
                </p>
                <Link href="/services" className="text-emerald-700 font-semibold underline mt-6 inline-block">
                    Back to the list
                </Link>
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 pb-24">
            <Link href="/services" className="text-sm text-slate-500 hover:text-slate-700">
                ← All trades
            </Link>

            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 mt-3">
                {tradeLabel(trade)}
            </h1>

            <label className="block mt-6">
                <span className="text-sm font-semibold text-slate-700">Where is the property?</span>
                <select
                    value={townKey}
                    onChange={(e) => setTownKey(e.target.value)}
                    className="mt-1.5 w-full sm:w-72 rounded-xl border border-slate-300 px-3 py-2.5 text-slate-900"
                >
                    {COVERAGE_TOWNS.map((t) => (
                        <option key={t.key} value={t.key}>{t.label}</option>
                    ))}
                </select>
            </label>

            {loading && <p className="text-slate-500 mt-8">Loading…</p>}

            {!loading && shown.length === 0 && (
                <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-6">
                    <p className="font-semibold text-slate-900">
                        Nobody covers {town ? town.label : 'there'} yet.
                    </p>
                    <p className="text-sm text-slate-600 mt-2">
                        We are still signing businesses up. Try a nearby town — plenty of them cover
                        more ground than the name suggests.
                    </p>
                </div>
            )}

            <div className="mt-8 space-y-4">
                {!loading && shown.map(({ provider, areas: mine, regs, offered, distance }) => {
                    const price = calloutLine(provider.callout_fee, provider.callout_waived);
                    const availability = capabilityFor(trade)
                        .filter((e) => e.group === 'availability' && offered.indexOf(e.key) !== -1);

                    return (
                        <div key={provider.id} className="rounded-2xl border border-slate-300 p-5">
                            <div className="flex items-start gap-4">
                                {provider.logo ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                        src={provider.logo}
                                        alt=""
                                        className="w-14 h-14 rounded-xl object-cover border border-slate-200"
                                    />
                                ) : (
                                    <div className="w-14 h-14 rounded-xl bg-emerald-50 text-emerald-800 font-bold flex items-center justify-center">
                                        {initialsFor(provider.business_name)}
                                    </div>
                                )}

                                <div className="flex-1 min-w-0">
                                    <h2 className="font-bold text-slate-900">{provider.business_name}</h2>

                                    <p className="text-sm text-slate-500 flex items-center gap-1.5 mt-0.5">
                                        <MapPin className="w-3.5 h-3.5" strokeWidth={1.75} />
                                        {isFinite(distance) ? Math.round(distance) + ' miles away' : 'Covers this area'}
                                    </p>

                                    {provider.description && (
                                        <p className="text-sm text-slate-600 mt-2">{provider.description}</p>
                                    )}

                                    {/* His own published figures. Not a quote — nothing here
                                        computes a total, because nothing here takes a cut. */}
                                    {(price || provider.hourly_rate) && (
                                        <p className="text-sm font-semibold text-slate-900 mt-3">
                                            {[price, provider.hourly_rate ? '£' + provider.hourly_rate + ' an hour' : '']
                                                .filter(Boolean)
                                                .join(' · ')}
                                        </p>
                                    )}

                                    {pricingModelFor(trade) === 'quoted' && (
                                        <p className="text-xs text-slate-500 mt-1">
                                            Bigger jobs are quoted after a look.
                                        </p>
                                    )}

                                    {/* The number is public on purpose: the Gas Safe register
                                        is searchable by design, so a host can check it. */}
                                    {regs.filter((r) => registrationVerified(r) && !registrationExpired(r)).map((r) => (
                                        <p key={r.scheme} className="text-sm text-emerald-800 flex items-center gap-1.5 mt-2">
                                            <ShieldCheck className="w-4 h-4" strokeWidth={1.75} />
                                            {schemeLabel(r.scheme)} {r.number} — checked by us
                                        </p>
                                    ))}

                                    {availability.length > 0 && (
                                        <p className="text-sm text-slate-600 flex items-center gap-1.5 mt-2">
                                            <Clock className="w-4 h-4" strokeWidth={1.75} />
                                            {availability.map((e) => e.label).join(' · ')}
                                        </p>
                                    )}

                                    <button
                                        onClick={() => setAsking(provider)}
                                        className="mt-4 rounded-xl bg-emerald-700 px-4 py-2.5 text-white text-sm font-semibold hover:bg-emerald-800"
                                    >
                                        Ask {provider.business_name}
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {asking && (
                <EnquiryForm
                    provider={asking}
                    trade={trade}
                    listings={listings}
                    session={session}
                    offered={extras
                        .filter((e) => e.provider_id === asking.id && e.offered)
                        .map((e) => String(e.extra_key))}
                    onClose={() => setAsking(null)}
                />
            )}
        </div>
    );
}
