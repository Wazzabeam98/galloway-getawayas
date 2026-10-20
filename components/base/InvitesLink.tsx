'use client';

// The top line of the menu while a co-host invitation is waiting — the
// "notification" for it, with the same green count as Messages. Opens the
// dashboard, where the invitation sits with Accept and Decline. Nothing at all
// when there are none.

import Link from 'next/link';
import useBadgeCounts from './useBadgeCounts';

export default function InvitesLink({ className }: { className?: string }) {
    const { invites } = useBadgeCounts(true);
    if (!invites) return null;
    return (
        <li className={className}>
            <Link href="/dashboard" className="flex items-center gap-2 font-semibold text-emerald-800">
                <span>{invites === 1 ? 'Co-host invitation' : 'Co-host invitations'}</span>
                <span className="text-xs font-bold text-white bg-emerald-700 rounded-full px-2 py-0.5 leading-none">{invites}</span>
            </Link>
        </li>
    );
}
