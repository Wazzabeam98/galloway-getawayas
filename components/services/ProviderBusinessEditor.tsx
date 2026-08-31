'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { compressImage } from '@/lib/compressImage';
import { generateRandomNumber, getImageUrl } from '@/lib/utils';
import { schemeLabel } from '@/lib/serviceProviders';
import Env from '@/config/Env';
import { Check, Plus, X, ShieldCheck, ShieldAlert, Loader2 } from 'lucide-react';

// One place to change everything a host sees about a business: the name and
// blurb, the rates, the area covered, the photos, the registrations. It
// replaces the old handful of links back into the sign-up wizard.
//
// Writes go straight from the browser under the owner's own row-level policies
// (owners manage their own provider, their own areas, their own registration
// numbers) — the same path the sign-up wizard already uses. The one thing a
// provider cannot do here is mark their own registration verified: changing a
// number un-verifies it until an admin checks it again, which is exactly the
// intent of the column grants.

type Area = { id: string; label: string; radius_miles: number };
type Registration = { scheme: string; number: string; verified: boolean };
type Provider = {
    id: string;
    business_name: string;
    description: string;
    hourly_rate: number | null;
    callout_fee: number | null;
    photos: string[];
};

const card = 'rounded-2xl border border-slate-200 bg-white p-4 sm:p-5';
const heading = 'font-bold text-slate-900';
const labelCls = 'block text-sm font-semibold text-slate-700 mb-1';
const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600';

function numOrNull(v: string): number | null {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t);
    return isNaN(n) ? null : n;
}

