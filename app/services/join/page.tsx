'use client';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { toast } from 'react-toastify';
import { Sparkles, Wrench, Trees, Droplet, ChefHat, Cake, ShoppingBasket, PawPrint, Check, Plus, X } from 'lucide-react';
import { compressImage } from '@/lib/compressImage';
import { getImageUrl, generateRandomNumber } from '@/lib/utils';
import Env from '@/config/Env';
import LoginModel from '@/components/auth/LoginModel';
import {
    TRADES,
    AUDIENCES,
    COVERAGE_TOWNS,
    townByKey,
    submitProblems,
    statusSummary,
    trialEndsAt,
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
    const [audience, setAudience] = useState('host');
    const [photos, setPhotos] = useState<string[]>([]);
    const [areas, setAreas] = useState<AreaRow[]>([]);

    const [saving, setSaving] = useState(false);
    const [processingPhotos, setProcessingPhotos] = useState(false);
    const [touchedSubmit, setTouchedSubmit] = useState(false);

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
                .select('id, business_name, trade, description, contact_email, contact_phone, audience, photos, status, review_note')
                .eq('owner_id', session.user.id)
                .maybeSingle();

            if (existing) {
                setProviderId(existing.id);
                setBusinessName(existing.business_name || '');
                setTrade(existing.trade || 'sponge');
                setDescription(existing.description || '');
                setContactEmail(existing.contact_email || session.user.email || '');
                setContactPhone(existing.contact_phone || '');
                setAudience(existing.audience || 'host');
                setPhotos(existing.photos || []);
                setStatus(existing.status || 'draft');
                setReviewNote(existing.review_note || null);

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
        audience,
        areaCount: areas.length,
    });

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
            audience,
            photos,
            updated_at: now.toISOString(),
        };

        if (submit) {
            payload.status = 'pending_review';
            payload.submitted_at = now.toISOString();
            payload.review_note = null;
            // Set once, when they first apply, so the trial is measured from
            // the day they joined rather than the day we got round to them.
            if (!providerId || status === 'draft') payload.trial_ends_at = trialEndsAt(now);
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

        setSaving(false);

        if (submit) {
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
                <h1 className="text-2xl font-bold text-slate-900 mb-2">List your business</h1>
                <p className="text-slate-600 mb-6">Sign in to get started — it takes a few minutes.</p>
                <LoginModel />
            </div>
        );
    }

    const summary = statusSummary(status);
    const locked = status === 'pending_review';

    return (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 pb-24">
            <h1 className="text-3xl font-bold text-slate-900">List your business</h1>
            <p className="text-slate-600 mt-2 mb-8">
                Cleaners, gardeners, chefs, bakers and trades across Dumfries &amp; Galloway.
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
                    <p className="text-sm text-slate-500 mb-3">This picks the icon people see.</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {TRADES.map((t) => {
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
                    <h2 className="text-sm font-semibold text-slate-900 mb-3">Who do you sell to?</h2>
                    <div className="space-y-2">
                        {AUDIENCES.map((a) => (
                            <button
                                key={a.key}
                                type="button"
                                onClick={() => setAudience(a.key)}
                                aria-pressed={audience === a.key}
                                className={`w-full rounded-xl border p-4 text-left transition ${
                                    audience === a.key ? 'border-emerald-700 ring-2 ring-emerald-700 bg-emerald-50' : 'border-slate-300 hover:border-slate-400'
                                }`}
                            >
                                <span className="block font-medium text-slate-900">{a.label}</span>
                                <span className="block text-sm text-slate-600 mt-0.5">{a.hint}</span>
                            </button>
                        ))}
                    </div>
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
                <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-6">
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
    );
}
