import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import {
    AGREEMENTS,
    AGREEMENT_ORDER,
    AgreementKey,
    agreementProblem,
    currentFrom,
    hasAgreed,
    isAgreementKey,
    nextOwed,
    nextRoleOwed,
    requiredAgreements,
} from '@/lib/agreements';
import { recordAcceptance, recordedAgreements, roleFacts } from '@/lib/agreementRecords';

export const dynamic = 'force-dynamic';

// The one route that records an agreement (the host's first-submit record in
// /api/listings/publish is the other door, for the same table).
//
// GET  — what the signed-in account has agreed to, and the ONE document the
//        sign-in prompt should show next (null when nothing is owed).
// POST — { document, version }: record acceptance of the current version.
//        Refused, with the same words the tick box shows, when the version is
//        missing (the box was not ticked) or stale (the page is older than the
//        wording). lib/agreements' agreementProblem is the rule, shared with
//        every tick box in the browser.
//
// getUser(), never getSession(): the acceptance is recorded against whoever the
// auth server says this is, not a cookie the caller could write.

async function caller() {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    return user || null;
}

export async function GET() {
    const user = await caller();
    if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

    try {
        const admin = adminClient();
        const recorded = await recordedAgreements(admin, user.id);

        // An account made through the password sign-up box ticked the Terms of
        // Service there, but with email confirmation on there was no session to
        // record it with. The box put the version it showed on the auth user;
        // it is recorded here, the first time they are signed in, rather than
        // asking them to tick the same box twice.
        const signupVersion = user.user_metadata && user.user_metadata.agreed_guest_terms_version;
        if (!currentFrom('guest', recorded.guest) && hasAgreed('guest', signupVersion)) {
            const { error } = await recordAcceptance(admin, user.id, 'guest', 'signup');
            if (!error) (recorded.guest = recorded.guest || []).push(signupVersion);
        }

        const roles = await roleFacts(admin, user.id);
        // `earlier`: they accepted an older version — the prompt says the
        // document has changed rather than introducing it.
        // `required`: this account's role needs it (the dashboard update notice
        // shows only for a required role agreement not agreed at this version).
        const owed = requiredAgreements(roles);
        const documents: Record<string, { version: string; agreed: boolean; earlier: boolean; required: boolean }> = {};
        for (const key of AGREEMENT_ORDER) {
            const agreed = !!currentFrom(key, recorded[key]);
            documents[key] = { version: AGREEMENTS[key].version, agreed, earlier: !agreed && (recorded[key] || []).length > 0, required: owed.indexOf(key) !== -1 };
        }
        // `next` is the next document owed at all (Guest Terms first) — kept for
        // callers that still want it. `nextRole` is what the sign-in prompt now
        // shows: the next ROLE agreement owed, never the Guest Terms, which are
        // taken at the end of sign-up and at first stay checkout instead of as a
        // mid-sign-up interrupt.
        return NextResponse.json({
            ok: true,
            documents,
            next: nextOwed(roles, recorded),
            nextRole: nextRoleOwed(roles, recorded),
        });
    } catch (err: any) {
        await logError('agreements: status could not be read', err, { path: 'api/agreements', userId: user.id });
        return NextResponse.json({ ok: false, error: 'Could not check your agreements.' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const user = await caller();
    if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const document = body && body.document;
    const submitted = body && typeof body.version === 'string' ? body.version : null;

    if (!isAgreementKey(document)) {
        return NextResponse.json({ ok: false, error: 'Unknown agreement.' }, { status: 400 });
    }
    const key: AgreementKey = document;

    try {
        const admin = adminClient();
        const recorded = await recordedAgreements(admin, user.id);
        const onRecord = currentFrom(key, recorded[key]);

        // THE WALL. No tick (no version), or a stale page (an old version), is
        // refused here whatever the browser did.
        const problem = agreementProblem(key, null, submitted);
        if (problem && !onRecord) {
            return NextResponse.json(
                { ok: false, needsAgreement: true, document: key, version: AGREEMENTS[key].version, error: problem },
                { status: 400 },
            );
        }

        if (!onRecord) {
            const source = typeof body.source === 'string' ? body.source.slice(0, 40) : 'prompt';
            const { error } = await recordAcceptance(admin, user.id, key, source);
            if (error) {
                await logError('agreements: acceptance not recorded', error, { path: 'api/agreements', userId: user.id });
                return NextResponse.json({ ok: false, error: 'We couldn’t save that. Please try again.' }, { status: 500 });
            }
        }

        return NextResponse.json({ ok: true, document: key, version: AGREEMENTS[key].version });
    } catch (err: any) {
        await logError('agreements: acceptance failed', err, { path: 'api/agreements', userId: user.id });
        return NextResponse.json({ ok: false, error: 'We couldn’t save that. Please try again.' }, { status: 500 });
    }
}
