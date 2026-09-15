import { redirect } from 'next/navigation';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { ArrowLeft } from 'lucide-react';
import ThingsToKnowEditor from '@/components/services/ThingsToKnowEditor';

export const dynamic = 'force-dynamic';

// "Things to know", edited after approval by the provider themselves — away from
// the long sign-up. A guest-audience provider's own row only; the fields live in
// the guest_details jsonb, which the owner may already write.
export default async function ThingsToKnowPage() {
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/');

    const admin = adminClient();
    const { data: providers } = await admin
        .from('service_providers')
        .select('id, business_name, audience, status, guest_details')
        .eq('owner_id', user.id);

    const provider = (providers || []).find((p) => p.audience === 'guest' && p.status === 'approved')
        || (providers || []).find((p) => p.audience === 'guest');
    if (!provider) redirect('/services/dashboard');

    return (
        <div className="mx-auto max-w-2xl px-4 sm:px-6 py-8">
            <Link href="/services/dashboard" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
                <ArrowLeft className="h-4 w-4" /> Your business
            </Link>
            <h1 className="mt-4 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">Things to know</h1>
            <p className="mt-1.5 text-[15px] leading-relaxed text-slate-600">
                What a guest should know before booking {provider.business_name}. All optional — fill
                what applies, and only those appear on your listing.
            </p>

            <div className="mt-7 rounded-2xl border border-slate-200 p-5 sm:p-6">
                <ThingsToKnowEditor providerId={provider.id} guestDetails={provider.guest_details as any} />
            </div>
        </div>
    );
}
