import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { requireAdmin } from '@/lib/access';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getImageUrl } from '@/lib/utils';
import {
    tradeLabel,
    calloutLine,
    hasUnreviewedChanges,
    changedFields,
    fieldLabel,
    initialsFor,
    schemeLabel,
    registrationVerified,
    registrationExpired,
    approvalBlockers,
    needsAttention,
    attentionLabel,
    ATTENTION_REASONS,
} from '@/lib/serviceProviders';
import { skillIsPublic, blockedSkillReason } from '@/lib/serviceSkills';
import { asksAboutFuel } from '@/lib/serviceProviders';
import ProviderReviewRow from '@/components/admin/ProviderReviewRow';
import WaitingOnApplicant from '@/components/admin/WaitingOnApplicant';
import { daysWaiting, daysUntilDeleted, RETENTION_DAYS } from '@/lib/serviceApplications';
import BulkApprove from '@/components/admin/BulkApprove';

export const dynamic = 'force-dynamic';

// Businesses waiting to appear on the site, and everyone already on it.
//
// They fill their own details in; nothing shows publicly until it has been
// through here. These people go to guests' properties, so the gate is the
// point of the screen.
export default async function AdminProviders() {
    const supabase = createServerComponentClient({ cookies });

    // One rule, in lib/access. It was written out nine times, byte for
    // byte, and every copy was correct — but nothing made the tenth so.
    const authUser = await requireAdmin();
    const admin = adminClient();

    // Service role: a pending application is invisible to everyone but its
    // owner under RLS, which is the whole point — and would make this page
    // permanently empty read as the signed-in user.
    //
    // The error is checked rather than discarded, because an empty list and a
    // broken key look identical on screen, and one of them means applications
    // are silently piling up.
    const { data: providers, error } = await admin
        .from('service_providers')
        .select('id, business_name, trade, description, photos, logo, audience, kind, status, plan, contact_email, contact_phone, submitted_at, created_at, owner_id, approved_digest, changes_pending_at, does_gas, does_oil, callout_fee, hourly_rate, callout_waived, trial_ends_at, pricing_choice, billable_hourly_rate, covered_bands, provider_name, based_line, headshot, stripe_mcc, custom_label, category_assigned_at, exclusive_per_date')
        .order('submitted_at', { ascending: false, nullsFirst: false });

    // WHO HAS PROVED THEY CAN READ THEIR EMAIL.
    //
    // An application is lodged the moment it is sent — /api/services/apply
    // makes the account and writes the row in one request — so an applicant can
    // be sitting in this queue having never opened their inbox. That is
    // deliberate: waiting for a confirmation click is what used to lose
    // applications entirely.
    //
    // It is worth knowing before deciding, because approving somebody sends
    // them an email, and an unverified address is one nobody has proved can
    // receive one. One admin call for the whole page rather than one per row.
    const verified = new Map<string, boolean>();
    try {
        const { data: userPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        for (const u of (userPage && userPage.users) || []) {
            verified.set(u.id, Boolean(u.email_confirmed_at || (u as any).confirmed_at));
        }
    } catch (err) {
        // Not knowing is not a reason to hide the queue. An id missing from the
        // map reads as "we could not tell", and the row says so rather than
        // claiming they are verified.
    }

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

    const rows = providers || [];

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

    const skillRows = rows.length
        ? (await admin
              .from('service_provider_skills')
              .select('provider_id, service_skills ( id, label, slug, regulated_concept )')
              .in('provider_id', rows.map((r: any) => r.id))).data || []
        : [];

    const skillsFor = (id: string) =>
        skillRows
            .filter((r: any) => r.provider_id === id)
            .map((r: any) => r.service_skills)
            .filter(Boolean);

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
    const blockersFor = (row: any) => approvalBlockers(row, regsFor(row.id));

    // Why each listing wants looking at, asked once.
    //
    // This used to be three independent filters written out here, and a fourth
    // reason could be added to the model without any of them noticing — the
    // row just never appeared and the first anybody heard was a provider
    // asking why their tag never went live. needsAttention holds the list, and
    // a test loops every reason in it.
    const reasonsFor = (row: any) => needsAttention(row, regsFor(row.id), skillsFor(row.id));

    const waiting = rows.filter((r: any) => reasonsFor(r).indexOf('application') !== -1);
    const changed = rows.filter((r: any) => reasonsFor(r).indexOf('changes') !== -1);
    const changedIds = changed.map((r: any) => r.id);

    // Counted in the summary line rather than grouped. A business waiting on a
    // number being checked is not waiting on a judgement — it is waiting on
    // ten minutes with the Gas Safe register open, which is a different job
    // and one that can be done before ever reading their description.
    const counts: Record<string, number> = {};
    for (const reason of ATTENTION_REASONS) {
        counts[reason] = rows.filter((r: any) => reasonsFor(r).indexOf(reason) !== -1).length;
    }

    const anythingWaiting = ATTENTION_REASONS.some((reason) => counts[reason] > 0);

    const rest = rows.filter(
        (r: any) => r.status !== 'pending_review' && changedIds.indexOf(r.id) === -1
    );

    // Applications that never proved their address. They have no account and no
    // provider row, so they are on no other screen — see
    // components/admin/WaitingOnApplicant.tsx.
    const { data: unclaimedRows } = await admin
        .from('service_applications')
        .select('id, business_name, trade, email, contact_phone, created_at, resend_count')
        .is('claimed_at', null)
        .order('created_at', { ascending: true })
        .limit(100);

    const unclaimed = (unclaimedRows || []).map((r: any) => ({
        id: r.id,
        business_name: r.business_name,
        trade: r.trade,
        email: r.email,
        contact_phone: r.contact_phone,
        resend_count: Number(r.resend_count || 0),
        daysWaiting: daysWaiting(r),
        daysLeft: daysUntilDeleted(r),
    }));

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
            <Link href="/admin" className="text-sm text-slate-500 hover:text-slate-800 underline">
                &larr; Owner tools
            </Link>

            <h1 className="text-2xl font-bold text-slate-900 mt-4">Service providers</h1>
            <p className="text-slate-600 text-sm mt-1 mb-8">
                {/* Built from ATTENTION_REASONS rather than written out, so a
                    new reason appears here the day it is added rather than the
                    day somebody notices it is missing. */}
                {!anythingWaiting
                    ? 'Nothing waiting for you.'
                    : ATTENTION_REASONS
                        .filter((reason) => counts[reason] > 0)
                        .map((reason) => counts[reason] + ' ' + attentionLabel(reason))
                        .join(' · ') + '.'}
            </p>

            <WaitingOnApplicant rows={unclaimed} />

            {waiting.length > 0 && (
                <section className="mb-12">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                        Waiting for review
                    </h2>

                    {/* Only the ones with nothing blocking them. A business
                        whose registration has not been verified is in the list
                        below to be looked at, not swept through with the rest. */}
                    <BulkApprove
                        endpoint="/api/admin/providers"
                        ids={waiting.filter((p: any) => blockersFor(p).length === 0).map((p: any) => p.id)}
                        noun="business"
                        nounPlural="businesses"
                    />

                    <div className="space-y-4">
                        {waiting.map((p: any) => (
                            <ProviderReviewRow
                                key={p.id}
                                provider={{ ...p, tradeLabel: tradeLabel(p.trade), logoUrl: p.logo ? getImageUrl(p.logo) : null, initials: initialsFor(p.business_name), calloutLine: calloutLine(p.callout_fee, p.callout_waived) }}
                                areas={areasFor(p.id)}
                                photoUrls={(p.photos || []).slice(0, 3).map((x: string) => getImageUrl(x))}
                                registrations={regsFor(p.id)}
                                blockers={blockersFor(p)}
                                emailVerified={verified.has(p.owner_id) ? verified.get(p.owner_id) : null}
                                skills={skillsFor(p.id).map((skill: any) => ({
                                    ...skill,
                                    public: skillIsPublic(skill, regsFor(p.id).map((r: any) => ({
                                        scheme: r.scheme,
                                        verified: r.verified,
                                    }))),
                                    reason: blockedSkillReason(skill, p.trade,
                                        skill.regulated_concept === 'electrical'
                                            ? p.trade === 'electrician'
                                            : asksAboutFuel(p.trade)),
                                }))}
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
                                    calloutLine: calloutLine(p.callout_fee, p.callout_waived),
                                }}
                                areas={areasFor(p.id)}
                                photoUrls={(p.photos || []).slice(0, 3).map((x: string) => getImageUrl(x))}
                                registrations={regsFor(p.id)}
                                blockers={blockersFor(p)}
                                emailVerified={verified.has(p.owner_id) ? verified.get(p.owner_id) : null}
                                skills={skillsFor(p.id).map((skill: any) => ({
                                    ...skill,
                                    public: skillIsPublic(skill, regsFor(p.id).map((r: any) => ({
                                        scheme: r.scheme,
                                        verified: r.verified,
                                    }))),
                                    reason: blockedSkillReason(skill, p.trade,
                                        skill.regulated_concept === 'electrical'
                                            ? p.trade === 'electrician'
                                            : asksAboutFuel(p.trade)),
                                }))}
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
                                provider={{ ...p, tradeLabel: tradeLabel(p.trade), logoUrl: p.logo ? getImageUrl(p.logo) : null, initials: initialsFor(p.business_name), calloutLine: calloutLine(p.callout_fee, p.callout_waived) }}
                                areas={areasFor(p.id)}
                                photoUrls={(p.photos || []).slice(0, 3).map((x: string) => getImageUrl(x))}
                                registrations={regsFor(p.id)}
                                blockers={blockersFor(p)}
                                emailVerified={verified.has(p.owner_id) ? verified.get(p.owner_id) : null}
                                skills={skillsFor(p.id).map((skill: any) => ({
                                    ...skill,
                                    public: skillIsPublic(skill, regsFor(p.id).map((r: any) => ({
                                        scheme: r.scheme,
                                        verified: r.verified,
                                    }))),
                                    reason: blockedSkillReason(skill, p.trade,
                                        skill.regulated_concept === 'electrical'
                                            ? p.trade === 'electrician'
                                            : asksAboutFuel(p.trade)),
                                }))}
                            />
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
