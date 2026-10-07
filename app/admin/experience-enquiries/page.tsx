import { requireAdmin } from '@/lib/access';
import { adminClient } from '@/lib/supabaseAdmin';
import { adminName } from '@/lib/utils';
import { ukDateTime } from '@/lib/dayKey';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

// Every guest enquiry about a range / price-on-enquiry offering, newest first,
// so nothing a guest sent sits unseen. The provider is emailed when one lands;
// this is the owner's view that it happened, and the full message.
export default async function AdminExperienceEnquiries() {
    await requireAdmin();
    const admin = adminClient();

    const { data: rows, error } = await admin
        .from('experience_enquiries')
        .select('id, provider_id, guest_id, item_name, message, status, created_at')
        .order('created_at', { ascending: false })
        .limit(200);

    const enquiries = rows || [];
    const providerIds = Array.from(new Set(enquiries.map((r: any) => r.provider_id).filter(Boolean)));
    const guestIds = Array.from(new Set(enquiries.map((r: any) => r.guest_id).filter(Boolean)));

    const { data: providers } = providerIds.length
        ? await admin.from('service_providers').select('id, business_name').in('id', providerIds)
        : { data: [] as any[] };
    const { data: guests } = guestIds.length
        ? await admin.from('profiles').select('id, full_name, preferred_name').in('id', guestIds)
        : { data: [] as any[] };
    const providerName: Record<string, string> = {};
    for (const p of providers || []) providerName[p.id] = p.business_name || '—';
    const guestById: Record<string, any> = {};
    for (const g of guests || []) guestById[g.id] = g;

    return (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
            <Link href="/admin" className="text-sm text-slate-500 hover:text-slate-800 underline">
                &larr; Owner tools
            </Link>
            <h1 className="text-2xl font-bold text-slate-900 mt-4 mb-1">Experience enquiries</h1>
            <p className="text-sm text-slate-500 mb-8">
                Guests asking an experience provider for a price (range or price-on-enquiry offerings). The provider is emailed each one.
            </p>

            {error ? (
                <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-5 text-sm text-red-900">
                    These could not be read: {error.message}
                </div>
            ) : enquiries.length === 0 ? (
                <p className="text-sm text-slate-500">No enquiries yet.</p>
            ) : (
                <div className="space-y-4">
                    {enquiries.map((e: any) => (
                        <div key={e.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <div className="font-semibold text-slate-900">
                                    {adminName(guestById[e.guest_id] || null, 'A guest')}
                                    <span className="font-normal text-slate-500"> → {providerName[e.provider_id] || '—'}</span>
                                </div>
                                <span className="text-xs text-slate-400">{ukDateTime(e.created_at)}</span>
                            </div>
                            {e.item_name && (
                                <div className="mt-0.5 text-sm text-slate-500">About {e.item_name}</div>
                            )}
                            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{e.message}</p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