export default function ProviderBusinessEditor({
    provider, skills: initialSkills, areas: initialAreas, registrations: initialRegs,
}: { provider: Provider; skills: string[]; areas: Area[]; registrations: Registration[] }) {
    const supabase = createClientComponentClient();
    const router = useRouter();

    const [name, setName] = useState(provider.business_name);
    const [description, setDescription] = useState(provider.description);
    const [hourly, setHourly] = useState(provider.hourly_rate == null ? '' : String(provider.hourly_rate));
    const [callout, setCallout] = useState(provider.callout_fee == null ? '' : String(provider.callout_fee));
    const [skills, setSkills] = useState<string[]>(initialSkills);
    const [newSkill, setNewSkill] = useState('');
    const [areas, setAreas] = useState<Area[]>(initialAreas);
    const [photos, setPhotos] = useState<string[]>(provider.photos);
    const [regs, setRegs] = useState<Registration[]>(initialRegs);

    function addSkill() {
        const t = newSkill.trim();
        if (!t) return;
        // Case-insensitive de-dupe for the type-ahead; the server normalises
        // properly (slug/compact) when it reconciles the set.
        if (!skills.some((s) => s.toLowerCase() === t.toLowerCase())) {
            setSkills([...skills, t].slice(0, 20));
        }
        setNewSkill('');
    }

    const [savingDetails, setSavingDetails] = useState(false);
    const [detailsSaved, setDetailsSaved] = useState(false);
    const [error, setError] = useState('');
    const [uploading, setUploading] = useState(false);
    const [savingReg, setSavingReg] = useState<string | null>(null);

    async function saveDetails() {
        setSavingDetails(true); setDetailsSaved(false); setError('');
        try {
            const { error: pErr } = await supabase
                .from('service_providers')
                .update({
                    business_name: name.trim(),
                    description: description,
                    hourly_rate: numOrNull(hourly),
                    callout_fee: numOrNull(callout),
                })
                .eq('id', provider.id);
            if (pErr) throw pErr;

            for (const a of areas) {
                const { error: aErr } = await supabase
                    .from('service_areas')
                    .update({ label: a.label.trim(), radius_miles: a.radius_miles })
                    .eq('id', a.id);
                if (aErr) throw aErr;
            }

            // Skills go through the reconcile route, not a direct write: the
            // regulated concept (what stops a handyman tagging "boiler repair")
            // is derived there under the service role. The whole set is sent.
            const skillRes = await fetch('/api/services/skills', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ providerId: provider.id, labels: skills }),
            });
            if (!skillRes.ok) {
                const d = await skillRes.json().catch(() => ({}));
                throw new Error(d.error || 'Could not save your skills.');
            }

            setDetailsSaved(true);
            router.refresh();
        } catch (e: any) {
            setError(e?.message || 'Could not save those changes.');
        } finally {
            setSavingDetails(false);
        }
    }

    async function persistPhotos(next: string[]) {
        const { error: e } = await supabase.from('service_providers').update({ photos: next }).eq('id', provider.id);
        if (e) { setError(e.message); return false; }
        setPhotos(next);
        router.refresh();
        return true;
    }

    async function addPhotos(files: FileList | null) {
        if (!files || !files.length) return;
        setUploading(true); setError('');
        const added: string[] = [];
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) { setError('Signed out — sign in again.'); return; }
            for (const file of Array.from(files)) {
                const ready = await compressImage(file);
                const path = 'providers/' + user.id + '-' + Date.now() + '_' + generateRandomNumber() + '.jpg';
                const { error: upErr } = await supabase.storage.from(Env.S3_BUCKET).upload(path, ready, { contentType: 'image/jpeg' });
                if (upErr) { setError(upErr.message); continue; }
                added.push(path);
            }
            if (added.length) await persistPhotos([...photos, ...added]);
        } catch {
            setError('A photo could not be read. Try a different one.');
        } finally {
            setUploading(false);
        }
    }

    async function removePhoto(path: string) {
        await persistPhotos(photos.filter((p) => p !== path));
    }

    async function saveRegNumber(scheme: string, number: string) {
        setSavingReg(scheme); setError('');
        try {
            const { error: e } = await supabase
                .from('service_provider_registrations')
                .update({ number: number.trim() })
                .eq('provider_id', provider.id)
                .eq('scheme', scheme);
            if (e) throw e;
            router.refresh();
        } catch (e: any) {
            setError(e?.message || 'Could not update that number.');
        } finally {
            setSavingReg(null);
        }
    }

    return (
        <div className="mt-6 flex flex-col gap-4">
            {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
            )}

            {/* Business */}
            <section className={card}>
                <h2 className={heading}>Business</h2>
                <div className="mt-3">
                    <label className={labelCls} htmlFor="biz-name">Business name</label>
                    <input id="biz-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="mt-3">
                    <label className={labelCls} htmlFor="biz-desc">What you do</label>
                    <textarea id="biz-desc" className={`${inputCls} min-h-[96px]`} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A line or two hosts will read when deciding who to ask." />
                </div>
            </section>

            {/* Rates & call-out */}
            <section className={card}>
                <h2 className={heading}>Rates &amp; call-out</h2>
                <p className="text-[13px] text-slate-500 mt-0.5">What you charge. Leave blank to quote per job.</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                        <label className={labelCls} htmlFor="rate">Hourly rate (£)</label>
                        <input id="rate" inputMode="decimal" className={inputCls} value={hourly} onChange={(e) => setHourly(e.target.value)} placeholder="e.g. 55" />
                    </div>
                    <div>
                        <label className={labelCls} htmlFor="callout">Call-out fee (£)</label>
                        <input id="callout" inputMode="decimal" className={inputCls} value={callout} onChange={(e) => setCallout(e.target.value)} placeholder="e.g. 40" />
                    </div>
                </div>
            </section>

            {/* Coverage */}
            <section className={card}>
                <h2 className={heading}>Coverage area</h2>
                <p className="text-[13px] text-slate-500 mt-0.5">How far you&rsquo;ll travel, and what it&rsquo;s called.</p>
                {areas.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-500">No area set yet.</p>
                ) : areas.map((a, i) => (
                    <div key={a.id} className="mt-3 grid grid-cols-[1fr_auto] gap-3 items-end">
                        <div>
                            <label className={labelCls}>Area name</label>
                            <input className={inputCls} value={a.label} onChange={(e) => setAreas(areas.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder="e.g. Kirkcudbright" />
                        </div>
                        <div>
                            <label className={labelCls}>Radius (mi)</label>
                            <input inputMode="numeric" className={`${inputCls} w-24`} value={String(a.radius_miles)} onChange={(e) => setAreas(areas.map((x, j) => j === i ? { ...x, radius_miles: Number(e.target.value) || 0 } : x))} />
                        </div>
                    </div>
                ))}
            </section>

            {/* Services & skills */}
            <section className={card}>
                <h2 className={heading}>Services &amp; skills</h2>
                <p className="text-[13px] text-slate-500 mt-0.5">The work you take on. Hosts search on these, so name them the way a host would.</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                    {skills.length === 0 && <span className="text-sm text-slate-400">None added yet.</span>}
                    {skills.map((sk) => (
                        <span key={sk} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-full pl-3 pr-1.5 py-1">
                            {sk}
                            <button onClick={() => setSkills(skills.filter((x) => x !== sk))} aria-label={`Remove ${sk}`} className="w-4 h-4 rounded-full bg-emerald-200/70 text-emerald-800 flex items-center justify-center hover:bg-emerald-300">
                                <X className="w-3 h-3" strokeWidth={2.5} />
                            </button>
                        </span>
                    ))}
                </div>
                {skills.length < 20 && (
                    <div className="mt-3 flex items-center gap-2">
                        <input
                            className={inputCls}
                            value={newSkill}
                            onChange={(e) => setNewSkill(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }}
                            placeholder="e.g. Boiler servicing, bathroom fitting, leak repair"
                        />
                        <button onClick={addSkill} className="flex-none inline-flex items-center gap-1 text-[13px] font-bold text-slate-800 bg-white border border-slate-300 rounded-lg px-3 py-2 hover:bg-slate-50">
                            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} /> Add
                        </button>
                    </div>
                )}
                <p className="mt-2 text-[12px] text-slate-400">Regulated work (gas, oil, electrical) only shows to hosts once your matching registration is verified.</p>
            </section>

            {/* One save for the fields above, skills included */}
            <div className="flex items-center gap-3">
                <button onClick={saveDetails} disabled={savingDetails} className="inline-flex items-center gap-2 font-bold text-sm text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-xl px-5 py-2.5">
                    {savingDetails ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" strokeWidth={2.5} />}
                    Save details
                </button>
                {detailsSaved && <span className="text-sm font-semibold text-emerald-700">Saved.</span>}
            </div>

            {/* Photos */}
            <section className={card}>
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className={heading}>Photos</h2>
                        <p className="text-[13px] text-slate-500 mt-0.5">Your work, or your van and team. Hosts see these first.</p>
                    </div>
                    <label className="inline-flex items-center gap-1.5 text-[13px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5 cursor-pointer hover:bg-emerald-100">
                        {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />}
                        Add
                        <input type="file" accept="image/*" multiple className="hidden" disabled={uploading} onChange={(e) => addPhotos(e.target.files)} />
                    </label>
                </div>
                {photos.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-500">No photos yet.</p>
                ) : (
                    <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {photos.map((p) => (
                            <div key={p} className="relative group aspect-square rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                                <img src={getImageUrl(p)} alt="" className="w-full h-full object-cover" />
                                <button onClick={() => removePhoto(p)} aria-label="Remove photo" className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/55 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                                    <X className="w-3.5 h-3.5" strokeWidth={2.5} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* Registrations */}
            <section className={card}>
                <h2 className={heading}>Registrations</h2>
                <p className="text-[13px] text-slate-500 mt-0.5">Your trade registrations. Changing a number sends it back to us to re-check before the badge shows again.</p>
                {regs.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-500">None on file.</p>
                ) : regs.map((r) => (
                    <div key={r.scheme} className="mt-3 border-t border-slate-100 pt-3 first:border-t-0 first:pt-0">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-semibold text-slate-800">{schemeLabel(r.scheme)}</span>
                            {r.verified ? (
                                <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700"><ShieldCheck className="w-3.5 h-3.5" /> Verified</span>
                            ) : (
                                <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-amber-700"><ShieldAlert className="w-3.5 h-3.5" /> Awaiting check</span>
                            )}
                        </div>
                        <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
                            <input className={inputCls} value={r.number} onChange={(e) => setRegs(regs.map((x) => x.scheme === r.scheme ? { ...x, number: e.target.value } : x))} />
                            <button onClick={() => saveRegNumber(r.scheme, r.number)} disabled={savingReg === r.scheme} className="text-[13px] font-bold text-slate-800 bg-white border border-slate-300 rounded-lg px-3 py-2 hover:bg-slate-50 disabled:opacity-60">
                                {savingReg === r.scheme ? 'Saving…' : 'Update'}
                            </button>
                        </div>
                    </div>
                ))}
            </section>
        </div>
    );
}
