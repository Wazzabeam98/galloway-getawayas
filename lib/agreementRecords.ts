// Reading and writing agreement acceptances — server only, with the service
// role. The rules themselves are in lib/agreements.ts; this is the storage.
//
// public.agreement_acceptances has RLS on and no browser write grant, so these
// run through the admin client passed in. A signed-in user may SELECT their own
// rows (RLS), but nothing in the app relies on that.

import { AGREEMENTS, AgreementKey, RoleFacts, isAgreementKey } from './agreements';

export type Recorded = Partial<Record<AgreementKey, string[]>>;

// Every version of every document this account has accepted, plus the legacy
// host record on profiles (written by /api/listings/publish before the table
// existed; the migration backfilled it, and the publish route still writes it).
export async function recordedAgreements(admin: any, userId: string): Promise<Recorded> {
    const out: Recorded = {};
    const add = (key: AgreementKey, version: string | null | undefined) => {
        if (!version) return;
        const list = out[key] || (out[key] = []);
        if (list.indexOf(version) === -1) list.push(version);
    };

    const { data: rows } = await admin
        .from('agreement_acceptances')
        .select('document, version')
        .eq('user_id', userId);
    for (const r of (rows as any[]) || []) {
        if (r && isAgreementKey(r.document)) add(r.document, r.version);
    }

    const { data: prof } = await admin
        .from('profiles')
        .select('host_terms_version')
        .eq('id', userId)
        .maybeSingle();
    if (prof) add('host', (prof as any).host_terms_version);

    return out;
}

// What this account is, for which role agreements it owes. A draft is not a
// role yet — they accept at the end of that sign-up.
export async function roleFacts(admin: any, userId: string): Promise<RoleFacts> {
    const { data: listings } = await admin
        .from('listings')
        .select('id')
        .eq('host_id', userId)
        .in('status', ['pending_review', 'published', 'hidden'])
        .limit(1);

    const { data: providers } = await admin
        .from('service_providers')
        .select('audience')
        .eq('owner_id', userId)
        .in('status', ['pending_review', 'approved']);

    const rows = ((providers as any[]) || []);
    return {
        isHost: ((listings as any[]) || []).length > 0,
        isExperienceProvider: rows.some((p) => p && p.audience === 'guest'),
        isTradesperson: rows.some((p) => p && p.audience !== 'guest'),
    };
}

// Record one acceptance of the CURRENT version. Idempotent: the table is unique
// on (user, document, version), so accepting twice records once. The caller has
// already checked agreementProblem — this does not decide anything.
export async function recordAcceptance(
    admin: any,
    userId: string,
    key: AgreementKey,
    source: string,
): Promise<{ error: any }> {
    const version = AGREEMENTS[key].version;
    const now = new Date().toISOString();
    const { error } = await admin
        .from('agreement_acceptances')
        .upsert(
            { user_id: userId, document: key, version, accepted_at: now, source },
            { onConflict: 'user_id,document,version', ignoreDuplicates: true },
        );
    if (error) return { error };

    // The host record on profiles is still what /api/listings/publish reads, so
    // a host who accepts from the sign-in prompt is not asked again at publish.
    if (key === 'host') {
        const { error: profErr } = await admin
            .from('profiles')
            .update({ host_terms_version: version, host_terms_agreed_at: now })
            .eq('id', userId);
        if (profErr) return { error: profErr };
    }
    return { error: null };
}
