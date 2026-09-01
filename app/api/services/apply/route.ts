import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { adminClient, supabaseUrl } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { announceSubmission } from '@/lib/serviceSubmittedAlert';
import { TRADES, audienceForTrade } from '@/lib/serviceProviders';
import { withinLimits, callerAddress, GLOBAL_KEY } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

// One press: make the account, lodge the application.
//
// WHY THIS ROUTE EXISTS
//
// It used to take two. "Create account and send" made an account and sent a
// confirmation email, and the Finish screen asked them to open the link, come
// back, and press send a second time. A tradesman does not do that. Worse,
// anything that went wrong in between lost the application silently: the row
// was never written, so there was nothing to find and nothing to chase. That is
// exactly what happened on the first real walk through — a confirmation link
// went to the wrong page and the application simply did not exist.
//
// The obstacle was never the design, it was the session. With email
// confirmation switched on, signUp returns a user and NO session, so the
// browser had no identity to write the row with and the write had to wait for
// the link to be opened. This route does the writing instead, under the service
// role, on behalf of the account it has just made.
//
// VERIFICATION HAPPENS AFTERWARDS, ON ITS OWN TIME
//
// The account is created UNCONFIRMED — `email_confirm: false` — so
// `email_confirmed_at` stays null and stays honest. Supabase's own confirmation
// email is then asked for separately. Nothing about the application waits on it:
// the row is in the queue the moment this returns. What the applicant cannot do
// until they confirm is sign in and EDIT it, which is the right way round.
//
// The admin queue shows unverified applicants as such — see
// components/admin/ProviderReviewRow.tsx — with the caveat that it says nothing
// about the CONTACT address, which is a different field and never verified.
//
// WHAT THIS DOES NOT TOUCH
//
// No RLS changed for this. The service role is not subject to the column grants
// in 20260827185827_provider_status_grants.sql, which bind `authenticated`. A
// provider still cannot write their own `status` from the browser, and the
// `submit_service_provider` function is still how a signed-in provider
// re-submits. This route sets the status directly because it IS the platform,
// not somebody claiming to be.

interface Body {
    email?: string;
    password?: string;
    name?: string;
    provider?: Record<string, any>;
    areas?: any[];
    registrations?: any[];
    extras?: any[];
    prices?: any[];
    items?: any[];
    skills?: string[];
}

// Whitelists, not blacklists. Anything the browser sends that is not named here
// is dropped rather than trusted — `status`, `approved_digest`,
// `commission_rate` and the rest are the platform's, and an application arrives
// from a stranger by definition.
const PROVIDER_COLUMNS = [
    'business_name', 'trade', 'description', 'contact_email', 'contact_phone', 'sms_opt_out',
    'audience', 'photos', 'logo', 'does_gas', 'does_oil',
    'callout_fee', 'hourly_rate', 'callout_waived',
    'pricing_choice', 'billable_hourly_rate', 'covered_bands',
    // The one fixed price a guest-trade provider charges. Whitelisted like the
    // rest; commission_rate stays the platform's and is not here.
    'experience_price',
    // Who they are — a name, a line, a photo of them. Whitelisted so a
    // first-time applicant (who posts here, having no session yet) keeps them;
    // without this they were silently dropped for anyone applying fresh.
    'provider_name', 'based_line', 'headshot',
];

const AREA_COLUMNS = ['label', 'centre_lat', 'centre_lng', 'radius_miles'];
const EXTRA_COLUMNS = ['extra_key', 'offered', 'price', 'notes'];
const ITEM_COLUMNS = ['name', 'description', 'price', 'sort_order', 'active'];
const PRICE_COLUMNS = ['band_key', 'price', 'typical_hours'];

function pick(row: any, columns: string[]) {
    const out: any = {};
    for (const c of columns) if (row && row[c] !== undefined) out[c] = row[c];
    return out;
}

