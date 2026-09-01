import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { announceSubmission } from '@/lib/serviceSubmittedAlert';
import { audienceForTrade } from '@/lib/serviceProviders';
import { hashToken, linkExpired, ApplicationRow } from '@/lib/serviceApplications';

export const dynamic = 'force-dynamic';

// The moment the address is proved, and therefore the moment the account is made.
//
// Opening the emailed link is the proof: it went to one address and came back.
// Everything the old /api/services/apply did on its first press happens here
// instead — the auth user, the profile, the service_providers row and its
// children, and the alert to the directors.
//
// The account is created CONFIRMED. It has just been proved by the only method
// that ever proved it, and asking Supabase to send a second confirmation to an
// address that has demonstrably received one would be theatre.
//
// WHAT THIS REFUSES, AND WHY EACH ONE
//
//   no such token      somebody is guessing, or the application was swept
//   expired            past LINK_DAYS; the page offers a new one, this does not
//   already claimed    the link is single-use; a replay makes nothing
//   account exists     the address gained an account between applying and
//                      finishing. Making a second one is impossible and
//                      overwriting the first would be a takeover.
//
// The first three answer identically on purpose. A caller holding a token that
// does not work should not learn WHICH kind of not-working it is — that is the
// difference between "this link is old" and an enumeration oracle over every
// token we have ever issued.

const UNUSABLE = {
    ok: false as const,
    code: 'link_unusable',
    error: 'That link does not work any more. Open it again from your email and we will send you a new one.',
};

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const token = String(body.token || '').trim();
        const password = String(body.password || '');

        if (!token) return NextResponse.json(UNUSABLE, { status: 400 });
        if (password.length < 8) {
            return NextResponse.json({
                ok: false,
                error: 'Passwords need at least 8 characters.',
            }, { status: 400 });
        }

        const admin = adminClient();

        const { data: application } = await admin
            .from('service_applications')
            .select('id, email, name, trade, business_name, contact_phone, payload, token_sent_at, created_at, claimed_at, provider_id')
            .eq('token_hash', hashToken(token))
            .maybeSingle();

        const row = application as ApplicationRow | null;

        if (!row || row.claimed_at || linkExpired(row)) {
            return NextResponse.json(UNUSABLE, { status: 400 });
        }

        const payload = row.payload || {};
        const incoming = payload.provider || {};

        // ------------------------------------------------------------------
        // The account.
        // ------------------------------------------------------------------
        const { data: made, error: userError } = await admin.auth.admin.createUser({
            email: row.email,
            password,
            email_confirm: true,
            user_metadata: { name: row.name || row.business_name },
        });

        if (userError || !made || !made.user) {
            const message = String((userError && userError.message) || '');

            // Told plainly here, and only here. This is somebody holding a
            // valid link to their own address, so there is no oracle in
            // answering them — they have already proved the address is theirs.
            if (/already|registered|exists/i.test(message)) {
                return NextResponse.json({
                    ok: false,
                    code: 'account_exists',
                    error: 'You already have an account on this address. Sign in and your application will be waiting.',
                }, { status: 409 });
            }

            await logError('service-finish-create-user', { application: row.id, message });
            return NextResponse.json({
                ok: false,
                error: 'We could not make your account. Nothing has been lost — try again in a moment.',
            }, { status: 500 });
        }

        const owner = made.user.id;

        await admin.from('profiles').upsert(
            { id: owner, email: row.email, full_name: row.name || row.business_name, is_host: false },
            { onConflict: 'id' }
        );

        // ------------------------------------------------------------------
        // The application itself. Status and submitted_at are set here rather
        // than taken from the payload: this is the moment it was lodged with a
        // proved address, and the applicant does not get a say in it.
        // ------------------------------------------------------------------
        const { data: provider, error: rowError } = await admin
            .from('service_providers')
            .insert({
                ...incoming,
                owner_id: owner,
                audience: audienceForTrade(row.trade),
                trade: row.trade,
                status: 'pending_review',
                submitted_at: new Date().toISOString(),
                review_note: null,
                updated_at: new Date().toISOString(),
            })
            .select('id, owner_id, business_name, logo, contact_email, contact_phone, trade, audience, photos, description, status, declined_at, approved_digest, changes_pending_at, does_gas, does_oil')
            .single();

        if (rowError || !provider) {
            await logError('service-finish-insert', { application: row.id, owner, message: rowError && rowError.message });
            return NextResponse.json({
                ok: false,
                error: 'We made your account but could not save the application. Sign in and it will be waiting.',
            }, { status: 500 });
        }

        const id = provider.id;

        // The children. Written after the parent so a failure here leaves a
        // real application rather than an orphan.
        const areas = (payload.areas || []).map((a: any) => ({ ...a, provider_id: id }));
        if (areas.length) await admin.from('service_areas').insert(areas);

        const extras = (payload.extras || []).map((e: any) => ({ ...e, provider_id: id }));
        if (extras.length) await admin.from('service_provider_extras').insert(extras);

        const prices = (payload.prices || []).map((p: any) => ({ ...p, provider_id: id }));
        if (prices.length) await admin.from('service_provider_prices').insert(prices);

        // The menu — a guest trade's items, one for a chef, many for a baker.
        // Stamped with provider_id here, the same as the other children.
        const items = (payload.items || []).map((it: any) => ({ ...it, provider_id: id }));
        if (items.length) await admin.from('service_provider_items').insert(items);

        // Registrations carry no verified columns from here — only an admin
        // decision writes those, and a fresh application has had none.
        const regs = (payload.registrations || []).map((r: any) => ({
            provider_id: id,
            scheme: String(r.scheme || ''),
            number: String(r.number || '').trim(),
            updated_at: new Date().toISOString(),
        })).filter((r: any) => r.scheme && r.number);
        if (regs.length) await admin.from('service_provider_registrations').insert(regs);

        // Skills go through the known list, because `regulated_concept` is what
        // stops a handyman tagging "boiler repair".
        const labels: string[] = payload.skills || [];
        if (labels.length) {
            const { data: known } = await admin
                .from('service_skills')
                .select('id, label')
                .is('merged_into', null);

            const bySlug = new Map((known || []).map((sk: any) => [String(sk.label).toLowerCase(), sk.id]));
            const rows = labels
                .map((l) => bySlug.get(String(l).toLowerCase()))
                .filter(Boolean)
                .map((skill_id) => ({ provider_id: id, skill_id }));

            if (rows.length) await admin.from('service_provider_skills').insert(rows);
        }

        // Claimed last. If anything above failed we did not get here, and the
        // row stays on the chase list rather than disappearing having done
        // nothing — which is the direction that loses a person quietly.
        const { error: claimError } = await admin
            .from('service_applications')
            .update({ claimed_at: new Date().toISOString(), provider_id: id })
            .eq('id', row.id);

        if (claimError) {
            // Not fatal to the applicant: their account and listing both exist.
            // It leaves them on a chase list they are no longer on, which is
            // visible and wrong in the harmless direction.
            await logError('service-finish-claim', { application: row.id, provider: id, message: claimError.message });
        }

        // And tell us — now, rather than when it was typed. An application
        // nobody has proved is not something to put in front of a person.
        try {
            await announceSubmission(provider);
        } catch (err: any) {
            await logError('service-finish-alert', { provider: id, message: String(err && err.message) });
        }

        return NextResponse.json({ ok: true, providerId: id, email: row.email });
    } catch (err: any) {
        await logError('service-finish', { error: String(err && err.message) });
        return NextResponse.json({ ok: false, error: 'Something went wrong. Try again.' }, { status: 500 });
    }
}
