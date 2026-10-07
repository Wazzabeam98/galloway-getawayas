import Link from 'next/link';
import { requireAdmin } from '@/lib/access';
import HeldPayoutsTable from '@/components/admin/HeldPayoutsTable';

export const dynamic = 'force-dynamic';

// Which experience providers have money held because their payouts aren't set
// up yet (Airbnb's model: live once approved, share held until they can be paid).
export default async function AdminHeldPayouts() {
    await requireAdmin();
    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
            <Link href="/admin" className="text-sm text-slate-500 hover:text-slate-800 underline">
                &larr; Owner tools
            </Link>
            <h1 className="text-2xl font-bold text-slate-900 mt-4 mb-6">Money held for experience providers</h1>
            <HeldPayoutsTable />
        </div>
    );
}
