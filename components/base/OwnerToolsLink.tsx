'use client';

import Link from 'next/link';
import useBadgeCounts, { adminPendingTotal } from './useBadgeCounts';

// The "Owner tools" line in the menu, with the number still waiting on the admin
// across all three review queues (holiday lets, experiences, trades). Same green
// badge as Messages/Requests — one badge to learn — and it clears as each item
// is approved or declined, because the count is derived from live DB state, not
// stored. The per-category split (which number is which) lives one click away on
// the owner-tools page itself.
export default function OwnerToolsLink({ className }: { className?: string }) {
    const { admin } = useBadgeCounts();
    const total = adminPendingTotal(admin);

    return (
        <Link href="/admin" className={'flex items-center gap-2 ' + (className || '')}>
            <span>Owner tools</span>
            {total > 0 && (
                <span className="text-xs font-bold text-white bg-emerald-700 rounded-full px-2 py-0.5 leading-none">
                    {total > 99 ? '99+' : total}
                </span>
            )}
        </Link>
    );
}
