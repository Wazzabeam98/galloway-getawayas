// =====================================================================
// GALLOWAY GETAWAYS — commission rates, owner only
// WHERE THIS GOES: GitHub → app/admin/commission/page.tsx  (REPLACES the file)
//
// This page used to be a client component. It asked the browser "am I an
// owner?", and if the browser said yes it drew the rates. That is not a gate:
// everything it decided happened on the far side of the wire, and it queried
// commission_rate — a money column — straight from the browser to do it.
//
// It grants nothing new to close this. /api/admin/commission has always
// checked for itself, so the numbers could be read but never changed. What it
// closes is a page that looked protected and was not, and one more place a
// money column leaves the database towards a browser.
//
// The gate is now here, on the server, before anything renders. The editor is
// components/admin/CommissionEditor.tsx and receives the rows as props.
// =====================================================================

import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { requireAdmin } from '@/lib/access';
import { notFound } from 'next/navigation';
import { adminClient } from '@/lib/supabaseAdmin';
import { adminName } from '@/lib/utils';
import CommissionEditor, { CommissionRow } from '@/components/admin/CommissionEditor';

export const dynamic = 'force-dynamic';

export default async function CommissionAdmin() {
    const supabase = createServerComponentClient({ cookies });

    // One rule, in lib/access. It was written out nine times, byte for
    // byte, and every copy was correct — but nothing made the tenth so.
    const authUser = await requireAdmin();
    // Service role, like the other owner pages. commission_rate is one of the
    // money columns revoked from `authenticated`, so reading it as the
    // signed-in user is the wrong tool even for someone allowed to see it.
    const admin = adminClient();

    const { data: listings } = await admin
        .from('listings')
        .select('id, title, host_id, commission_rate')
        .order('title');

    const rows: CommissionRow[] = listings || [];

    const hostIds = Array.from(new Set(rows.map((l) => l.host_id)));
    const hostNames: Record<string, string> = {};

    if (hostIds.length) {
        const { data: hosts } = await admin
            .from('profiles')
            .select('id, full_name, preferred_name, show_full_name')
            .in('id', hostIds);

        (hosts || []).forEach((h: any) => {
            hostNames[h.id] = adminName(h, 'Host');
        });
    }

    return <CommissionEditor rows={rows} hostNames={hostNames} />;
}
