import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { TRADES } from '@/lib/serviceProviders';
import { withinLimits, callerAddress, GLOBAL_KEY } from '@/lib/rateLimit';
import { sendEmail } from '@/lib/email';
import { mintToken, verificationEmail, alreadyHaveAccountEmail } from '@/lib/serviceApplications';

export const dynamic = 'force-dynamic';

// One press: lodge the application. The account waits until the address is proved.
//
// WHAT THIS USED TO DO, AND WHY IT COULD NOT STAY
//
// It created a real Supabase auth user on the first press, from a public form,
// with nothing showing that the person filling it in owned the address they
// typed. So a stranger could put your email into it and you had an account you
// never made: you could not sign up later, because the address was taken, and
// you got a confirmation email you never asked for. The rate limits below bound
// the volume. They do nothing about one deliberate squat.
//
// Now the application goes into service_applications — a table no browser role
// can read — and /api/services/finish makes the account when the emailed link
// is opened by somebody who has demonstrably received mail there.
//
// WHAT IS KEPT FROM THE OLD DESIGN, ON PURPOSE
//
// The reason this was one press in the first place was that the two-press
// version LOST people: the row was never written, so a failure in between left
// nothing to find and nothing to chase. That failure is not reintroduced. The
// application row is written before any email is sent, so an applicant who
// never opens the link is still a person you can see and ring — see the
// "Waiting on the applicant" list on /admin/providers.
//
// NOBODY IS TOLD WHETHER AN ADDRESS HAS AN ACCOUNT
//
// The old route answered a 409 saying "there is already an account on that
// address", which is an oracle any stranger could query for any address. Both
// cases now return exactly the same thing, and the difference is carried in the
// email — which only the address's owner can read.
//
// WHAT THIS DOES NOT TOUCH
//
// No RLS changed for this. service_applications has RLS on and no policies at
// all, with the grants revoked: PostgREST does not admit it exists to anon.
// The service role is not subject to either.

interface Body {
    email?: string;
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
    // What a food business can cater for, in their own words. Shown on the
    // listing; empty reads as "hasn't said" there rather than as "fine".
    'dietary_note',
];

const AREA_COLUMNS = ['label', 'centre_lat', 'centre_lng', 'radius_miles'];
const EXTRA_COLUMNS = ['extra_key', 'offered', 'price', 'notes'];
const PRICE_COLUMNS = ['band_key', 'price', 'typical_hours'];
// A guest trade's menu — one item for a chef, many for a baker. Whitelisted like
// the rest; provider_id is stamped when the payload is materialised at /finish,
// never taken from the browser.
const ITEM_COLUMNS = ['name', 'description', 'price', 'unit', 'image', 'sort_order', 'active'];

function pick(row: any, columns: string[]) {
    const out: any = {};
    for (const c of columns) if (row && row[c] !== undefined) out[c] = row[c];
    return out;
}

export async function POST(req: Request) {
    try {
        const body: Body = await req.json();

        const email = String(body.email || '').trim().toLowerCase();
        const name = String(body.name || '').trim();
        const incoming = body.provider || {};

        if (!email || !email.includes('@')) {
            return NextResponse.json({ ok: false, error: 'Give us an email address we can reach you on.' }, { status: 400 });
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

        // Whether this address already has an account decides which email is
        // sent and nothing else. It is never in the response — see the header.
        let addressHasAccount = false;
        try {
            const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
            addressHasAccount = ((existing && existing.users) || []).some(
                (u: any) => String(u.email || '').toLowerCase() === email
            );
        } catch (err: any) {
            // Unreadable is not "no". Falling through sends the ordinary link,
            // which fails safely at /finish if an account does turn out to
            // exist — that route refuses rather than making a second one.
            await logError('service-apply-account-check', { email, message: String(err && err.message) });
        }

        const { token, hash } = mintToken();

        // The application, before any email goes. This ordering is the whole
        // reason the old two-press flow lost people, and it is not repeated:
        // if the mail fails, the work is still here and still chaseable.
        const { data: application, error: appError } = await admin
            .from('service_applications')
            .insert({
                email,
                name: name || null,
                trade,
                business_name: String(incoming.business_name || '').trim(),
                contact_phone: String(incoming.contact_phone || '').trim() || null,
                payload: {
                    provider: pick(incoming, PROVIDER_COLUMNS),
                    areas: (body.areas || []).map((a) => pick(a, AREA_COLUMNS)),
                    extras: (body.extras || []).map((e) => pick(e, EXTRA_COLUMNS)),
                    prices: (body.prices || []).map((p) => pick(p, PRICE_COLUMNS)),
                    items: (body.items || []).map((it: any) => pick(it, ITEM_COLUMNS)),
                    registrations: (body.registrations || []).map((r: any) => ({
                        scheme: String(r.scheme || ''),
                        number: String(r.number || '').trim(),
                    })).filter((r: any) => r.scheme && r.number),
                    skills: (body.skills || []).map((l: any) => String(l || '').trim()).filter(Boolean),
                },
                token_hash: hash,
            })
            .select('id, email, business_name')
            .single();

        if (appError || !application) {
            await logError('service-apply-insert', { email, message: appError && appError.message });
            return NextResponse.json({
                ok: false,
                error: 'We could not save your application. Nothing has been lost from this page — try again.',
            }, { status: 500 });
        }

        // WHETHER IT WENT IS REPORTED, NOT ASSUMED. The panel used to say "we
        // have also sent a link" whatever happened, which is a claim the
        // applicant cannot check: they wait for an email that was never
        // accepted.
        const mail = addressHasAccount
            ? alreadyHaveAccountEmail(application)
            : verificationEmail(application, token, new URL(req.url).origin);

        let verificationEmailed = false;
        try {
            verificationEmailed = await sendEmail(application.email, mail.subject, mail.html);
            if (!verificationEmailed) {
                await logError('service-apply-verification-email', {
                    application: application.id,
                    message: 'sendEmail returned false',
                });
            }
        } catch (err: any) {
            await logError('service-apply-verification-email', {
                application: application.id,
                message: String(err && err.message),
            });
        }

        // NOBODY IS TOLD ABOUT THIS ONE YET.
        //
        // announceSubmission used to fire here. It now fires when the link is
        // opened, because an application nobody has proved is not something to
        // put in front of a person — the review queue filling with unverified
        // strangers is the noise this change exists to prevent. What is waiting
        // on its applicant shows on /admin/providers instead.
        return NextResponse.json({
            ok: true,
            applicationId: application.id,
            email,
            verificationEmailed,
        });
    } catch (err: any) {
        await logError('service-apply', { error: String(err && err.message) });
        return NextResponse.json({ ok: false, error: 'Something went wrong. Try again.' }, { status: 500 });
    }
}
