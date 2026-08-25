'use client';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { toast } from 'react-toastify';
import { Sparkles, Wrench, Trees, Droplet, ChefHat, Cake, ShoppingBasket, PawPrint, Trash2, Check, Plus, X } from 'lucide-react';
import { compressImage } from '@/lib/compressImage';
import { getImageUrl, generateRandomNumber } from '@/lib/utils';
import Env from '@/config/Env';
import LoginModel from '@/components/auth/LoginModel';
import {
    tradesFor,
    audienceForTrade,
    extrasFor,
    extrasProblems,
    groupIsOffered,
    groupGate,
    COVERAGE_TOWNS,
    townByKey,
    submitProblems,
    statusSummary,
    trialEndsAt,
    submitStatusPatch,
    pricingModelFor,
    bandsFor,
    canBeRequested,
    REVIEW_WITHIN_HOURS,
    TRIAL_DAYS,
} from '@/lib/serviceProviders';

const TRADE_ICONS: Record<string, any> = {
    sponge: Sparkles,
    spanner: Wrench,
    trees: Trees,
    droplet: Droplet,
    chef: ChefHat,
    cake: Cake,
    basket: ShoppingBasket,
    paw: PawPrint,
    bin: Trash2,
};

interface AreaRow {
    id?: string;
    town: string;
    radius_miles: number;
}

