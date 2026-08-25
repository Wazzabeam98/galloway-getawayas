'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { toast } from 'react-toastify';
import { Sparkles, Wrench, Trees, Droplet, ChefHat, Cake, ShoppingBasket, PawPrint, Trash2, Check, Plus, X } from 'lucide-react';
import { compressImage } from '@/lib/compressImage';
import { getImageUrl, generateRandomNumber } from '@/lib/utils';
import Env from '@/config/Env';
import LoginModel from '@/components/auth/LoginModel';
import {
    tradeLabel,
    HOST_TRADES,
    audienceForTrade,
    extrasFor,
    extrasProblems,
    imageryFor,
    initialsFor,
    showsTimeGuide,
    groupIsOffered,
    groupGate,
    EXTRA_GROUPS,
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

function ApplicationForm() {
    const router = useRouter();
    const params = useSearchParams();

    // Chosen on step one and carried in the URL, so signing in halfway does
    // not lose it. A saved record wins once it loads — except when they have
    // just come back through "change", where the new pick is the point.
    const tradeFromUrl = String(params.get('trade') || '');
    const supabase = createClientComponentClient();

    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<any>(null);

    const [providerId, setProviderId] = useState<string | null>(null);
    const [status, setStatus] = useState('draft');
    const [reviewNote, setReviewNote] = useState<string | null>(null);

    const [businessName, setBusinessName] = useState('');
    const [trade, setTrade] = useState(tradeFromUrl || 'sponge');
    const [description, setDescription] = useState('');
    const [contactEmail, setContactEmail] = useState('');
    const [contactPhone, setContactPhone] = useState('');
    const [photos, setPhotos] = useState<string[]>([]);
    const [logo, setLogo] = useState<string | null>(null);
    const [uploadingLogo, setUploadingLogo] = useState(false);
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
    const [gateOpen, setGateOpen] = useState<Record<string, boolean | null>>({});
    // Which bands have the optional time guide showing. Open where one is
    // already set, so a returning provider sees what they typed.
    const [hoursOpen, setHoursOpen] = useState<Record<string, boolean>>({});
    const [calloutFee, setCalloutFee] = useState('');
    const [hourlyRate, setHourlyRate] = useState('');

    useEffect(() => {
        if (!tradeFromUrl && !HOST_TRADES.includes(tradeFromUrl as any)) {
            // No trade in the URL means they have not been through step one.
            router.replace('/services/join');
        }
    }, [tradeFromUrl, router]);

    useEffect(() => {
        const load = async () => {
            // Anything in here that throws used to leave the page on
            // "Loading…" for good, because setLoading(false) only ran on the
            // way out of the happy path. A truncated auth cookie is enough to
            // do it — the Supabase client throws while it is being built, so
            // not one request is even attempted and the screen never changes.
            try {
                const { data: { session } } = await supabase.auth.getSession();
                setSession(session);

                if (!session) return;

                const { data: existing } = await supabase
                    .from('service_providers')
                    .select('id, business_name, trade, description, contact_email, contact_phone, audience, photos, logo, status, review_note, callout_fee, hourly_rate')
                    .eq('owner_id', session.user.id)
                    // Keyed on the trade as well as the owner. One person can
                    // run a cleaning firm and a window cleaning round, and the
                    // database now allows exactly one business per trade — so
                    // this is the application for the trade they picked, not
                    // "their application".
                    .eq('trade', tradeFromUrl)
                    .maybeSingle();

                if (existing) {
                    setProviderId(existing.id);
                    setBusinessName(existing.business_name || '');
                    setTrade(existing.trade || tradeFromUrl);
                    setDescription(existing.description || '');
                    setContactEmail(existing.contact_email || session.user.email || '');
                    setContactPhone(existing.contact_phone || '');
                    setPhotos(existing.photos || []);
                    setLogo(existing.logo || null);
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
                    const t = existing.trade || 'sponge';
                    setGateOpen({
                        laundry: groupIsOffered('laundry', t, loadedExtras),
                        hot_tub: groupIsOffered('hot_tub', t, loadedExtras),
                    });

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

                    const openHours: Record<string, boolean> = {};
                    for (const key of Object.keys(loaded)) {
                        if (loaded[key].typical_hours) openHours[key] = true;
                    }
                    setHoursOpen(openHours);

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

            } catch (err) {
                // Nothing to show them but the empty form; a stuck spinner is
                // worse than a form that starts blank.
                toast.error('We could not load your details. Try refreshing.', { theme: 'colored' });
            } finally {
                setLoading(false);
            }
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

    const TradeIcon = TRADE_ICONS[trade] || Sparkles;
    const model = pricingModelFor(trade);
    const tradeExtras = extrasFor(trade);
    const extrasIn = (group: string) => tradeExtras.filter((e) => e.group === group);
    // Every group that asks a question before showing its prices. Laundry and
    // hot tubs both do; the mechanism is the group's, not either of theirs.
    const gatedGroups = EXTRA_GROUPS.filter((g: any) => g.gate && extrasIn(g.key).length > 0);

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
    const uploadLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = (e.target.files || [])[0];
        if (!file || !session) return;

        setUploadingLogo(true);

        try {
            const ready = await compressImage(file);
            const path = 'providers/logo-' + session.user.id + '-' + Date.now() + '.jpg';

            const { error } = await supabase.storage
                .from(Env.S3_BUCKET)
                .upload(path, ready, { contentType: 'image/jpeg' });

            if (error) {
                toast.error(error.message, { theme: 'colored' });
            } else {
                setLogo(path);
            }
        } catch (err) {
            toast.error('That image could not be read. Try a different one.', { theme: 'colored' });
        }

        setUploadingLogo(false);
        // So the same file can be chosen again after a failure.
        e.target.value = '';
    };

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
            logo,
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
        <div className="max-w-3xl md:max-w-4xl mx-auto px-4 sm:px-6 py-10 pb-24">
            <h1 className="text-3xl font-bold text-slate-900">Work for holiday lets</h1>
            <p className="text-slate-600 mt-2 mb-8">
                Cleaning, waste, gardening and maintenance for holiday cottages across Dumfries
                &amp; Galloway.
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
                <div className="md:grid md:grid-cols-2 md:gap-8 md:items-start">
                    <section className="mb-8">
                        <label className="block text-sm font-semibold text-slate-900 mb-1.5">Business name</label>
                        <input
                            type="text"
                            value={businessName}
                            onChange={(e) => setBusinessName(e.target.value)}
                            placeholder="Solway Sparkle"
                            className="w-full md:max-w-sm rounded-xl border border-slate-300 px-3.5 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                        />
                        {problemFor('business_name') && (
                            <p className="text-sm text-rose-700 mt-1.5">{problemFor('business_name')!.message}</p>
                        )}
                    </section>

                {imageryFor(trade) === 'logo' ? (
                    <section className="mb-8">
                        <h2 className="text-sm font-semibold text-slate-900 mb-1.5">Your logo</h2>
                        <p className="text-sm text-slate-500 mb-3">
                            Optional. If you have not got one we will show your initials.
                        </p>

                        <div className="flex items-center gap-4">
                            <div className="w-20 h-20 shrink-0 rounded-full overflow-hidden bg-slate-900 text-white flex items-center justify-center text-xl font-semibold">
                                {logo ? (
                                    <img src={getImageUrl(logo)} alt="" className="w-full h-full object-cover" />
                                ) : (
                                    initialsFor(businessName) || <Sparkles className="w-6 h-6" strokeWidth={1.5} />
                                )}
                            </div>

                            <div className="flex flex-wrap gap-2">
                                <label className="inline-flex items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-2.5 cursor-pointer text-sm text-slate-600 hover:border-slate-400">
                                    <Plus className="w-4 h-4" />
                                    {uploadingLogo ? 'Uploading…' : logo ? 'Replace' : 'Add a logo'}
                                    <input
                                        type="file"
                                        accept="image/png, image/jpeg"
                                        onChange={uploadLogo}
                                        className="hidden"
                                        disabled={uploadingLogo}
                                    />
                                </label>

                                {logo && (
                                    <button
                                        type="button"
                                        onClick={() => setLogo(null)}
                                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-600 hover:border-slate-500"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                        Remove
                                    </button>
                                )}
                            </div>
                        </div>
                    </section>
                ) : (
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
                )}
                </div>

                {/* What they picked on the way in, and a way back to it.
                    Somebody will choose wrong, and the fix should not be
                    starting again. */}
                <section className="mb-8">
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                            <TradeIcon className="w-5 h-5 text-emerald-700 shrink-0" strokeWidth={1.5} />
                            <span className="text-sm font-semibold text-slate-900 truncate">{tradeLabel(trade)}</span>
                        </div>
                        <Link
                            href="/services/join"
                            className="text-sm font-semibold text-emerald-700 hover:text-emerald-800 underline shrink-0"
                        >
                            Change
                        </Link>
                    </div>
                </section>

                <section className="mb-8">
                    <label className="block text-sm font-semibold text-slate-900 mb-1.5">About your business</label>
                    {/* Capped to a measure rather than the window: past about
                        70 characters a line is harder to read, not easier. */}
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={5}
                        placeholder="What do you offer? Describe your business."
                        className="w-full md:max-w-xl rounded-xl border border-slate-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                    {problemFor('description') && (
                        <p className="text-sm text-rose-700 mt-1.5">{problemFor('description')!.message}</p>
                    )}
                </section>

                {/* What they charge. Driven by the trade rather than by a
                    choice, so two cleaners are always comparable and a host is
                    never asked to weigh a price against a rate. */}
                {model === 'bands' && (
                    <section className="mb-8">
                        <h2 className="text-sm font-semibold text-slate-900 mb-1.5">Your prices</h2>
                        <p className="text-sm text-slate-500 mb-4">
                            Leave blank any size you do not cover.
                        </p>

                        <div className="space-y-3 md:space-y-0 md:grid md:grid-cols-3 md:gap-4">
                            {bands.map((band) => {
                                const entry = prices[band.key] || { price: '', typical_hours: '' };
                                const priceProblem = problemFor('price_' + band.key);
                                const hoursProblem = problemFor('hours_' + band.key);

                                return (
                                    <div key={band.key} className="rounded-xl border border-slate-300 p-3.5">
                                        <div className="text-sm font-medium text-slate-900 mb-2.5">{band.label}</div>

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

                                            {/* Optional, and the single biggest
                                                thing on the page for the least
                                                it does — so it is a link until
                                                somebody wants it. */}
                                            {!showsTimeGuide(trade) ? null : hoursOpen[band.key] ? (
                                                <div className="mt-2.5">
                                                    <label className="block text-xs font-semibold text-slate-500 mb-1">
                                                        Usually takes
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
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setBand(band.key, 'typical_hours', '');
                                                                setHoursOpen((prev) => ({ ...prev, [band.key]: false }));
                                                            }}
                                                            aria-label="Remove the time guide"
                                                            className="shrink-0 w-8 h-8 rounded-full border border-slate-300 flex items-center justify-center text-slate-500"
                                                        >
                                                            <X className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                    {hoursProblem && (
                                                        <p className="text-xs text-rose-700 mt-1">{hoursProblem.message}</p>
                                                    )}
                                                </div>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => setHoursOpen((prev) => ({ ...prev, [band.key]: true }))}
                                                    className="mt-2 text-xs font-semibold text-emerald-700 hover:text-emerald-800 underline"
                                                >
                                                    Add a time guide
                                                </button>
                                            )}
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

                        {/* Beside the number it governs, not a section away.
                            This is the one a provider will argue about later. */}
                        <p className="text-sm text-slate-600 mt-3">
                            <strong className="font-semibold text-slate-900">Your price is the most you can charge.</strong>
                        </p>

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
                            <div className="space-y-2 md:space-y-0 md:grid md:grid-cols-2 md:gap-3 mb-6">
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

                        <div className="md:grid md:grid-cols-2 md:gap-4 md:items-start">
                        {gatedGroups.map((group: any) => {
                            const open = gateOpen[group.key];
                            const rows = extrasIn(group.key);

                            return (
                                <div key={group.key} className="mb-6">
                                    <div className="rounded-xl border border-slate-300 p-3.5">
                                        <p className="text-sm font-medium text-slate-900 mb-2.5">{group.gate}</p>

                                        <div className="flex gap-2">
                                            {[true, false].map((yes) => (
                                                <button
                                                    key={String(yes)}
                                                    type="button"
                                                    onClick={() => {
                                                        setGateOpen((prev) => ({ ...prev, [group.key]: yes }));
                                                        // Saying no clears the prices, so the
                                                        // answer and the boxes cannot disagree.
                                                        if (!yes) {
                                                            for (const e of rows) setExtra(e.key, 'price', '');
                                                        }
                                                    }}
                                                    aria-pressed={open === yes}
                                                    className={`rounded-full border px-5 py-2 text-sm font-semibold transition ${
                                                        open === yes
                                                            ? 'border-emerald-700 bg-emerald-700 text-white'
                                                            : 'border-slate-300 text-slate-700 hover:border-slate-500'
                                                    }`}
                                                >
                                                    {yes ? 'Yes' : 'No'}
                                                </button>
                                            ))}
                                        </div>

                                        {open === true && (
                                            <div className="mt-4 space-y-2.5">
                                                {rows.map((extra) => {
                                                    const entry = extraOf(extra.key);
                                                    const problem = problemFor('extra_price_' + extra.key);
                                                    const perUnit = extra.unit === 'each';

                                                    return (
                                                        <div key={extra.key}>
                                                            <div className="flex items-center gap-3">
                                                                <label
                                                                    htmlFor={'rate-' + extra.key}
                                                                    className={`shrink-0 text-sm font-medium text-slate-900 ${perUnit ? 'w-16' : ''}`}
                                                                >
                                                                    {extra.label}
                                                                </label>
                                                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                                                    <span className="text-slate-500">&pound;</span>
                                                                    <input
                                                                        id={'rate-' + extra.key}
                                                                        type="text"
                                                                        inputMode="decimal"
                                                                        value={entry.price}
                                                                        onChange={(e) => setExtra(extra.key, 'price', e.target.value)}
                                                                        placeholder={perUnit ? '8' : '25'}
                                                                        className="w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                                                                    />
                                                                    {perUnit && (
                                                                        <span className="text-sm text-slate-500 whitespace-nowrap">per bed</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {problem && (
                                                                <p className="text-xs text-rose-700 mt-1">{problem.message}</p>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        </div>

                        {extrasIn('reimbursed').length > 0 && (
                            <div>
                                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                                    Bought for the owner and paid back
                                </h3>

                                <div className="space-y-2 md:space-y-0 md:grid md:grid-cols-3 md:gap-3">
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

                                <p className="text-sm text-slate-500 mt-2.5">
                                    Paid back by the owner against a receipt. Not through us, and no commission.
                                </p>
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
                                    business name, category, description, logo, or who you sell to
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

export default function JoinApplyPage() {
    // useSearchParams needs a boundary, the same as the query-string reader in
    // the root layout.
    return (
        <Suspense fallback={<div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-slate-500">Loading…</div>}>
            <ApplicationForm />
        </Suspense>
    );
}
