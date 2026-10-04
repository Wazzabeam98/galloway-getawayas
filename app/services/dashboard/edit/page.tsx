export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { tradeLabel, offeringsFor, EXTRA_GROUPS, audienceForTrade } from '@/lib/serviceProviders';

const groupLabel = (key: string): string =>
    (EXTRA_GROUPS.find((g) => g.key === key) as any)?.label || key;
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { ukDate } from '@/lib/dayKey';
import ProviderBusinessEditor from '@/components/services/ProviderBusinessEditor';
import TradeListingStatus from '@/components/services/TradeListingStatus';

export const metadata = {
    title: 'Edit your business',
    robots: { index: false, follow: false },
};

export default async function EditBusinessPage() {
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/');

    const admin = adminClient();

    const { data: providers } = await admin
        .from('service_providers')
        .select('id, business_name, trade, audience, description, hourly_rate, callout_fee, photos, status, contact_email, contact_phone, sms_opt_out, registration_number, plan, trial_ends_at, owner_paused, admin_hidden_at, stripe_subscription_id')
        .eq('owner_id', user.id)
        .order('updated_at', { ascending: false });

    const list = providers || [];
    const provider = list.find((p) => p.status === 'approved') || list[0];
    if (!provider) redirect('/services/dashboard');
    if (provider.status !== 'approved') redirect(`/services/join?trade=${provider.trade}`);

    // This editor is host-shaped — rates, service groups, registrations. A
    // guest-experience provider now has its OWN sectioned listing editor, which
    // owns edit (the wizard is first-time create only). Send them there rather
    // than back into the sign-up flow.
    //
    // Fork on the AUTHORITATIVE audience column, not audienceForTrade(trade): a
    // guest provider's category (sauna, yoga, chef…) is NOT a registered trade,
    // so audienceForTrade returns '' for it and a guest would fall through to the
    // tradesman editor. audience === 'guest' is the truth and can't be fooled;
    // the trade fallback stays only as belt-and-braces. Mirrors the guard on
    // /services/dashboard/listing so the two routes agree.
    if (provider.audience === 'guest' || audienceForTrade(provider.trade) === 'guest') {
        redirect('/services/dashboard/listing');
    }

    // Coverage is regions now (round two) — a service_areas row per region, the
    // region name in `label`. The editor renders the region picker, so we just
    // need the current labels.
    const { data: areas } = await admin
        .from('service_areas')
        .select('label')
        .eq('provider_id', provider.id)
        .order('created_at', { ascending: true });

    const { data: registrations } = await admin
        .from('service_provider_registrations')
        .select('provider_id, scheme, number, verified_at, verified_number, expires_at')
        .eq('provider_id', provider.id);

    // Skills are a set of free-text tags reconciled through /api/services/skills.
    // Here we just need their readable labels to seed the editor.
    const { data: skillLinks } = await admin
        .from('service_provider_skills')
        .select('skill_id')
        .eq('provider_id', provider.id);
    const skillIds = (skillLinks || []).map((l: any) => l.skill_id);
    const { data: skillRows } = skillIds.length
        ? await admin.from('service_skills').select('id, label').in('id', skillIds)
        : { data: [] as any[] };
    const skills = (skillRows || []).map((r: any) => r.label);

    // The specific services he ticked at sign-up — "full bathroom installations"
    // and the like — live in service_provider_extras as toggles. Build the same
    // grouped checklist the wizard showed, marked with what he currently offers.
    const { data: extraRows } = await admin
        .from('service_provider_extras')
        .select('extra_key, offered')
        .eq('provider_id', provider.id);
    const offeredKeys = new Set((extraRows || []).filter((r: any) => r.offered).map((r: any) => r.extra_key));

    const toggleOfferings = offeringsFor(provider.trade).filter((e) => e.type === 'toggle');
    const serviceGroups: Array<{ label: string; items: Array<{ key: string; label: string; offered: boolean }> }> = [];
    for (const e of toggleOfferings) {
        let g = serviceGroups.find((x) => x.label === groupLabel(e.group));
        if (!g) { g = { label: groupLabel(e.group), items: [] }; serviceGroups.push(g); }
        g.items.push({ key: e.key, label: e.label, offered: offeredKeys.has(e.key) });
    }

    // Down by their own choice (owner_paused) or ours (admin_hidden_at). Either
    // way hosts can't find them, so the "Listed" pill and the public-profile
    // link (which would bounce to the directory) give way to a taken-down pill.
    const paused = provider.owner_paused === true;
    const adminHidden = !!provider.admin_hidden_at;
    const down = paused || adminHidden;
    // What the take-down does to their bill: a card on file is paused; a free
    // period keeps running; a commission trade has no bill.
    const billing = provider.plan === 'subscription'
        ? (provider.stripe_subscription_id ? 'subscription' as const : 'free' as const)
        : null;

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 pb-24">
            <Link href="/services/dashboard" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800">
                <ArrowLeft className="w-4 h-4" /> Back to your business
            </Link>
            <h1 className="mt-3 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                Edit your business
            </h1>
            <p className="mt-1.5 text-sm text-slate-500">
                Everything hosts see about {provider.business_name} — {tradeLabel(provider.trade)} — in one place.
            </p>

            {/* Business status — the "Listed" pill and the free-subscription line
                that used to sit on the enquiries inbox. They describe the business,
                so they live here, with a link to see the profile a host sees (the
                way a host previews a listing). */}
            <div className="mt-5 flex flex-wrap items-center gap-3">
                {down && (
                    <span className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">
                        <span className="h-2 w-2 rounded-full bg-slate-400" />
                        Taken down · hosts can’t find you
                    </span>
                )}
                {!down && provider.plan === 'subscription' && (
                    <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        Listed · hosts can find you
                    </span>
                )}
                {provider.plan === 'subscription' && (
                    <span className="text-sm font-semibold text-emerald-700">
                        {provider.trial_ends_at ? 'Free until ' + ukDate(provider.trial_ends_at) : 'Free for six months from your first enquiry'}
                    </span>
                )}
                {!down && <a
                    href={`/services/${encodeURIComponent(provider.trade)}/${provider.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-4 py-1.5 text-sm font-semibold text-slate-700 hover:border-slate-500"
                >
                    <ExternalLink className="h-4 w-4" /> View your public profile
                </a>}
            </div>

            <div className="mt-6">
                <TradeListingStatus place="banner" providerId={provider.id} paused={paused} adminHidden={adminHidden} billing={billing} />
            </div>

            <ProviderBusinessEditor
                provider={{
                    id: provider.id,
                    trade: provider.trade,
                    business_name: provider.business_name || '',
                    description: provider.description || '',
                    hourly_rate: provider.hourly_rate,
                    callout_fee: provider.callout_fee,
                    photos: provider.photos || [],
                    contact_email: provider.contact_email || '',
                    contact_phone: provider.contact_phone || '',
                    sms_opt_out: !!provider.sms_opt_out,
                    registration_number: provider.registration_number || '',
                }}
                skills={skills}
                serviceGroups={serviceGroups}
                regions={(areas || []).map((a: any) => a.label || '').filter(Boolean)}
                registrations={(registrations || []).map((r: any) => ({
                    scheme: r.scheme,
                    number: r.number || '',
                    verified: !!r.verified_at && String(r.verified_number || '').trim() === String(r.number || '').trim(),
                }))}
            />

            <div className="mt-10">
                <TradeListingStatus place="section" providerId={provider.id} paused={paused} adminHidden={adminHidden} billing={billing} />
            </div>
        </div>
    );
}