export default function JoinAsProvider() {
    const supabase = createClientComponentClient();

    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<any>(null);

    const [providerId, setProviderId] = useState<string | null>(null);
    const [status, setStatus] = useState('draft');
    const [reviewNote, setReviewNote] = useState<string | null>(null);

    const [businessName, setBusinessName] = useState('');
    const [trade, setTrade] = useState('sponge');
    const [description, setDescription] = useState('');
    const [contactEmail, setContactEmail] = useState('');
    const [contactPhone, setContactPhone] = useState('');
    const [photos, setPhotos] = useState<string[]>([]);
    const [areas, setAreas] = useState<AreaRow[]>([]);

    const [saving, setSaving] = useState(false);
    const [processingPhotos, setProcessingPhotos] = useState(false);
    const [touchedSubmit, setTouchedSubmit] = useState(false);

    // Keyed by band. Kept as strings so a half-typed price is not coerced to a
    // number mid-keystroke, and blank stays genuinely blank rather than 0.
    const [prices, setPrices] = useState<Record<string, { price: string; typical_hours: string }>>({});
    // Keyed by extra. Price stays a string for the same reason band prices
    // do — a half-typed number should not be coerced mid-keystroke.
    const [extras, setExtras] = useState<Record<string, { offered: boolean; price: string; notes: string }>>({});
    const [laundryOpen, setLaundryOpen] = useState<boolean | null>(null);
    const [calloutFee, setCalloutFee] = useState('');
    const [hourlyRate, setHourlyRate] = useState('');

    useEffect(() => {
        const load = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setSession(session);

            if (!session) {
                setLoading(false);
                return;
            }

            const { data: existing } = await supabase
                .from('service_providers')
                .select('id, business_name, trade, description, contact_email, contact_phone, audience, photos, status, review_note, callout_fee, hourly_rate')
                .eq('owner_id', session.user.id)
                .maybeSingle();

            if (existing) {
                setProviderId(existing.id);
                setBusinessName(existing.business_name || '');
                setTrade(existing.trade || 'sponge');
                setDescription(existing.description || '');
                setContactEmail(existing.contact_email || session.user.email || '');
                setContactPhone(existing.contact_phone || '');
                setPhotos(existing.photos || []);
                setStatus(existing.status || 'draft');
                setReviewNote(existing.review_note || null);
                setCalloutFee(existing.callout_fee === null || existing.callout_fee === undefined ? '' : String(existing.callout_fee));
                setHourlyRate(existing.hourly_rate === null || existing.hourly_rate === undefined ? '' : String(existing.hourly_rate));

                const { data: priceRows } = await supabase
                    .from('service_provider_prices')
                    .select('band_key, price, typical_hours')
                    .eq('provider_id', existing.id);

                const { data: extraRows } = await supabase
                    .from('service_provider_extras')
                    .select('extra_key, offered, price, notes')
                    .eq('provider_id', existing.id);

                const loadedExtras: Record<string, { offered: boolean; price: string; notes: string }> = {};
                for (const row of extraRows || []) {
                    loadedExtras[row.extra_key] = {
                        offered: row.offered === true,
                        price: row.price === null || row.price === undefined ? '' : String(row.price),
                        notes: row.notes || '',
                    };
                }
                setExtras(loadedExtras);
                setLaundryOpen(groupIsOffered('laundry', existing.trade || 'sponge', loadedExtras));

                const loaded: Record<string, { price: string; typical_hours: string }> = {};
                for (const row of priceRows || []) {
                    loaded[row.band_key] = {
                        price: String(row.price),
                        typical_hours: row.typical_hours === null || row.typical_hours === undefined
                            ? ''
                            : String(row.typical_hours),
                    };
                }
                setPrices(loaded);

                const { data: areaRows } = await supabase
                    .from('service_areas')
                    .select('id, label, radius_miles')
                    .eq('provider_id', existing.id);

                setAreas((areaRows || []).map((a: any) => ({
                    id: a.id,
                    town: a.label,
                    radius_miles: Number(a.radius_miles),
                })));
            } else {
                setContactEmail(session.user.email || '');
            }

            setLoading(false);
        };
        load();
    }, [supabase]);

    const problems = submitProblems({
        business_name: businessName,
        trade,
        description,
        contact_email: contactEmail,
        audience: audienceForTrade(trade),
        areaCount: areas.length,
        prices,
        callout_fee: calloutFee,
        hourly_rate: hourlyRate,
        extras,
    });

    const model = pricingModelFor(trade);
    const tradeExtras = extrasFor(trade);
    const extrasIn = (group: string) => tradeExtras.filter((e) => e.group === group);

    const extraOf = (key: string) => extras[key] || { offered: false, price: '', notes: '' };
    const setExtra = (key: string, field: 'offered' | 'price' | 'notes', value: any) =>
        setExtras((prev) => ({
            ...prev,
            [key]: Object.assign({ offered: false, price: '', notes: '' }, prev[key] || {}, { [field]: value }),
        }));

    const bands = bandsFor(trade);

    const setBand = (key: string, field: 'price' | 'typical_hours', value: string) =>
        setPrices((prev) => ({
            ...prev,
            [key]: Object.assign({ price: '', typical_hours: '' }, prev[key] || {}, { [field]: value }),
        }));

    const problemFor = (field: string) =>
        touchedSubmit ? (problems.filter((p) => p.field === field)[0] || null) : null;

    const addPhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (!files.length || !session) return;

        setProcessingPhotos(true);

        for (const file of files) {
            try {
                const ready = await compressImage(file);
                const path = 'providers/' + session.user.id + '-' + Date.now() + '_' + generateRandomNumber() + '.jpg';

                const { error } = await supabase.storage
                    .from(Env.S3_BUCKET)
                    .upload(path, ready, { contentType: 'image/jpeg' });

                if (error) {
                    toast.error(error.message, { theme: 'colored' });
                } else {
                    setPhotos((prev) => [...prev, path]);
                }
            } catch (err) {
                toast.error('That photo could not be read. Try a different one.', { theme: 'colored' });
            }
        }

        setProcessingPhotos(false);
    };

    // One row per circle. The town carries the coordinates, so a tradesperson
    // picks a place and a distance rather than a latitude.
    const addArea = () => {
        const used = areas.map((a) => a.town);
        const next = COVERAGE_TOWNS.filter((t) => used.indexOf(t.label) === -1)[0];
        if (!next) return;
        setAreas((prev) => [...prev, { town: next.label, radius_miles: 10 }]);
    };

    const save = async (submit: boolean) => {
        if (!session) return;

        if (submit) {
            setTouchedSubmit(true);
            if (problems.length) {
                toast.error('A few things still need filling in.', { theme: 'colored' });
                return;
            }
        }

        setSaving(true);

        const now = new Date();
        const payload: any = {
            owner_id: session.user.id,
            business_name: businessName.trim(),
            trade,
            description: description.trim(),
            contact_email: contactEmail.trim(),
            contact_phone: contactPhone.trim() || null,
            audience: audienceForTrade(trade),
            photos,
            // Only meaningful for a call-out trade; cleared otherwise so a
            // provider who switches trade does not carry a stale rate.
            callout_fee: model === 'callout_hourly' && calloutFee.trim() !== '' ? Number(calloutFee) : null,
            hourly_rate: model === 'callout_hourly' && hourlyRate.trim() !== '' ? Number(hourlyRate) : null,
            updated_at: now.toISOString(),
        };

        // What this does to the status fields is decided in lib, not here, so
        // that the rule can be tested: an approved provider is never knocked
        // back into the queue by their own edit.
        if (submit) {
            Object.assign(payload, submitStatusPatch(status, now, !providerId || status === 'draft'));
        }

        let id = providerId;

        if (id) {
            const { error } = await supabase.from('service_providers').update(payload).eq('id', id);
            if (error) {
                setSaving(false);
                toast.error(error.message, { theme: 'colored' });
                return;
            }
        } else {
            const { data, error } = await supabase
                .from('service_providers')
                .insert(payload)
                .select('id')
                .single();

            if (error || !data) {
                setSaving(false);
                toast.error((error && error.message) || 'Could not save that.', { theme: 'colored' });
                return;
            }
            id = data.id;
            setProviderId(id);
        }

        // Extras are replaced wholesale, like the prices and the areas. Only
        // what is offered is written — a row that is not there is a no.
        await supabase.from('service_provider_extras').delete().eq('provider_id', id);

        const extraRows = tradeExtras
            .filter((extra) => {
                const entry = extraOf(extra.key);
                // A priced extra says yes by having a price. Nothing else to
                // agree or disagree with, and a blank is a no.
                if (extra.type === 'priced') {
                    return String(entry.price).trim() !== '' && Number(entry.price) > 0;
                }
                return entry.offered;
            })
            .map((extra) => {
                const entry = extraOf(extra.key);
                const priced = extra.type === 'priced' && String(entry.price).trim() !== '' && Number(entry.price) > 0;
                return {
                    provider_id: id,
                    extra_key: extra.key,
                    offered: true,
                    // Null for a toggle, and null for a reimbursed one: the
                    // amount is whatever the receipt says, weeks later. It is
                    // paid host to provider directly and never through us.
                    price: priced ? Number(entry.price) : null,
                    notes: String(entry.notes || '').trim() || null,
                    updated_at: now.toISOString(),
                };
            });

        if (extraRows.length) {
            await supabase.from('service_provider_extras').insert(extraRows);
        }

        // Prices are replaced wholesale, like the areas. A row that is not
        // there is the blank band, and a blank band is a real answer — it means
        // "I do not cover that size" and keeps them out of results for it.
        await supabase.from('service_provider_prices').delete().eq('provider_id', id);

        if (model === 'bands') {
            const priceRows = bandsFor(trade)
                .filter((band) => {
                    const entry = prices[band.key];
                    return entry && String(entry.price).trim() !== '' && Number(entry.price) > 0;
                })
                .map((band) => {
                    const entry = prices[band.key];
                    const hours = String(entry.typical_hours || '').trim();
                    return {
                        provider_id: id,
                        band_key: band.key,
                        price: Number(entry.price),
                        // Stored as hours, never a rate, and never multiplied
                        // by anything. See tests/service-pricing.test.ts.
                        typical_hours: hours === '' || !(Number(hours) > 0) ? null : Number(hours),
                        updated_at: now.toISOString(),
                    };
                });

            if (priceRows.length) {
                await supabase.from('service_provider_prices').insert(priceRows);
            }
        }

        // Areas are replaced wholesale — there are only ever a handful, and
        // diffing them would be more code than it saves.
        await supabase.from('service_areas').delete().eq('provider_id', id);

        if (areas.length) {
            const rows = areas.map((a) => {
                const town = COVERAGE_TOWNS.filter((t) => t.label === a.town)[0];
                return {
                    provider_id: id,
                    label: a.town,
                    centre_lat: town ? town.lat : 0,
                    centre_lng: town ? town.lng : 0,
                    radius_miles: a.radius_miles,
                };
            });
            await supabase.from('service_areas').insert(rows);
        }

        // Told last, once the row and its areas are both written, so the
        // email describes what was actually saved rather than what was about
        // to be. It cannot email us itself — lib/email holds the API key and
        // must never reach the browser — so a route does it.
        //
        // Nothing here is shown to them if it fails. They have done their
        // part; a problem reaching us is ours, and the route logs it.
        if (submit || status === 'approved') {
            try {
                await fetch('/api/services/submitted', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id }),
                });
            } catch (err) {
                // Deliberately swallowed — see above.
            }
        }

        setSaving(false);

        if (submit && status === 'approved') {
            toast.success('Saved. You are still live.', { theme: 'colored' });
        } else if (submit) {
            setStatus('pending_review');
            toast.success('Sent to us for review.', { theme: 'colored' });
        } else {
            toast.success('Saved.', { theme: 'colored' });
        }
    };

    if (loading) {
        return <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-slate-500">Loading…</div>;
    }

    if (!session) {
        return (
            <div className="max-w-md mx-auto px-4 sm:px-6 py-24 text-center">
                <h1 className="text-2xl font-bold text-slate-900 mb-2">Work for holiday lets</h1>
                <p className="text-slate-600 mb-6">Sign in to get started — it takes a few minutes.</p>
                <LoginModel />
            </div>
        );
    }

    const summary = statusSummary(status);
    const locked = status === 'pending_review';

    return (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 pb-24">
            <h1 className="text-3xl font-bold text-slate-900">Work for holiday lets</h1>
            <p className="text-slate-600 mt-2 mb-8">
                Cleaning, waste, gardening and maintenance for holiday cottages across Dumfries
                &amp; Galloway. The people who own them find you here and ask you for work.
                It is free for your first {TRIAL_DAYS} days and we will tell you before that changes.
            </p>

            {/* Sent, and waiting on us. */}
            {status === 'pending_review' && (
                <div className="mb-8 rounded-2xl border border-amber-300 bg-amber-50 p-5">
                    <p className="font-semibold text-amber-900">{summary.label}</p>
                    <p className="text-sm text-amber-900/80 mt-1">
                        Thanks — we check every business before it appears, usually within {REVIEW_WITHIN_HOURS} hours.
                        We will email you either way. You can still read what you sent below.
                    </p>
                </div>
            )}

            {status === 'declined' && (
                <div className="mb-8 rounded-2xl border border-rose-300 bg-rose-50 p-5">
                    <p className="font-semibold text-rose-900">{summary.label}</p>

                    {/* What we said is quoted, on its own, so it cannot run
                        into our own sentence and read as one broken line. A
                        reason can be a single word, and "no" followed by
                        "Change what you need to" looked like a mistake. */}
                    {reviewNote ? (
                        <blockquote className="mt-3 rounded-r-lg border-l-4 border-rose-400 bg-white/70 px-4 py-3">
                            <p className="text-sm text-rose-900 whitespace-pre-line">{reviewNote}</p>
                        </blockquote>
                    ) : (
                        <p className="text-sm text-rose-900/80 mt-3">
                            We could not approve this as it stands.
                        </p>
                    )}

                    <p className="text-sm text-rose-900/80 mt-3">
                        Change what you need to and send it again.
                    </p>
                </div>
            )}

            {status === 'approved' && (
                <div className="mb-8 rounded-2xl border border-emerald-300 bg-emerald-50 p-5">
                    <p className="font-semibold text-emerald-900">{summary.label}</p>
                    <p className="text-sm text-emerald-900/80 mt-1">{summary.detail}</p>
                </div>
            )}

            <fieldset disabled={locked} className={locked ? 'opacity-70' : ''}>
                <section className="mb-8">
                    <label className="block text-sm font-semibold text-slate-900 mb-1.5">Business name</label>
                    <input
                        value={businessName}
                        onChange={(e) => setBusinessName(e.target.value)}
                        placeholder="Solway Sparkle"
                        className="w-full rounded-xl border border-slate-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                    {problemFor('business_name') && (
                        <p className="text-sm text-rose-700 mt-1.5">{problemFor('business_name')!.message}</p>
                    )}
                </section>

                <section className="mb-8">
                    <h2 className="text-sm font-semibold text-slate-900 mb-1.5">What do you do?</h2>
                    <p className="text-sm text-slate-500 mb-3">This decides how you are priced and who finds you.</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {tradesFor('host').map((t) => {
                            const Icon = TRADE_ICONS[t.key] || Sparkles;
                            const on = trade === t.key;
                            return (
                                <button
                                    key={t.key}
                                    type="button"
                                    onClick={() => setTrade(t.key)}
                                    aria-pressed={on}
                                    className={`rounded-xl border p-3 text-left transition ${
                                        on ? 'border-emerald-700 ring-2 ring-emerald-700 bg-emerald-50' : 'border-slate-300 hover:border-slate-400'
                                    }`}
                                >
                                    <Icon className="w-6 h-6 text-emerald-700 mb-2" strokeWidth={1.5} />
                                    <span className="block text-sm font-medium text-slate-900">{t.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </section>

                {/* What they charge. Driven by the trade rather than by a
                    choice, so two cleaners are always comparable and a host is
                    never asked to weigh a price against a rate. */}
                {model === 'bands' && (
                    <section className="mb-8">
                        <h2 className="text-sm font-semibold text-slate-900 mb-1.5">Your prices</h2>
                        <p className="text-sm text-slate-500 mb-1">
                            {trade === 'trees'
                                ? 'We set the sizes so owners can compare like for like. Bedrooms tell you nothing about a garden, so gardening goes by the plot.'
                                : 'We set the sizes so owners can compare like for like. They come from the property, so the owner types nothing.'}
                        </p>
                        <p className="text-sm text-slate-500 mb-4">
                            <strong className="font-semibold text-slate-700">Leave blank any size you do not cover.</strong>{' '}
                            A blank keeps you out of results for it, rather than showing an empty price.
                        </p>

                        <div className="space-y-3">
                            {bands.map((band) => {
                                const entry = prices[band.key] || { price: '', typical_hours: '' };
                                const priceProblem = problemFor('price_' + band.key);
                                const hoursProblem = problemFor('hours_' + band.key);

                                return (
                                    <div key={band.key} className="rounded-xl border border-slate-300 p-3.5">
                                        <div className="text-sm font-medium text-slate-900 mb-2.5">{band.label}</div>

                                        <div className="grid sm:grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-xs font-semibold text-slate-500 mb-1">Price per visit</label>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-slate-500">&pound;</span>
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        value={entry.price}
                                                        onChange={(e) => setBand(band.key, 'price', e.target.value)}
                                                        placeholder="Leave blank if you do not cover this"
                                                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                                                    />
                                                </div>
                                                {priceProblem && (
                                                    <p className="text-xs text-rose-700 mt-1">{priceProblem.message}</p>
                                                )}
                                            </div>

                                            <div>
                                                <label className="block text-xs font-semibold text-slate-500 mb-1">
                                                    Usually takes <span className="font-normal">(optional)</span>
                                                </label>
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        value={entry.typical_hours}
                                                        onChange={(e) => setBand(band.key, 'typical_hours', e.target.value)}
                                                        placeholder="2"
                                                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                                                    />
                                                    <span className="text-sm text-slate-500 whitespace-nowrap">hours</span>
                                                </div>
                                                {hoursProblem && (
                                                    <p className="text-xs text-rose-700 mt-1">{hoursProblem.message}</p>
                                                )}
                                            </div>
                                        </div>

                                        {entry.price && Number(entry.price) > 0 && (
                                            <p className="text-xs text-slate-500 mt-2.5">
                                                Shows as &ldquo;&pound;{entry.price} per visit
                                                {entry.typical_hours && Number(entry.typical_hours) > 0
                                                    ? ', usually about ' + entry.typical_hours + ' hours'
                                                    : ''}
                                                &rdquo;
                                            </p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {problemFor('prices') && (
                            <p className="text-sm text-rose-700 mt-2">{problemFor('prices')!.message}</p>
                        )}

                        {/* Said here, at the point they type it, rather than
                            left to be found in terms afterwards. */}
                        <div className="mt-4 rounded-xl bg-slate-50 border border-slate-200 p-4 text-sm text-slate-700 space-y-2">
                            <p>
                                <strong className="font-semibold text-slate-900">Your price is the most you can charge.</strong>{' '}
                                You can charge less on the day &mdash; never more. Our 10% comes off this figure.
                            </p>
                            <p>
                                The hours are a guide for the owner, not what you are paid. You are paid the
                                price for the size, whether it takes you two hours or four.
                            </p>
                        </div>
                    </section>
                )}

                {model === 'callout_hourly' && (
                    <section className="mb-8">
                        <h2 className="text-sm font-semibold text-slate-900 mb-1.5">Your rates</h2>
                        <p className="text-sm text-slate-500 mb-4">
                            A repair cannot be sized in advance, so maintenance is a call-out fee and then an
                            hourly rate &mdash; not a price per property size.
                        </p>

                        <div className="grid sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 mb-1">Call-out fee</label>
                                <div className="flex items-center gap-2">
                                    <span className="text-slate-500">&pound;</span>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={calloutFee}
                                        onChange={(e) => setCalloutFee(e.target.value)}
                                        placeholder="45"
                                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                                    />
                                </div>
                                {problemFor('callout_fee') && (
                                    <p className="text-xs text-rose-700 mt-1">{problemFor('callout_fee')!.message}</p>
                                )}
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-slate-500 mb-1">Hourly rate after that</label>
                                <div className="flex items-center gap-2">
                                    <span className="text-slate-500">&pound;</span>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={hourlyRate}
                                        onChange={(e) => setHourlyRate(e.target.value)}
                                        placeholder="30"
                                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                                    />
                                </div>
                                {problemFor('hourly_rate') && (
                                    <p className="text-xs text-rose-700 mt-1">{problemFor('hourly_rate')!.message}</p>
                                )}
                            </div>
                        </div>
                    </section>
                )}

                {/* Extras. Three types, and they behave differently
                    where it matters: a toggle is comparison, a priced one is
                    part of the ceiling, and a reimbursed one is money that
                    never comes near us. */}
                {tradeExtras.length > 0 && (
                    <section className="mb-8">
                        <h2 className="text-sm font-semibold text-slate-900 mb-1.5">What else do you offer?</h2>
                        <p className="text-sm text-slate-500 mb-4">
                            All optional. Owners compare on these, so it is worth saying yes to what you
                            actually do.
                        </p>

                        {extrasIn('about').length > 0 && (
                            <div className="space-y-2 mb-6">
                                {extrasIn('about').map((extra) => (
                                    <label
                                        key={extra.key}
                                        className="flex items-start gap-3 rounded-xl border border-slate-300 p-3.5 cursor-pointer hover:border-slate-400 transition"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={extraOf(extra.key).offered}
                                            onChange={(e) => setExtra(extra.key, 'offered', e.target.checked)}
                                            className="mt-0.5 w-4 h-4 rounded border-slate-300 shrink-0"
                                        />
                                        <span>
                                            <span className="block text-sm font-medium text-slate-900">{extra.label}</span>
                                            {extra.hint && (
                                                <span className="block text-sm text-slate-500 mt-0.5">{extra.hint}</span>
                                            )}
                                        </span>
                                    </label>
                                ))}
                            </div>
                        )}

                        {extrasIn('laundry').length > 0 && (
                            <div className="mb-6">
                                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                                    Laundry
                                </h3>

                                <div className="rounded-xl border border-slate-300 p-3.5">
                                    <p className="text-sm font-medium text-slate-900 mb-2.5">
                                        {groupGate('laundry')}
                                    </p>

                                    <div className="flex gap-2">
                                        {[true, false].map((yes) => (
                                            <button
                                                key={String(yes)}
                                                type="button"
                                                onClick={() => {
                                                    setLaundryOpen(yes);
                                                    // Saying no clears the rates, so the
                                                    // answer and the boxes cannot disagree.
                                                    if (!yes) {
                                                        for (const e of extrasIn('laundry')) setExtra(e.key, 'price', '');
                                                    }
                                                }}
                                                aria-pressed={laundryOpen === yes}
                                                className={`rounded-full border px-5 py-2 text-sm font-semibold transition ${
                                                    laundryOpen === yes
                                                        ? 'border-emerald-700 bg-emerald-700 text-white'
                                                        : 'border-slate-300 text-slate-700 hover:border-slate-500'
                                                }`}
                                            >
                                                {yes ? 'Yes' : 'No'}
                                            </button>
                                        ))}
                                    </div>

                                    {laundryOpen === true && (
                                        <div className="mt-4">
                                            <p className="text-sm text-slate-500 mb-3">
                                                A rate per bed. Leave blank any size you do not do.
                                            </p>

                                            <div className="grid sm:grid-cols-3 gap-3">
                                                {extrasIn('laundry').map((extra) => {
                                                    const entry = extraOf(extra.key);
                                                    const problem = problemFor('extra_price_' + extra.key);

                                                    return (
                                                        <div key={extra.key}>
                                                            <label className="block text-xs font-semibold text-slate-500 mb-1">
                                                                {extra.label}
                                                            </label>
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-slate-500">&pound;</span>
                                                                <input
                                                                    type="text"
                                                                    inputMode="decimal"
                                                                    value={entry.price}
                                                                    onChange={(e) => setExtra(extra.key, 'price', e.target.value)}
                                                                    placeholder="8"
                                                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                                                                />
                                                            </div>
                                                            {problem && (
                                                                <p className="text-xs text-rose-700 mt-1">{problem.message}</p>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            <p className="text-xs text-slate-500 mt-2.5">
                                                The owner says how many of each when they ask, so these are rates
                                                rather than totals.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {extrasIn('priced').length > 0 && (
                            <div className="mb-6">
                                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                                    Charged on top
                                </h3>
                                <div className="space-y-2">
                                    {extrasIn('priced').map((extra) => {
                                        const entry = extraOf(extra.key);
                                        const problem = problemFor('extra_price_' + extra.key);

                                        return (
                                            <div key={extra.key} className="rounded-xl border border-slate-300 p-3.5">
                                                <div className="text-sm font-medium text-slate-900">{extra.label}</div>
                                                {extra.hint && (
                                                    <div className="text-sm text-slate-500 mt-0.5">{extra.hint}</div>
                                                )}

                                                <div className="mt-2.5 flex items-center gap-2 max-w-xs">
                                                    <span className="text-slate-500">&pound;</span>
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        value={entry.price}
                                                        onChange={(e) => setExtra(extra.key, 'price', e.target.value)}
                                                        placeholder="Leave blank if you do not offer it"
                                                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                                                    />
                                                    {extra.unit === 'each' && (
                                                        <span className="text-sm text-slate-500 whitespace-nowrap">each</span>
                                                    )}
                                                </div>
                                                {problem && (
                                                    <p className="text-xs text-rose-700 mt-1">{problem.message}</p>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                                <p className="text-xs text-slate-500 mt-2">
                                    These are added to the price for the size, and the total is the most you can
                                    charge. Our 10% comes off that total.
                                </p>
                            </div>
                        )}

                        {extrasIn('reimbursed').length > 0 && (
                            <div>
                                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                                    Bought for the owner and paid back
                                </h3>

                                <div className="space-y-2">
                                    {extrasIn('reimbursed').map((extra) => {
                                        const entry = extraOf(extra.key);

                                        return (
                                            <div key={extra.key} className="rounded-xl border border-slate-300 p-3.5">
                                                <label className="flex items-start gap-3 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={entry.offered}
                                                        onChange={(e) => setExtra(extra.key, 'offered', e.target.checked)}
                                                        className="mt-0.5 w-4 h-4 rounded border-slate-300 shrink-0"
                                                    />
                                                    <span>
                                                        <span className="block text-sm font-medium text-slate-900">{extra.label}</span>
                                                        {extra.hint && (
                                                            <span className="block text-sm text-slate-500 mt-0.5">{extra.hint}</span>
                                                        )}
                                                    </span>
                                                </label>

                                                {entry.offered && extra.type === 'reimbursed' && (
                                                    <div className="mt-3 pl-7">
                                                        <input
                                                            type="text"
                                                            value={entry.notes}
                                                            onChange={(e) => setExtra(extra.key, 'notes', e.target.value)}
                                                            placeholder="Anything the owner should know — where you shop, what you usually get."
                                                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="mt-3 rounded-xl bg-slate-50 border border-slate-200 p-4 text-sm text-slate-700">
                                    <p>
                                        <strong className="font-semibold text-slate-900">You are paid back for these by the owner, directly.</strong>{' '}
                                        Send them the receipt and they settle it with you. It does not go through
                                        us, there is no commission on it, and it is not part of your quoted price
                                        &mdash; there is no figure for it until you have bought it.
                                    </p>
                                </div>
                            </div>
                        )}
                    </section>
                )}

                {!canBeRequested(trade) && (
                    <section className="mb-8">
                        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
                            <p className="font-semibold text-amber-900">
                                Maintenance jobs cannot be booked through the site yet
                            </p>
                            <p className="text-sm text-amber-900/80 mt-1">
                                Because the price depends on how long the work takes, we cannot settle it until
                                somebody confirms the job is finished &mdash; and that part is not built. Sign up
                                now and we will approve you; owners will be able to request work as soon as it is
                                ready, and we will email you when it is.
                            </p>
                        </div>
                    </section>
                )}

                {model === 'quoted' && (
                    <section className="mb-8">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                            <p className="font-semibold text-slate-900">You price each job when you are asked</p>
                            <p className="text-sm text-slate-600 mt-1">
                                What people want from you varies more than the property does, so there is nothing
                                to fill in here. You will get the details and reply with a price.
                            </p>
                        </div>
                    </section>
                )}

                <section className="mb-8">
                    <label className="block text-sm font-semibold text-slate-900 mb-1.5">About your business</label>
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={5}
                        placeholder="What you do, how long you have been doing it, anything that makes you the right choice."
                        className="w-full rounded-xl border border-slate-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                    {problemFor('description') && (
                        <p className="text-sm text-rose-700 mt-1.5">{problemFor('description')!.message}</p>
                    )}
                </section>

                <section className="mb-8">
                    <h2 className="text-sm font-semibold text-slate-900 mb-1.5">Where do you cover?</h2>
                    <p className="text-sm text-slate-500 mb-3">
                        A town and how far you will travel from it. Add more than one if you cover separate areas.
                    </p>

                    <div className="space-y-2">
                        {areas.map((a, i) => (
                            <div key={i} className="flex items-center gap-2">
                                <select
                                    value={a.town}
                                    aria-label="Town"
                                    onChange={(e) => setAreas((prev) => prev.map((x, j) => (j === i ? { ...x, town: e.target.value } : x)))}
                                    className="flex-1 min-w-0 rounded-xl border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                                >
                                    {COVERAGE_TOWNS.map((t) => (
                                        <option key={t.key} value={t.label}>{t.label}</option>
                                    ))}
                                </select>
                                <select
                                    value={a.radius_miles}
                                    aria-label="Distance covered"
                                    onChange={(e) => setAreas((prev) => prev.map((x, j) => (j === i ? { ...x, radius_miles: Number(e.target.value) } : x)))}
                                    className="rounded-xl border border-slate-300 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                                >
                                    {[5, 10, 15, 20, 30, 50].map((m) => (
                                        <option key={m} value={m}>within {m} miles</option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    onClick={() => setAreas((prev) => prev.filter((_, j) => j !== i))}
                                    aria-label={'Remove ' + a.town}
                                    className="shrink-0 w-10 h-10 rounded-full border border-slate-300 flex items-center justify-center text-slate-500 hover:border-slate-500"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                    </div>

                    {areas.length < COVERAGE_TOWNS.length && (
                        <button
                            type="button"
                            onClick={addArea}
                            className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:text-emerald-800"
                        >
                            <Plus className="w-4 h-4" /> Add an area
                        </button>
                    )}

                    {problemFor('areas') && (
                        <p className="text-sm text-rose-700 mt-2">{problemFor('areas')!.message}</p>
                    )}
                </section>

                <section className="mb-8">
                    <h2 className="text-sm font-semibold text-slate-900 mb-3">Photos of your work</h2>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                        {photos.map((p) => (
                            <div key={p} className="relative aspect-[4/3] rounded-xl overflow-hidden bg-slate-100">
                                <img src={getImageUrl(p)} alt="" className="w-full h-full object-cover" />
                                <button
                                    type="button"
                                    onClick={() => setPhotos((prev) => prev.filter((x) => x !== p))}
                                    aria-label="Remove photo"
                                    className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-white/90 flex items-center justify-center"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        ))}
                    </div>
                    <label className="inline-flex items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-3 cursor-pointer text-sm text-slate-600 hover:border-slate-400">
                        <Plus className="w-4 h-4" />
                        {processingPhotos ? 'Preparing your photos…' : 'Add photos'}
                        <input type="file" accept="image/png, image/jpeg" multiple onChange={addPhotos} className="hidden" disabled={processingPhotos} />
                    </label>
                </section>

                <section className="mb-8 grid sm:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-1.5">Email for job requests</label>
                        <input
                            value={contactEmail}
                            onChange={(e) => setContactEmail(e.target.value)}
                            className="w-full rounded-xl border border-slate-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                        />
                        {problemFor('contact_email') && (
                            <p className="text-sm text-rose-700 mt-1.5">{problemFor('contact_email')!.message}</p>
                        )}
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-1.5">
                            Phone <span className="font-normal text-slate-500">(optional)</span>
                        </label>
                        <input
                            value={contactPhone}
                            onChange={(e) => setContactPhone(e.target.value)}
                            className="w-full rounded-xl border border-slate-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                        />
                    </div>
                </section>
            </fieldset>

            {!locked && (
                <div className="border-t border-slate-200 pt-6">
                    {/* A live business is not re-applying. One button, and it
                        says what it does — and the consequence is stated
                        before they press it rather than discovered after. */}
                    {status === 'approved' ? (
                        <>
                            <p className="text-sm text-slate-600 mb-4">
                                You will stay live while we look. Changing your{' '}
                                <strong className="font-semibold text-slate-800">
                                    business name, category, description, photos, or who you sell to
                                </strong>{' '}
                                means we check it again and email you — your listing stays up the whole
                                time. Contact details and the areas you cover change straight away, with
                                nothing to wait for.
                            </p>
                            <button
                                type="button"
                                onClick={() => save(true)}
                                disabled={saving}
                                className="rounded-full bg-emerald-700 hover:bg-emerald-800 text-white px-7 py-3 font-semibold transition disabled:opacity-60"
                            >
                                {saving ? 'Saving…' : 'Save changes'}
                            </button>
                        </>
                    ) : (
                        <div className="flex flex-wrap items-center gap-3">
                            <button
                                type="button"
                                onClick={() => save(true)}
                                disabled={saving}
                                className="rounded-full bg-emerald-700 hover:bg-emerald-800 text-white px-7 py-3 font-semibold transition disabled:opacity-60"
                            >
                                {saving ? 'Sending…' : 'Send for review'}
                            </button>
                            <button
                                type="button"
                                onClick={() => save(false)}
                                disabled={saving}
                                className="rounded-full border border-slate-300 px-6 py-3 font-semibold text-slate-700 hover:border-slate-500 transition disabled:opacity-60"
                            >
                                Save and finish later
                            </button>
                            <p className="text-sm text-slate-500 flex items-center gap-1.5">
                                <Check className="w-4 h-4 text-emerald-700" />
                                Free for {TRIAL_DAYS} days
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
