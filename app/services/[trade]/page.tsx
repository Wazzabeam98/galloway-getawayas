'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
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
    audienceForTrade,
    calloutLine,
    capabilityFor,
    registrationVerified,
    registrationExpired,
    registrationBlockers,
    schemeLabel,
    initialsFor,
    pricingModelFor,
    pointForListing,
} from '@/lib/serviceProviders';
import EnquiryForm from '@/components/services/EnquiryForm';
import WantedPrompt from '@/components/services/WantedPrompt';

// Who covers you, for one trade.
//
// IT DOES NOT ASK WHERE THE PROPERTY IS
//
// A host has already told us, on the listing. Asking again is asking somebody
// to type an answer we are holding, and it turns a shop into a form. So the
// search point comes from their listing — its own coordinates where it has
// them, the town in `location` where it does not — and the page simply shows
// who covers there.
//
// The override is not an afterthought. Somebody with four cottages is asking
// about ONE of them, and somebody may be asking about a place that is not on
// the site at all. So the property is switchable and there is a way out to a
// plain town picker, both one press away and neither in the way of the common
// case, which is a host with one cottage who wants a plumber for it.
//
// The picker is also the fallback rather than an error: a listing with no
// coordinates and an unrecognised town is an ordinary old row, not a fault.
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
// leaking them. It does not make them private — 20260827185827_provider_status_grants
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
    // Null until the host overrides. Not defaulted to a town, because a
    // default here would silently win over their own property.
    const [manualTown, setManualTown] = useState<string | null>(null);
    const [listingId, setListingId] = useState('');
    const [choosing, setChoosing] = useState(false);
    const [providers, setProviders] = useState<Provider[]>([]);
    const [areas, setAreas] = useState<any[]>([]);
    const [prices, setPrices] = useState<any[]>([]);
    const [extras, setExtras] = useState<any[]>([]);
    const [registrations, setRegistrations] = useState<any[]>([]);
    const [listings, setListings] = useState<any[]>([]);
    const [session, setSession] = useState<any>(null);
    const [asking, setAsking] = useState<Provider | null>(null);

    const known = canBeEnquiredAbout(trade);

    // Guest trades are not part of the host shop, and asking canBeEnquiredAbout
    // about a chef is the wrong question — a chef is bookable, not enquired
    // about. A guest experience only means something with a stay behind it (a
    // cottage, dates, who covers it), which a bare /services/chef URL does not
    // have. So send them where they can act: their trips if they are signed in
    // with a stay coming up, otherwise the cottages.
    const router = useRouter();
    const isGuestTrade = audienceForTrade(trade) === 'guest';

    useEffect(() => {
        if (!isGuestTrade) return;
        let cancelled = false;
        (async () => {
            const { data: { session } } = await supabase.auth.getSession();
            let target = '/homes';
            if (session?.user) {
                const today = new Date().toISOString().split('T')[0];
                const { data: upcoming } = await supabase
                    .from('bookings')
                    .select('id')
                    .eq('guest_id', session.user.id)
                    .gte('check_out', today)
                    .limit(1);
                if (upcoming && upcoming.length) target = '/trips';
            }
            if (!cancelled) router.replace(target);
        })();
        return () => { cancelled = true; };
    }, [isGuestTrade, supabase, router]);

    useEffect(() => {
        if (!known) { setLoading(false); return; }

        const load = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setSession(session);

            if (session?.user) {
                const { data: mine } = await supabase
                    // listing_private: your own listings — latitude/longitude are
                    // revoked from the base table for the browser role.
                    .from('listing_private')
                    .select('id, title, location, bedrooms, latitude, longitude')
                    .eq('host_id', session.user.id)
                    .order('created_at', { ascending: true });

                setListings(mine || []);

                // The first one that can actually be located. A host whose
                // oldest listing predates the coordinate columns should not
                // land on the picker while their other three would have
                // answered the question.
                const usable = (mine || []).filter((l: any) => !!pointForListing(l))[0];
                if (usable) setListingId(usable.id);
            }

            const { data: rows } = await supabase
                .from('service_providers')
                .select('id, business_name, description, logo, trade, callout_fee, hourly_rate, callout_waived, does_gas, does_oil')
                .eq('trade', trade)
                .eq('status', 'approved')
                // OUT OF THE SHOP WINDOW WHEN THEY HAVE NOT PAID.
                //
                // Two columns, never one. `status` is what an admin decided
                // about the business; `subscription_status` is whether the
                // subscription is being paid. Folding non-payment into
                // `status` would collide with the approve route, which guards
                // its write on the status it read.
                //
                // Only 'unpaid' hides — not past_due, where Stripe is still
                // retrying. See visibleInDirectory in lib/serviceSubscription.
                //
                // This is a client component on the anon key, so it depends on
                // the column grant in 20260831170000. Without it the filter
                // returns nothing and the whole directory empties, which is at
                // least the loud version of the failure.
                .neq('subscription_status', 'unpaid');

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

    // Where we are searching from, and how we know.
    const listing = listings.filter((l) => l.id === listingId)[0] || null;
    const manual = manualTown ? townByKey(manualTown) : null;

    const point = manual
        ? { lat: manual.lat, lng: manual.lng, label: manual.label, from: 'town' as const }
        : pointForListing(listing);

    const shown = useMemo(() => {
        if (!point) return [];

        return providers
            .map((provider) => {
                const mine = areas.filter((a) => a.provider_id === provider.id);
                const regs = registrations.filter((r) => r.provider_id === provider.id);
                const offered = extras
                    .filter((e) => e.provider_id === provider.id && e.offered)
                    .map((e) => String(e.extra_key));

                const distance = mine.length
                    ? Math.min(...mine.map((a) =>
                        milesBetween(a.centre_lat, a.centre_lng, point.lat, point.lng)))
                    : Infinity;

                return { provider, areas: mine, regs, offered, distance };
            })
            .filter((row) => coversPoint(row.areas as any, point.lat, point.lng))
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
    }, [providers, areas, registrations, extras, point, trade]);

    if (isGuestTrade) {
        // Redirecting (effect above). A quiet holding line rather than the host
        // shop's "not this one yet", which would be wrong about something that
        // is bookable.
        return (
            <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
                <p className="text-slate-500">Taking you there…</p>
            </div>
        );
    }

    if (!known) {
        return (
            <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
                <h1 className="text-2xl font-bold text-slate-900">Not this one yet</h1>
                <p className="text-slate-600 mt-3">
                    That trade cannot be enquired about through the site yet.
                </p>
                <Link href="/services/property" className="text-emerald-700 font-semibold underline mt-6 inline-block">
                    Back to the list
                </Link>
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 pb-24">
            <Link href="/services/property" className="text-sm text-slate-500 hover:text-slate-700">
                ← All trades
            </Link>

            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 mt-3">
                {tradeLabel(trade)}
            </h1>

            {/* Told, not asked. The question only appears if we could not
                work it out, or if the host presses Change. */}
            {point && !choosing && (
                <p className="text-slate-600 mt-3">
                    Covering <strong className="text-slate-900">{point.label}</strong>
                    {listing && !manual && (
                        <span className="text-slate-500"> — {listing.title}</span>
                    )}
                    {' '}
                    <button
                        onClick={() => setChoosing(true)}
                        className="text-emerald-700 font-semibold underline hover:text-emerald-800"
                    >
                        Change
                    </button>
                </p>
            )}

            {(choosing || !point) && (
                <div className="mt-5 rounded-2xl border border-slate-300 p-4 space-y-3">
                    {!point && (
                        <p className="text-sm text-slate-600">
                            We could not tell where to search from, so pick a town.
                        </p>
                    )}

                    {listings.length > 0 && (
                        <label className="block">
                            <span className="text-sm font-semibold text-slate-700">
                                Which property?
                            </span>
                            <select
                                value={manualTown ? '' : listingId}
                                onChange={(e) => { setManualTown(null); setListingId(e.target.value); }}
                                className="mt-1.5 w-full sm:w-80 rounded-xl border border-slate-300 px-3 py-2.5"
                            >
                                <option value="">Somewhere else</option>
                                {listings.map((l) => (
                                    <option key={l.id} value={l.id} disabled={!pointForListing(l)}>
                                        {l.title}
                                        {pointForListing(l) ? '' : ' — no address on file'}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}

                    <label className="block">
                        <span className="text-sm font-semibold text-slate-700">
                            {listings.length > 0 ? 'Or a town' : 'Where is the property?'}
                        </span>
                        <select
                            value={manualTown || ''}
                            onChange={(e) => {
                                setManualTown(e.target.value || null);
                                if (e.target.value) setListingId('');
                            }}
                            className="mt-1.5 w-full sm:w-80 rounded-xl border border-slate-300 px-3 py-2.5"
                        >
                            <option value="">—</option>
                            {COVERAGE_TOWNS.map((t) => (
                                <option key={t.key} value={t.key}>{t.label}</option>
                            ))}
                        </select>
                    </label>

                    {point && (
                        <button
                            onClick={() => setChoosing(false)}
                            className="text-sm font-semibold text-emerald-700 underline"
                        >
                            Done
                        </button>
                    )}
                </div>
            )}

            {loading && <p className="text-slate-500 mt-8">Loading…</p>}

            {/* THE EMPTY STATE IS THE COMMON CASE ON DAY ONE.
                The directory starts empty and tradesmen are signed up by hand,
                so most first visits find nobody. "Nobody covers Wigtown yet"
                read like a broken site rather than a young one, and left the
                host with nothing to do.
                What they can do is tell us, and that answer is the most useful
                thing this page produces — three hosts wanting a roofer in
                Wigtown is a recruiting list. It promises them nothing, which is
                why the wording says we will let them know rather than that
                somebody will call. */}
            {!loading && shown.length === 0 && (
                <WantedPrompt
                    trade={trade}
                    area={point ? point.label : ''}
                    listingId={listing ? listing.id : ''}
                />
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
                                        alt={`${provider.business_name} logo`}
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
                    listingId={listingId}
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
