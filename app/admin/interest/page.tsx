import { requireAdmin } from '@/lib/access';
import { adminClient } from '@/lib/supabaseAdmin';
import InterestTable, { type InterestRow } from '@/components/admin/InterestTable';

export const dynamic = 'force-dynamic';

// The interest list. Owner-only (requireAdmin 404s everyone else). Reads through
// the service role because the table has no policy for any browser role — this
// page is the only way to see it short of the database.
export default async function AdminInterestPage() {
    await requireAdmin();

    const admin = adminClient();
    const { data, error } = await admin
        .from('interest_registrations')
        .select('id, created_at, updated_at, category, name, email, phone, region, notes, property_count, status')
        .order('created_at', { ascending: false });

    if (error) {
        return (
            <main className="mx-auto max-w-3xl px-4 py-16">
                <h1 className="text-2xl font-bold text-slate-900">Register-interest list</h1>
                <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    Could not load the list: {error.message}
                </p>
            </main>
        );
    }

    const rows = (data || []) as InterestRow[];

    return (
        <main className="mx-auto max-w-6xl px-4 py-12">
            <div className="flex items-baseline justify-between gap-4">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">Register-interest list</h1>
                <span className="text-sm text-slate-500">{rows.length} registration{rows.length === 1 ? '' : 's'}</span>
            </div>
            <p className="mt-2 text-sm text-slate-500">
                Everyone who has registered while sign-up is behind the coming-soon tiles. Sort by any column;
                mark people off as you reach them.
            </p>
            <div className="mt-8">
                <InterestTable rows={rows} />
            </div>
        </main>
    );
}
