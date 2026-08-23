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
import { notFound } from 'next/navigation';
import { adminClient } from '@/lib/supabaseAdmin';
import { displayName } from '@/lib/utils';
import CommissionEditor, { CommissionRow } from '@/components/admin/CommissionEditor';

export const dynamic = 'force-dynamic';

export default async function CommissionAdmin() {
    const supabase = createServerComponentClient({ cookies });

    // getUser(), not getSession(). getSession() only decodes the cookie — it
    // never checks the signature — so the id everything below hangs off would
    // be whatever the caller wrote in it. getUser() asks the auth server,
    // which verifies the token and that the session has not been revoked.
    const { data: auth } = await supabase.auth.getUser();

    if (!auth || !auth.user) notFound();

    const { data: me } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', auth.user.id)
        .maybeSingle();

    if (!me || me.is_admin !== true) notFound();

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
            hostNames[h.id] = displayName(h, 'Host');
        });
    }

    return <CommissionEditor rows={rows} hostNames={hostNames} />;
}
