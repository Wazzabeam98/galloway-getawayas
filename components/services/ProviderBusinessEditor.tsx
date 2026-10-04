'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { compressImage } from '@/lib/compressImage';
import { generateRandomNumber, getImageUrl } from '@/lib/utils';
import { schemeLabel, asksAboutFuel, COVERAGE_TOWNS } from '@/lib/serviceProviders';
import { GUEST_REGIONS, GUEST_COVERAGE_ALL_KEY } from '@/lib/strings';
import Env from '@/config/Env';
import {
    Check, Plus, X, ShieldCheck, ShieldAlert, Loader2,
    Briefcase, PoundSterling, MapPin, ListChecks, Tag, Phone, Image as ImageIcon, BadgeCheck,
} from 'lucide-react';

// One place to change everything a host sees about a business — rebuilt on the
// host listing editor's own shape: a left-hand section nav and a card per
// section, each with its own Save, instead of the old single stack of plain
// form cards. It reads like /services/dashboard/listing (the guest editor) and
// like the cottage listing editor, so a trade's editor is in the same family as
// the rest of the platform.
//
// Coverage is the region picker the sign-up uses (round two), not a free-text
// area name and a radius — so the editor and the sign-up finally agree. A region
// is stored as a service_areas row whose label is the region and whose radius is
// 0, exactly the shape the wizard writes.
//
// Writes go straight from the browser under the owner's own row-level policies,
// the same path the sign-up uses. The one thing a provider cannot do here is
// mark their own registration verified: changing a number un-verifies it until
// an admin checks it again.

type Registration = { scheme: string; number: string; verified: boolean };
type Provider = {
    id: string;
    trade: string;
    business_name: string;
    description: string;
    hourly_rate: number | null;
    callout_fee: number | null;
    photos: string[];
    contact_email: string;
    contact_phone: string;
    sms_opt_out: boolean;
    registration_number: string;
};

type ServiceGroup = { label: string; items: Array<{ key: string; label: string; offered: boolean }> };

function numOrNull(v: string): number | null {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t);
    return isNaN(n) ? null : n;
}

const inputCls = 'w-full rounded-xl border border-slate-300 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600';

// One section shell: header, its fields, and its own Save. Mirrors the guest
// listing editor's SectionCard so the two read the same.
function SectionCard({ title, hint, children, onSave, saving, saved }: {
    title: string; hint?: string; children: React.ReactNode; onSave?: () => void; saving?: boolean; saved?: boolean;
}) {
    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
            <h2 className="text-xl font-bold text-slate-900">{title}</h2>
            {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
            <div className="mt-4 space-y-4">{children}</div>
            {onSave && (
                <div className="mt-5 flex items-center gap-3">
                    <button type="button" onClick={onSave} disabled={saving}
                        className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" strokeWidth={2.5} />}
                        Save
                    </button>
                    {saved && <span className="text-sm font-semibold text-emerald-700">Saved.</span>}
                </div>
            )}
        </section>
    );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
            <div className="mt-1">{children}</div>
            {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
        </label>
    );
}

type SectionKey = 'business' | 'rates' | 'coverage' | 'services' | 'skills' | 'contact' | 'photos' | 'registrations';

