export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { tradeLabel } from '@/lib/serviceProviders';
import { ArrowLeft } from 'lucide-react';
import ProviderBusinessEditor from '@/components/services/ProviderBusinessEditor';

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
        .select('id, business_name, trade, description, hourly_rate, callout_fee, photos, status')
        .eq('owner_id', user.id)
        .order('updated_at', { ascending: false });

    const list = providers || [];
    const provider = list.find((p) => p.status === 'approved') || list[0];
    if (!provider) redirect('/services/dashboard');
    if (provider.status !== 'approved') redirect(`/services/join?trade=${provider.trade}`);

    const { data: areas } = await admin
        .from('service_areas')
        .select('id, label, radius_miles')
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

    return (
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 pb-24">
            <Link href="/services/dashboard" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800">
                <ArrowLeft className="w-4 h-4" /> Back to your business
            </Link>
            <h1 className="mt-3 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                Edit your business
            </h1>
            <p className="mt-1.5 text-sm text-slate-500">
                Everything hosts see about {provider.business_name} — {tradeLabel(provider.trade)} — in one place.
            </p>

            <ProviderBusinessEditor
                provider={{
                    id: provider.id,
                    business_name: provider.business_name || '',
                    description: provider.description || '',
                    hourly_rate: provider.hourly_rate,
                    callout_fee: provider.callout_fee,
                    photos: provider.photos || [],
                }}
                skills={skills}
                areas={(areas || []).map((a) => ({ id: a.id, label: a.label || '', radius_miles: Number(a.radius_miles) }))}
                registrations={(registrations || []).map((r: any) => ({
                    scheme: r.scheme,
                    number: r.number || '',
                    verified: !!r.verified_at && String(r.verified_number || '').trim() === String(r.number || '').trim(),
                }))}
            />
        </div>
    );
}