export async function POST(req: Request) {
    let createdUserId: string | null = null;

    try {
        const body: Body = await req.json();

        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');
        const name = String(body.name || '').trim();
        const incoming = body.provider || {};

        if (!email || !email.includes('@')) {
            return NextResponse.json({ ok: false, error: 'Give us an email address we can reach you on.' }, { status: 400 });
        }
        if (password.length < 8) {
            return NextResponse.json({ ok: false, error: 'Passwords need at least 8 characters.' }, { status: 400 });
        }

        const trade = String(incoming.trade || '');
        if (!TRADES.some((t: any) => t.key === trade)) {
            return NextResponse.json({ ok: false, error: 'Pick what kind of business this is.' }, { status: 400 });
        }
        if (!String(incoming.business_name || '').trim()) {
            return NextResponse.json({ ok: false, error: 'Your business needs a name.' }, { status: 400 });
        }

        // ------------------------------------------------------------------
        // HOW OFTEN A STRANGER MAY DO THIS
        //
        // There is no auth gate above and there cannot be one: a tradesman has
        // no account until this route makes them one. That leaves a public
        // route which, on every call, creates a real Supabase auth user and
        // asks Supabase to email it. The project's outbound mail is a single
        // shared allowance, so a loop against this address takes down password
        // resets and confirmations FOR THE WHOLE SITE. That is the failure
        // being prevented here — not the junk rows.
        //
        // Three limits, and the global one is the load-bearing half. Per-IP
        // alone is close to decorative, because the caller picks their own
        // address; a cap on the total bounds the damage however the requests
        // are spread.
        //
        // The numbers are deliberately generous for a real business. Twenty
        // applications an hour across the entire site is far more than this
        // has ever seen in a day, and it is nowhere near the mail allowance.
        // ------------------------------------------------------------------
        const verdict = await withinLimits([
            { bucket: 'services-apply:all', key: GLOBAL_KEY, max: 20, windowMinutes: 60 },
            { bucket: 'services-apply:ip', key: callerAddress(req.headers), max: 3, windowMinutes: 60 },
            { bucket: 'services-apply:email', key: email, max: 2, windowMinutes: 60 * 24 },
        ]);

        if (!verdict.ok) {
            // Reported every time. A tradesman does not hit this — three
            // applications in an hour from one address is not a person filling
            // in a form — so every one of these is either an attack or a real
            // problem with the form, and both want a human. If it is the
            // global limit, say so loudly: that is the one that means the
            // site's email is being aimed at.
            await logError(
                verdict.hit && verdict.hit.startsWith('services-apply:all')
                    ? '[services/apply] the SITE-WIDE application limit was hit — somebody may be '
                        + 'aiming at the outbound email allowance'
                    : '[services/apply] an applicant was rate limited',
                { limit: verdict.hit, email, trade },
                { path: 'services/apply' }
            );

            return NextResponse.json({
                ok: false,
                error: 'We have had a lot of applications just now. Please try again in an hour — '
                    + 'nothing you typed has been lost.',
            }, { status: 429 });
        }

        if (verdict.hit === 'unreadable') {
            // The limiter failed open rather than closing the shop. Said out
            // loud, because "the rate limit is not working" is not something
            // to find out from a bill.
            await logError(
                '[services/apply] the rate limit could not be read, so this application was let '
                    + 'through unchecked',
                null,
                { path: 'services/apply' }
            );
        }

        const admin = adminClient();

        // The account. Unconfirmed on purpose — see the note at the top.
        const { data: made, error: userError } = await admin.auth.admin.createUser({
            email,
            password,
            email_confirm: false,
            user_metadata: { name: name || incoming.business_name },
        });

        if (userError || !made || !made.user) {
            const message = String((userError && userError.message) || '');
            // The one worth translating. Everything else is ours to fix, not
            // theirs to decipher.
            if (/already|registered|exists/i.test(message)) {
                return NextResponse.json({
                    ok: false,
                    code: 'account_exists',
                    error: 'There is already an account on that address. Sign in below and we will save this to it.',
                }, { status: 409 });
            }
            await logError('service-apply-create-user', { email, message });
            return NextResponse.json({ ok: false, error: 'We could not make your account. Try again.' }, { status: 500 });
        }

        const owner = made.user.id;
        createdUserId = owner;

        await admin.from('profiles').upsert(
            { id: owner, email, full_name: name || incoming.business_name, is_host: false },
            { onConflict: 'id' }
        );

        // The application itself. Status and submitted_at are set here rather
        // than taken from the payload: this is the moment it was lodged, and
        // the applicant does not get a say in it.
        const row = {
            ...pick(incoming, PROVIDER_COLUMNS),
            owner_id: owner,
            audience: audienceForTrade(trade),
            status: 'pending_review',
            submitted_at: new Date().toISOString(),
            review_note: null,
            updated_at: new Date().toISOString(),
        };

        const { data: provider, error: rowError } = await admin
            .from('service_providers')
            .insert(row)
            .select('id, owner_id, business_name, logo, contact_email, contact_phone, trade, audience, photos, description, status, declined_at, approved_digest, changes_pending_at, does_gas, does_oil')
            .single();

        if (rowError || !provider) {
            await logError('service-apply-insert', { owner, message: rowError && rowError.message });
            return NextResponse.json({ ok: false, error: 'We made your account but could not save the application. Sign in and it will be waiting.' }, { status: 500 });
        }

        const id = provider.id;

        // The children. Written after the parent so a failure here leaves a
        // real application rather than an orphan, and reported rather than
        // swallowed — a listing that covers nowhere is not a listing.
        const areas = (body.areas || []).map((a) => ({ ...pick(a, AREA_COLUMNS), provider_id: id }));
        if (areas.length) await admin.from('service_areas').insert(areas);

        const extras = (body.extras || []).map((e) => ({ ...pick(e, EXTRA_COLUMNS), provider_id: id }));
        if (extras.length) await admin.from('service_provider_extras').insert(extras);

        const prices = (body.prices || []).map((p) => ({ ...pick(p, PRICE_COLUMNS), provider_id: id }));
        if (prices.length) await admin.from('service_provider_prices').insert(prices);

        // The menu — a guest trade's items. Whitelisted like the rest; the
        // browser cannot set provider_id, which is stamped here.
        const menuItems = (body.items || []).map((it) => ({ ...pick(it, ITEM_COLUMNS), provider_id: id }));
        if (menuItems.length) await admin.from('service_provider_items').insert(menuItems);

        // Registrations carry no verified columns from here. They cannot: the
        // whole point of 20260825205043_trade_registration.sql is that only an admin
        // decision writes those, and a fresh application has had none.
        const regs = (body.registrations || [])
            .map((r: any) => ({
                provider_id: id,
                scheme: String(r.scheme || ''),
                number: String(r.number || '').trim(),
                updated_at: new Date().toISOString(),
            }))
            .filter((r) => r.scheme && r.number);
        if (regs.length) await admin.from('service_provider_registrations').insert(regs);

        // Skills go through their own route for a reason — `regulated_concept`
        // is what stops a handyman tagging "boiler repair" — and that reason
        // holds here, so the same table is written the same way.
        const labels = (body.skills || []).map((l) => String(l || '').trim()).filter(Boolean);
        if (labels.length) {
            const { data: known } = await admin
                .from('service_skills')
                .select('id, label, slug')
                .is('merged_into', null);

            const bySlug = new Map((known || []).map((s: any) => [String(s.label).toLowerCase(), s.id]));
            const rows = labels
                .map((l) => bySlug.get(l.toLowerCase()))
                .filter(Boolean)
                .map((skill_id) => ({ provider_id: id, skill_id }));

            if (rows.length) await admin.from('service_provider_skills').insert(rows);
        }

        // Now ask Supabase to send the confirmation email. Deliberately after
        // the row: if the mail fails, the application is still lodged and the
        // failure is ours to chase, not a reason to lose their work.
        //
        // An anon client, because this is the ordinary signup confirmation and
        // the service role does not send one. resend() takes no code challenge,
        // so the link is a plain token hash and opens on any device.
        //
        // WHETHER IT WENT IS REPORTED, NOT ASSUMED. The panel used to say "we
        // have also sent a link" whatever happened here, and that is a lie the
        // applicant cannot check: they wait for an email that was never
        // accepted. Two ways it fails on test alone — the built-in SMTP is rate
        // limited to a handful an hour for the whole project, and addresses on
        // reserved TLDs like .test are refused outright as invalid.
        let verificationEmailed = false;
        try {
            const anon = createClient(supabaseUrl(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '', {
                auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
            });
            const origin = new URL(req.url).origin;
            const { error: mailError } = await anon.auth.resend({
                type: 'signup',
                email,
                options: { emailRedirectTo: `${origin}/auth/callback?next=/services/join?trade=${encodeURIComponent(trade)}` },
            });
            if (mailError) await logError('service-apply-verification-email', { owner, message: mailError.message });
            else verificationEmailed = true;
        } catch (err: any) {
            await logError('service-apply-verification-email', { owner, message: String(err && err.message) });
        }

        // And tell us. Same implementation the signed-in route uses.
        try {
            await announceSubmission(provider);
        } catch (err: any) {
            await logError('service-apply-alert', { provider: id, message: String(err && err.message) });
        }

        return NextResponse.json({ ok: true, providerId: id, email, verificationEmailed });
    } catch (err: any) {
        await logError('service-apply', { createdUserId, error: String(err && err.message) });
        return NextResponse.json({ ok: false, error: 'Something went wrong. Try again.' }, { status: 500 });
    }
}