export default function ProviderBusinessEditor({
    provider, skills: initialSkills, serviceGroups, regions: initialRegions, registrations: initialRegs,
}: { provider: Provider; skills: string[]; serviceGroups: ServiceGroup[]; regions: string[]; registrations: Registration[] }) {
    const supabase = createClientComponentClient();
    const router = useRouter();

    const [active, setActive] = useState<SectionKey>('business');
    const [savingKey, setSavingKey] = useState<SectionKey | null>(null);
    const [savedKey, setSavedKey] = useState<SectionKey | null>(null);
    const [error, setError] = useState('');

    const [name, setName] = useState(provider.business_name);
    const [description, setDescription] = useState(provider.description);
    const [hourly, setHourly] = useState(provider.hourly_rate == null ? '' : String(provider.hourly_rate));
    const [callout, setCallout] = useState(provider.callout_fee == null ? '' : String(provider.callout_fee));
    const [offered, setOffered] = useState<Record<string, boolean>>(() => {
        const o: Record<string, boolean> = {};
        serviceGroups.forEach((g) => g.items.forEach((it) => { o[it.key] = it.offered; }));
        return o;
    });
    const [skills, setSkills] = useState<string[]>(initialSkills);
    const [newSkill, setNewSkill] = useState('');
    const [regions, setRegions] = useState<string[]>(initialRegions);
    const [photos, setPhotos] = useState<string[]>(provider.photos);
    const [regs, setRegs] = useState<Registration[]>(initialRegs);
    const [contactEmail, setContactEmail] = useState(provider.contact_email);
    const [contactPhone, setContactPhone] = useState(provider.contact_phone);
    const [smsOptOut, setSmsOptOut] = useState(provider.sms_opt_out);
    const [registrationNumber, setRegistrationNumber] = useState(provider.registration_number);
    const [uploading, setUploading] = useState(false);
    const [savingReg, setSavingReg] = useState<string | null>(null);

    const asksRegistration = asksAboutFuel(provider.trade) || provider.trade === 'electrician';
    const ALL_REGION_LABEL = GUEST_REGIONS.filter((r) => r.key === GUEST_COVERAGE_ALL_KEY)[0].label;

    function addSkill() {
        const t = newSkill.trim();
        if (!t) return;
        if (!skills.some((s) => s.toLowerCase() === t.toLowerCase())) setSkills([...skills, t].slice(0, 20));
        setNewSkill('');
    }

    // "All of D&G" is exclusive with the individual regions — the same rule the
    // sign-up picker holds.
    function toggleRegion(label: string, isAll: boolean) {
        setRegions((prev) => {
            if (isAll) return prev.includes(label) ? [] : [label];
            const withoutAll = prev.filter((r) => r !== ALL_REGION_LABEL);
            return withoutAll.includes(label) ? withoutAll.filter((r) => r !== label) : [...withoutAll, label];
        });
    }

    // Tell the review queue a live listing changed — business_name, description
    // and photos are the shop window (see the note in the old editor). Not fatal.
    async function announceChange() {
        try {
            await fetch('/api/services/submitted', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: provider.id }),
            });
        } catch { /* the row is saved; the digest still finds it */ }
    }

    async function run(key: SectionKey, fn: () => Promise<void>) {
        setSavingKey(key); setSavedKey(null); setError('');
        try {
            await fn();
            setSavedKey(key);
            router.refresh();
        } catch (e: any) {
            setError(e?.message || 'Could not save those changes.');
        } finally {
            setSavingKey(null);
        }
    }

    async function saveBusiness() {
        const { error: e } = await supabase.from('service_providers')
            .update({ business_name: name.trim(), description }).eq('id', provider.id);
        if (e) throw e;
        await announceChange();
    }

    async function saveRates() {
        const { error: e } = await supabase.from('service_providers')
            .update({ hourly_rate: numOrNull(hourly), callout_fee: numOrNull(callout) }).eq('id', provider.id);
        if (e) throw e;
    }

    async function saveCoverage() {
        // Replace the whole set, region rows in the sign-up's shape: the region
        // label in `label`, radius 0, centre 0 (nothing reads a region's radius).
        const { error: delErr } = await supabase.from('service_areas').delete().eq('provider_id', provider.id);
        if (delErr) throw delErr;
        if (regions.length) {
            const rows = regions.map((label) => {
                const town = COVERAGE_TOWNS.filter((t) => t.label === label)[0];
                return {
                    provider_id: provider.id,
                    label,
                    centre_lat: town ? town.lat : 0,
                    centre_lng: town ? town.lng : 0,
                    radius_miles: 0,
                };
            });
            const { error: insErr } = await supabase.from('service_areas').insert(rows);
            if (insErr) throw insErr;
        }
    }

    async function saveServices() {
        const allKeys = serviceGroups.flatMap((g) => g.items.map((it) => it.key));
        if (allKeys.length) {
            const { error: e } = await supabase.from('service_provider_extras').upsert(
                allKeys.map((key) => ({ provider_id: provider.id, extra_key: key, offered: !!offered[key] })),
                { onConflict: 'provider_id,extra_key' },
            );
            if (e) throw e;
        }
    }

    async function saveSkills() {
        const res = await fetch('/api/services/skills', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ providerId: provider.id, labels: skills }),
        });
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            throw new Error(d.error || 'Could not save your skills.');
        }
    }

    async function saveContact() {
        const { error: e } = await supabase.from('service_providers').update({
            contact_email: contactEmail.trim(),
            contact_phone: contactPhone.trim() || null,
            sms_opt_out: smsOptOut,
            ...(asksRegistration ? { registration_number: registrationNumber.trim() || null } : {}),
        }).eq('id', provider.id);
        if (e) throw e;
    }

    async function persistPhotos(next: string[]) {
        const { error: e } = await supabase.from('service_providers').update({ photos: next }).eq('id', provider.id);
        if (e) { setError(e.message); return false; }
        await announceChange();
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

    async function saveRegNumber(scheme: string, number: string) {
        setSavingReg(scheme); setError('');
        try {
            const { error: e } = await supabase.from('service_provider_registrations')
                .update({ number: number.trim() }).eq('provider_id', provider.id).eq('scheme', scheme);
            if (e) throw e;
            router.refresh();
        } catch (e: any) {
            setError(e?.message || 'Could not update that number.');
        } finally {
            setSavingReg(null);
        }
    }

    const ALL_SECTIONS: Array<{ key: SectionKey; label: string; icon: any; show: boolean }> = [
        { key: 'business', label: 'Business', icon: Briefcase, show: true },
        { key: 'rates', label: 'Rates & call-out', icon: PoundSterling, show: true },
        { key: 'coverage', label: 'Coverage', icon: MapPin, show: true },
        { key: 'services', label: 'Services you offer', icon: ListChecks, show: serviceGroups.length > 0 },
        { key: 'skills', label: 'Other skills', icon: Tag, show: true },
        { key: 'contact', label: asksRegistration ? 'Contact & registration' : 'Contact', icon: Phone, show: true },
        { key: 'photos', label: 'Photos', icon: ImageIcon, show: true },
        { key: 'registrations', label: 'Registrations', icon: BadgeCheck, show: regs.length > 0 },
    ];
    const SECTIONS = ALL_SECTIONS.filter((s) => s.show);

    const saving = (k: SectionKey) => savingKey === k;
    const saved = (k: SectionKey) => savedKey === k;

    return (
        <div className="mt-6">
            {error && (
                <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
            )}

            <div className="grid grid-cols-1 gap-8 md:grid-cols-[220px_1fr]">
                {/* Section nav */}
                <nav className="space-y-1">
                    {SECTIONS.map(({ key, label, icon: Icon }) => (
                        <button key={key} type="button" onClick={() => setActive(key)}
                            className={`flex w-full items-center rounded-xl px-3 py-2.5 text-sm font-medium transition ${active === key ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}>
                            <Icon className="mr-3 h-4 w-4" /> {label}
                        </button>
                    ))}
                </nav>

                {/* Content */}
                <div className="space-y-6">
                    {active === 'business' && (
                        <SectionCard title="Business" hint="The name and the line hosts read when deciding who to ask." onSave={() => run('business', saveBusiness)} saving={saving('business')} saved={saved('business')}>
                            <Field label="Business name">
                                <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
                            </Field>
                            <Field label="What you do">
                                <textarea className={`${inputCls} min-h-[110px]`} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A line or two hosts will read when deciding who to ask." />
                            </Field>
                        </SectionCard>
                    )}

                    {active === 'rates' && (
                        <SectionCard title="Rates & call-out" hint="What you charge. Leave blank to quote per job." onSave={() => run('rates', saveRates)} saving={saving('rates')} saved={saved('rates')}>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Hourly rate (£)">
                                    <input inputMode="decimal" className={inputCls} value={hourly} onChange={(e) => setHourly(e.target.value)} placeholder="e.g. 55" />
                                </Field>
                                <Field label="Call-out fee (£)">
                                    <input inputMode="decimal" className={inputCls} value={callout} onChange={(e) => setCallout(e.target.value)} placeholder="e.g. 40" />
                                </Field>
                            </div>
                        </SectionCard>
                    )}

                    {active === 'coverage' && (
                        <SectionCard title="Coverage" hint="The parts of Dumfries & Galloway you cover. Tick the regions — hosts there can find you." onSave={() => run('coverage', saveCoverage)} saving={saving('coverage')} saved={saved('coverage')}>
                            <div className="space-y-2">
                                {GUEST_REGIONS.map((rg) => {
                                    const isAll = rg.key === GUEST_COVERAGE_ALL_KEY;
                                    const on = regions.includes(rg.label);
                                    return (
                                        <button key={rg.key} type="button" onClick={() => toggleRegion(rg.label, isAll)} aria-pressed={on}
                                            className={`flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left transition ${on ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200 hover:border-slate-300'}`}>
                                            <span className={`flex h-5 w-5 flex-none items-center justify-center rounded-full border-2 ${on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300'}`}>
                                                {on && <Check className="h-3 w-3" strokeWidth={3} />}
                                            </span>
                                            <span className="min-w-0">
                                                <span className="block text-sm font-semibold text-slate-900">{rg.label}</span>
                                                <span className="block text-[13px] text-slate-500">{rg.hint}</span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </SectionCard>
                    )}

                    {active === 'services' && serviceGroups.length > 0 && (
                        <SectionCard title="Services you offer" hint="Tick the work you take on — this is what a host filters by." onSave={() => run('services', saveServices)} saving={saving('services')} saved={saved('services')}>
                            {serviceGroups.map((g) => (
                                <div key={g.label}>
                                    <div className="mb-1 text-[12px] font-bold uppercase tracking-wide text-slate-400">{g.label}</div>
                                    <div className="grid gap-x-4 sm:grid-cols-2">
                                        {g.items.map((it) => (
                                            <label key={it.key} className="flex cursor-pointer items-center gap-2.5 py-1.5 text-sm text-slate-700">
                                                <input type="checkbox" checked={!!offered[it.key]} onChange={(e) => setOffered({ ...offered, [it.key]: e.target.checked })}
                                                    className="h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-2 focus:ring-emerald-600/30" />
                                                {it.label}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </SectionCard>
                    )}

                    {active === 'skills' && (
                        <SectionCard title="Other skills" hint="Anything the services list doesn't name — a specialism worth spelling out. Hosts search on these too." onSave={() => run('skills', saveSkills)} saving={saving('skills')} saved={saved('skills')}>
                            <div className="flex flex-wrap gap-1.5">
                                {skills.length === 0 && <span className="text-sm text-slate-400">None added yet.</span>}
                                {skills.map((sk) => (
                                    <span key={sk} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 py-1 pl-3 pr-1.5 text-[13px] font-semibold text-emerald-800">
                                        {sk}
                                        <button onClick={() => setSkills(skills.filter((x) => x !== sk))} aria-label={`Remove ${sk}`} className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-200/70 text-emerald-800 hover:bg-emerald-300">
                                            <X className="h-3 w-3" strokeWidth={2.5} />
                                        </button>
                                    </span>
                                ))}
                            </div>
                            {skills.length < 20 && (
                                <div className="flex items-center gap-2">
                                    <input className={inputCls} value={newSkill} onChange={(e) => setNewSkill(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }}
                                        placeholder="e.g. Boiler servicing, bathroom fitting, leak repair" />
                                    <button onClick={addSkill} className="inline-flex flex-none items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] font-bold text-slate-800 hover:bg-slate-50">
                                        <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> Add
                                    </button>
                                </div>
                            )}
                            <p className="text-[12px] text-slate-400">Regulated work (gas, oil, electrical) only shows to hosts once we’ve approved your matching registration number. Hosts see it as provided by you.</p>
                        </SectionCard>
                    )}

                    {active === 'contact' && (
                        <SectionCard title={asksRegistration ? 'Contact & registration' : 'Contact'} hint="How we reach you about jobs. Your email and phone never go on your public listing." onSave={() => run('contact', saveContact)} saving={saving('contact')} saved={saved('contact')}>
                            <Field label="Email we reach you on">
                                <input type="email" className={inputCls} value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
                            </Field>
                            <Field label="Phone (optional)">
                                <input className={inputCls} value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
                            </Field>
                            <label className="flex cursor-pointer items-start gap-2.5">
                                <input type="checkbox" className="mt-1" checked={smsOptOut} onChange={(e) => setSmsOptOut(e.target.checked)} />
                                <span className="text-sm text-slate-700">
                                    Don&rsquo;t text me — email only
                                    <span className="block text-xs text-slate-500">You will still get every enquiry, just not as quickly.</span>
                                </span>
                            </label>
                            {asksRegistration && (
                                <Field label="Registration number (optional)" hint="If you add it, hosts see it on your profile.">
                                    <input className={inputCls} value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} />
                                </Field>
                            )}
                        </SectionCard>
                    )}

                    {active === 'photos' && (
                        <SectionCard title="Photos" hint="Your work, or your van and team. Hosts see these first.">
                            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[13px] font-bold text-emerald-800 hover:bg-emerald-100">
                                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />}
                                Add photos
                                <input type="file" accept="image/*" multiple className="hidden" disabled={uploading} onChange={(e) => addPhotos(e.target.files)} />
                            </label>
                            {photos.length === 0 ? (
                                <p className="text-sm text-slate-500">No photos yet.</p>
                            ) : (
                                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                                    {photos.map((p) => (
                                        <div key={p} className="group relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={getImageUrl(p)} alt="" className="h-full w-full object-cover" />
                                            <button onClick={() => persistPhotos(photos.filter((x) => x !== p))} aria-label="Remove photo" className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition group-hover:opacity-100">
                                                <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <p className="text-[12px] text-slate-400">Photos save as soon as you add or remove them.</p>
                        </SectionCard>
                    )}

                    {active === 'registrations' && regs.length > 0 && (
                        <SectionCard title="Registrations" hint="Your trade registrations. Changing a number sends it back to us to re-check before the badge shows again.">
                            {regs.map((r) => (
                                <div key={r.scheme} className="border-t border-slate-100 pt-3 first:border-t-0 first:pt-0">
                                    <div className="mb-1 flex items-center gap-2">
                                        <span className="text-sm font-semibold text-slate-800">{schemeLabel(r.scheme)}</span>
                                        {r.verified ? (
                                            <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" /> Verified</span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-amber-700"><ShieldAlert className="h-3.5 w-3.5" /> Awaiting check</span>
                                        )}
                                    </div>
                                    <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                                        <input className={inputCls} value={r.number} onChange={(e) => setRegs(regs.map((x) => x.scheme === r.scheme ? { ...x, number: e.target.value } : x))} />
                                        <button onClick={() => saveRegNumber(r.scheme, r.number)} disabled={savingReg === r.scheme} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-60">
                                            {savingReg === r.scheme ? 'Saving…' : 'Update'}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </SectionCard>
                    )}
                </div>
            </div>
        </div>
    );
}
