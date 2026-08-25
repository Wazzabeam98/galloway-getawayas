import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getImageUrl } from '@/lib/utils';
import {
    tradeLabel,
    hasUnreviewedChanges,
    changedFields,
    fieldLabel,
    initialsFor,
    schemeLabel,
    registrationVerified,
    registrationExpired,
    registrationBlockers,
} from '@/lib/serviceProviders';
import ProviderReviewRow from '@/components/admin/ProviderReviewRow';

export const dynamic = 'force-dynamic';

// Businesses waiting to appear on the site, and everyone already on it.
//
// They fill their own details in; nothing shows publicly until it has been
// through here. These people go to guests' properties, so the gate is the
// point of the screen.
export default async function AdminProviders() {
    const supabase = createServerComponentClient({ cookies });

    // getUser(), not getSession() — the latter only decodes the cookie and
    // never checks its signature, so the id below would be whatever the caller
    // wrote in it.
    const { data: auth } = await supabase.auth.getUser();
    if (!auth || !auth.user) notFound();

    const { data: me } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', auth.user.id)
        .maybeSingle();

    if (!me || me.is_admin !== true) notFound();

    const admin = adminClient();

    // Service role: a pending application is invisible to everyone but its
    // owner under RLS, which is the whole point — and would make this page
    // permanently empty read as the signed-in user.
    //
    // The error is checked rather than discarded, because an empty list and a
    // broken key look identical on screen, and one of them means applications
    // are silently piling up.
    // The business comes back nested, then is flattened onto the row below.
    // Everything downstream — the digest, the card, the decision route — was
    // written against one flat row and there is no reason for a table split to
    // become a shape change in six other places.
    const { data: providers, error } = await admin
        .from('service_providers')
        .select('id, business_id, trade, description, photos, audience, status, submitted_at, created_at, approved_digest, changes_pending_at, does_gas, does_oil, service_businesses ( id, owner_id, business_name, logo, contact_email, contact_phone, kind, plan, trial_ends_at )')
        .order('submitted_at', { ascending: false, nullsFirst: false });

    if (error) {
        return (
            <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
                <Link href="/admin" className="text-sm text-slate-500 hover:text-slate-800 underline">
                    &larr; Owner tools
                </Link>
                <h1 className="text-2xl font-bold text-slate-900 mt-4 mb-2">Service providers</h1>
                <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-5">
                    <div className="font-bold text-red-900">The providers could not be read</div>
                    <p className="text-sm text-red-900 mt-1">{error.message}</p>
                    <p className="text-sm text-red-900 mt-2">
                        This is not an empty list — applications may be waiting behind it.
                    </p>
                </div>
            </div>
        );
    }

    const rows = (providers || []).map((r: any) => {
        const business = r.service_businesses || {};
        return {
            ...r,
            owner_id: business.owner_id || null,
            business_name: business.business_name || '',
            logo: business.logo || null,
            contact_email: business.contact_email || '',
            contact_phone: business.contact_phone || '',
            kind: business.kind || 'external',
            plan: business.plan || 'trial',
            trial_ends_at: business.trial_ends_at || null,
        };
    });

    // Gas Safe, OFTEC and the Part P schemes. Read for every row rather than
    // only the waiting ones, because a live electrician whose registration has
    // run out is exactly the thing this screen should be able to show.
    const regRows = rows.length
        ? (await admin
              .from('service_provider_registrations')
              .select('provider_id, scheme, number, verified_at, verified_number, expires_at')
              .in('provider_id', rows.map((r: any) => r.id))).data || []
        : [];

    const regsFor = (id: string) =>
        regRows.filter((r: any) => r.provider_id === id).map((r: any) => ({
            ...r,
            schemeLabel: schemeLabel(String(r.scheme || '')),
            verified: registrationVerified(r),
            expired: registrationExpired(r),
        }));

    const areaRows = rows.length
        ? (await admin
              .from('service_areas')
              .select('provider_id, label, radius_miles')
              .in('provider_id', rows.map((r: any) => r.id))).data || []
        : [];

    const areasFor = (id: string) =>
        areaRows.filter((a: any) => a.provider_id === id)
            .map((a: any) => a.label + ' · ' + Number(a.radius_miles) + ' mi');

    // Three groups, not two. A live provider who has edited their shop window
    // is a job, but it is not the same job as an application — they are on the
    // site either way, so it is never urgent in the way a waiting business is.
    //
    // Worked out from the digest rather than from `changes_pending_at`,
    // because providers write their own row and could decline to stamp it.
    // The stamp is only what this sorts by.
    const blockersFor = (row: any) => registrationBlockers(row, regsFor(row.id));

    const waiting = rows.filter((r: any) => r.status === 'pending_review');

    // Counted separately in the summary line. A business waiting on a number
    // being checked is not waiting on a judgement — it is waiting on ten
    // minutes with the Gas Safe register open, which is a different job and
    // one that can be done before ever reading their description.
    const needChecking = rows.filter((r: any) => blockersFor(r).length > 0);
    const changed = rows.filter((r: any) => hasUnreviewedChanges(r));
    const changedIds = changed.map((r: any) => r.id);
    const rest = rows.filter(
        (r: any) => r.status !== 'pending_review' && changedIds.indexOf(r.id) === -1
    );

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
            <Link href="/admin" className="text-sm text-slate-500 hover:text-slate-800 underline">
                &larr; Owner tools
            </Link>

            <h1 className="text-2xl font-bold text-slate-900 mt-4">Service providers</h1>
            <p className="text-slate-600 text-sm mt-1 mb-8">
                {waiting.length === 0 && changed.length === 0 && needChecking.length === 0
                    ? 'Nothing waiting for you.'
                    : [
                        waiting.length ? waiting.length + ' waiting for a decision' : '',
                        changed.length ? changed.length + ' live with changes to look at' : '',
                        needChecking.length ? needChecking.length + ' with a registration to check' : '',
                    ].filter(Boolean).join(' · ') + '.'}
            </p>

            {waiting.length > 0 && (
                <section className="mb-12">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                        Waiting for review
                    </h2>
                    <div className="space-y-4">
                        {waiting.map((p: any) => (
                            <ProviderReviewRow
                                key={p.id}
                                provider={{ ...p, tradeLabel: tradeLabel(p.trade), logoUrl: p.logo ? getImageUrl(p.logo) : null, initials: initialsFor(p.business_name) }}
                                areas={areasFor(p.id)}
                                photoUrls={(p.photos || []).slice(0, 3).map((x: string) => getImageUrl(x))}
                                registrations={regsFor(p.id)}
                                blockers={blockersFor(p)}
                            />
                        ))}
                    </div>
                </section>
            )}

            {changed.length > 0 && (
                <section className="mb-12">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                        Live, with changes to look at
                    </h2>
                    <div className="space-y-4">
                        {changed.map((p: any) => (
                            <ProviderReviewRow
                                key={p.id}
                                provider={{
                                    ...p,
                                    tradeLabel: tradeLabel(p.trade),
                                    logoUrl: p.logo ? getImageUrl(p.logo) : null,
                                    initials: initialsFor(p.business_name),
                                    changedFields: changedFields(p).map(fieldLabel),
                                }}
                                areas={areasFor(p.id)}
                                photoUrls={(p.photos || []).slice(0, 3).map((x: string) => getImageUrl(x))}
                                registrations={regsFor(p.id)}
                                blockers={blockersFor(p)}
                            />
                        ))}
                    </div>
                </section>
            )}

            <section>
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                    Everyone else
                </h2>
                {rest.length === 0 ? (
                    <p className="text-sm text-slate-500">Nobody has signed up yet.</p>
                ) : (
                    <div className="space-y-4">
                        {rest.map((p: any) => (
                            <ProviderReviewRow
                                key={p.id}
                                provider={{ ...p, tradeLabel: tradeLabel(p.trade), logoUrl: p.logo ? getImageUrl(p.logo) : null, initials: initialsFor(p.business_name) }}
                                areas={areasFor(p.id)}
                                photoUrls={(p.photos || []).slice(0, 3).map((x: string) => getImageUrl(x))}
                                registrations={regsFor(p.id)}
                                blockers={blockersFor(p)}
                            />
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
