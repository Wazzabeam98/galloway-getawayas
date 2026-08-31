import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { logError } from '@/lib/logError';
import { idsFrom, decideBatch, MAX_BATCH } from '@/lib/reviewQueue';
import {
    reviewDigest, registrationBlockers, schemeLabel,
    planForTrade, TRIAL_DAYS, SUBSCRIPTION_MONTHLY,
} from '@/lib/serviceProviders';

export const dynamic = 'force-dynamic';

// The reason, set apart from our own words.
//
// It used to be a plain paragraph in the same size and colour as the two
// sentences either side of it, so a short reason — "no" is a real one somebody
// typed — read as part of our sentence rather than as a quote of ours. Indented
// behind a rule, it is obviously the thing we said.
//
// Newlines survive as <br>: HTML collapses them, so a reason typed over three
// lines otherwise arrives as one. Escaped first, so the <br> we add is the only
// markup that gets through.
function quoted(note: string): string {
    const body = escapeHtml(note).split('\n').join('<br>');

    return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px;">'
        + '<tr><td style="border-left:4px solid #e5e7eb;padding:2px 0 2px 16px;">'
        + '<p style="margin:0;font-size:16px;color:#374151;">' + body + '</p>'
        + '</td></tr></table>';
}


// Approving or declining a business application.
//
// A route rather than a write from the browser, for two reasons: the decision
// has to be checked against `is_admin` on the server, and approving sends an
// email. Neither belongs in a client component.
export async function POST(req: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });

        // getUser() asks the auth server. getSession() would only decode the
        // cookie, so anyone could claim to be an admin by editing it.
        const { data: auth } = await supabase.auth.getUser();
        if (!auth || !auth.user) {
            return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
        }

        const admin = adminClient();

        const { data: me } = await admin
            .from('profiles')
            .select('is_admin')
            .eq('id', auth.user.id)
            .maybeSingle();

        if (!me || me.is_admin !== true) {
            return NextResponse.json({ ok: false, error: 'Not allowed.' }, { status: 403 });
        }

        // One decision, as data rather than as a Response, so the same code
        // answers a single press and a batch. See lib/reviewQueue.ts.
        const decideOne = async (body: any): Promise<{ status: number; body: any }> => {
            const id = String(body.id || '');
            const decision = String(body.decision || '');
            const note = String(body.note || '').trim();
            const hide = body.hide === true;

            // Four decisions, not two. An application is approved or declined;
            // a live provider's edits are accepted or turned down. They are named
            // separately rather than inferred from the row, so a click made
            // against a stale screen is refused instead of doing the other thing.
            const DECISIONS = [
                'approve', 'decline', 'approve_changes', 'decline_changes', 'verify_registration',
                // Whose business it is. Not a decision about an application, but
                // it belongs on this route for the same reason the others do: it
                // has to be checked against is_admin on the server, and it is not
                // a thing a provider may do to their own row.
                'make_in_house', 'make_external',
            ];

            if (!id || DECISIONS.indexOf(decision) === -1) {
                return { status: 400, body: { ok: false, error: 'Nothing to decide.' } };
            }

            const declining = decision === 'decline' || decision === 'decline_changes';

            if (declining && !note) {
                return { status: 400, body: { ok: false, error: 'A decline needs a reason — it is sent to them.' } };
            }

            const { data: provider } = await admin
                .from('service_providers')
                .select('id, business_name, logo, contact_email, status, approved_digest, changes_pending_at, trade, description, audience, photos, does_gas, does_oil, plan, trial_ends_at, kind, pricing_choice, billable_hourly_rate, covered_bands')
                .eq('id', id)
                .maybeSingle();

            if (!provider) {
                return { status: 404, body: { ok: false, error: 'That business no longer exists.' } };
            }

            const { data: regRows } = await admin
                .from('service_provider_registrations')
                .select('provider_id, scheme, number, verified_at, verified_number, expires_at')
                .eq('provider_id', id);

            const registrations = regRows || [];

            // IN-HOUSE, OR SOMEBODY ELSE'S BUSINESS
            //
            // `kind` decides two things that matter: whether the cleaner may be
            // paid by the hour, and whether commission is taken at all. It used to
            // be settable only by editing the row in production by hand, which is
            // the wrong tool for a setting of that weight — no check on who did
            // it, and no record that it happened.
            //
            // Not emailed. It changes nothing the provider sees or agreed to; it
            // says whose business this is.
            if (decision === 'make_in_house' || decision === 'make_external') {
                const toInHouse = decision === 'make_in_house';
                const now = new Date().toISOString();

                const patch: any = { kind: toInHouse ? 'in_house' : 'external', updated_at: now };

                // Flipping an hourly cleaner back to external.
                //
                // The database refuses the flip on its own -- the check says
                // hourly is cleaning AND in-house -- so without this the owner
                // would get a raw constraint error and no idea what to do. Worse
                // would be clearing the hourly fields regardless: she would land
                // on the banded model with no band prices, and a banded provider
                // with no prices covers no size and disappears from every search
                // while looking perfectly complete on screen.
                //
                // So it is handled where handling is safe and refused where it is
                // not. Safe means she already has at least one band price to fall
                // back onto.
                if (!toInHouse && String(provider.pricing_choice || '') === 'hourly') {
                    const { data: bandRows } = await admin
                        .from('service_provider_prices')
                        .select('band_key, price')
                        .eq('provider_id', id);

                    const priced = (bandRows || []).filter((r: any) => Number(r.price) > 0);

                    if (priced.length === 0) {
                        return { status: 409, body: {
                                ok: false,
                                error: 'She is paid by the hour and has no prices per house size to fall back on. '
                                    + 'Ask her to set at least one size price first — otherwise she would go '
                                    + 'external with nothing priced and stop appearing in any search.',
                            } };
                    }

                    // One statement, because the check constraint is evaluated
                    // against the finished row: moving `kind` without moving
                    // `pricing_choice` in the same update is what it refuses.
                    patch.pricing_choice = 'bands';
                    patch.billable_hourly_rate = null;
                    patch.covered_bands = [];
                }

                const { error: kindError } = await admin
                    .from('service_providers')
                    .update(patch)
                    .eq('id', id);

                if (kindError) {
                    return { status: 500, body: { ok: false, error: kindError.message } };
                }

                // Logged the way the other admin actions here are, and with the
                // user on it: this decides a pricing model and whether commission
                // is charged, so who changed it is the point of recording it.
                await logError(
                    'service-provider-kind-changed',
                    {
                        provider: id,
                        business: provider.business_name || null,
                        trade: provider.trade || null,
                        from: provider.kind || 'external',
                        to: patch.kind,
                        hourly_cleared: patch.pricing_choice === 'bands',
                    },
                    { path: '/api/admin/providers', userId: auth.user.id }
                );

                return { status: 200, body: {
                    ok: true,
                    emailed: false,
                    kind: patch.kind,
                    hourlyCleared: patch.pricing_choice === 'bands',
                } };
            }

            // Recording that a number has been checked. Its own decision because
            // it is its own act — done in another tab, against the register
            // itself, and it might still end in a decline.
            //
            // `verified_number` is stamped from the row as it stands, which is the
            // number that was just looked up. That is what makes the tick mean
            // something: edit the number afterwards and it stops matching, so the
            // listing is unverified again without anybody having to remember.
            if (decision === 'verify_registration') {
                const scheme = String(body.scheme || '');
                const found = registrations.filter((r: any) => String(r.scheme || '') === scheme)[0];

                if (!found) {
                    return { status: 404, body: { ok: false, error: 'They have not given a number for that scheme.' } };
                }

                const expires = String(body.expires_at || '').trim();

                const { error: verifyError } = await admin
                    .from('service_provider_registrations')
                    .update({
                        verified_at: new Date().toISOString(),
                        verified_by: auth.user.id,
                        verified_number: found.number,
                        expires_at: expires || null,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('provider_id', id)
                    .eq('scheme', scheme);

                if (verifyError) {
                    return { status: 500, body: { ok: false, error: verifyError.message } };
                }

                // Nothing is emailed. The business is told when the decision goes
                // out; being told their number was looked at is noise.
                return { status: 200, body: { ok: true, emailed: false, verified: schemeLabel(scheme) } };
            }

            // Nothing restricted goes live unchecked.
            //
            // The screen disables the button for the same reason and off the same
            // function, but a disabled button is a courtesy — this is the control.
            // A stale tab, a second click, or somebody who has edited their number
            // since the page loaded all arrive here.
            if (decision === 'approve') {
                const stops = registrationBlockers(provider, registrations);

                if (stops.length > 0) {
                    return { status: 409, body: { ok: false, error: stops.join(' ') } };
                }
            }

            const decidingChanges = decision === 'approve_changes' || decision === 'decline_changes';

            // A decision has to match the state it was made against. Without this,
            // a second click on a slow connection would decide twice and send two
            // emails — and approving an application from a screen that has since
            // gone live would clear the wrong thing.
            const expected = decidingChanges ? 'approved' : 'pending_review';

            if (provider.status !== expected) {
                return { status: 409, body: { ok: false, error: 'That has already been decided.' } };
            }

            if (decidingChanges && !provider.changes_pending_at) {
                return { status: 409, body: { ok: false, error: 'There are no changes waiting on that one.' } };
            }

            const now = new Date().toISOString();

            // The digest is stamped from the row as it stands, which is what has
            // just been looked at. It is written here and nowhere else — that is
            // what stops a provider deciding for themselves that their own edits
            // need no review.
            const digest = reviewDigest(provider);

            let patch: any;

            if (decision === 'approve') {
                patch = {
                    status: 'approved', approved_at: now, declined_at: null, review_note: null,
                    approved_digest: digest, changes_pending_at: null, updated_at: now,
                };

                // What they pay, settled in the same write that puts them live.
                //
                // THE CLOCK NO LONGER STARTS HERE. It used to: approval stamped
                // `trial_ends_at`, on the reasoning that approval is when the
                // promise is made. The trouble is that approval is not when the
                // value arrives. A tradesman approved in September who hears
                // nothing until January would have spent his whole free period
                // waiting for us to find him work, which is a bill for our own
                // lack of traffic.
                //
                // So the stamp lives at the first enquiry instead — see
                // app/api/services/enquiries/route.ts, and trialEndsAt in
                // lib/serviceProviders.ts for the reasoning. The guard that went
                // with it ("only if it is null") went with it too; it is doing
                // the same job in the new place.
                //
                // What still belongs here is the plan, re-derived from the trade
                // rather than trusted off the row. `plan` has a column default of
                // 'commission' and the row is written from the browser, so what
                // is sitting there is whatever the default happened to be when
                // they started — which for a plumber is wrong.
                const plan = planForTrade(String(provider.trade || ''));
                patch.plan = plan;

                if (plan === 'subscription') {
                    // Whatever is in the column, a subscription provider is 0%.
                    // The default is 0.10 and a row written before the plan
                    // existed is still carrying it.
                    patch.commission_rate = 0;
                }
            } else if (decision === 'decline') {
                patch = { status: 'declined', declined_at: now, review_note: note, updated_at: now };
            } else if (decision === 'approve_changes') {
                // Still live, still approved — the edits were already on the site.
                // All that changes is that they have now been seen.
                patch = { approved_digest: digest, changes_pending_at: null, review_note: null, updated_at: now };
            } else {
                // Turned down. Hiding is a separate choice: some edits are worth a
                // word and some cannot stay up. The digest still moves, because
                // this version has been looked at and should not come back round.
                patch = {
                    review_note: note, changes_pending_at: null, approved_digest: digest, updated_at: now,
                };
                if (hide) patch.status = 'hidden';
            }

            const { error: writeError } = await admin
                .from('service_providers')
                .update(patch)
                .eq('id', id)
                // Decided from the state it was read in, checked again at the
                // write. Two admins clicking at once otherwise both succeed.
                .eq('status', expected);

            if (writeError) {
                return { status: 500, body: { ok: false, error: writeError.message } };
            }

            // The decision is saved by this point. An email that fails must not
            // undo it — but it must not be passed off as having gone, either. The
            // whole point of the decision is that the business hears about it.
            //
            // sendEmail returns false rather than throwing, so the try/catch below
            // catches nothing on the ordinary failure path: no API key, a refusal
            // from Resend, a dead network. Those come back as `false` and have to
            // be read.
            let emailed = false;

            try {
                if (provider.contact_email) {
                    const name = escapeHtml(provider.business_name || 'your business');

                    const FOOT = 'You are receiving this because you listed a business on Galloway Getaways.';

                    let subject: string;
                    let html: string;

                    if (decision === 'approve') {
                        // What it costs, in the email that makes the promise.
                        //
                        // NO DATE HERE ANY MORE, because at approval there is not
                        // one — the ninety days start when we send him his first
                        // enquiry, which may be months away or never. Quoting a
                        // date computed here would be inventing one, and the
                        // whole reason the clock moved is that a date stamped at
                        // approval charges him for our silence.
                        //
                        // What replaces it is a promise about when he WILL be
                        // told, which the email that stamps the clock then keeps.
                        const terms = patch.plan === 'subscription'
                            ? '<p style="margin:0 0 16px;font-size:16px;">Your first '
                                + TRIAL_DAYS + ' days are free, and they do not start today — they start'
                                + ' when we send you your first enquiry. If we do not find you any work,'
                                + ' you are not paying for it.</p>'
                                + '<p style="margin:0 0 16px;font-size:16px;">After those '
                                + TRIAL_DAYS + ' days it is £' + SUBSCRIPTION_MONTHLY
                                + ' a month, and we take no commission on your work — you quote and get paid'
                                + ' direct, the same as you do now. We will tell you the day your free period'
                                + ' starts and write to you well before anything is due. There is nothing to'
                                + ' set up today.</p>'
                            : '<p style="margin:0 0 16px;font-size:16px;">There is nothing to pay to be listed.'
                                + ' We take 10% of a job when you accept one through the site, and nothing at'
                                + ' all when you do not.</p>';

                        subject = 'You are listed on Galloway Getaways';
                        html = emailLayout(
                            '<p style="margin:0 0 16px;font-size:16px;">Good news — <strong>' + name
                                + '</strong> has been approved and is now on the site.</p>'
                                + '<p style="margin:0 0 16px;font-size:16px;">People looking for your trade in the areas you cover can now find you. We will email you whenever somebody asks for work.</p>'
                                + terms
                                + button(SITE_URL + '/services/join', 'See your listing'),
                            FOOT
                        );
                    } else if (decision === 'decline') {
                        subject = 'About your Galloway Getaways listing';
                        html = emailLayout(
                            '<p style="margin:0 0 16px;font-size:16px;">Thanks for sending in <strong>' + name
                                + '</strong>. We are not able to list it as it stands.</p>'
                                + quoted(note)
                                + '<p style="margin:0 0 16px;font-size:16px;">You can change it and send it back to us whenever you like.</p>'
                                + button(SITE_URL + '/services/join', 'Update your details'),
                            FOOT
                        );
                    } else if (decision === 'approve_changes') {
                        // They were told we would look and come back to them, so
                        // we do — even though nothing visible changes, because a
                        // promise that quietly expires is worse than no promise.
                        subject = 'Your changes have been checked';
                        html = emailLayout(
                            '<p style="margin:0 0 16px;font-size:16px;">We have looked at the changes you made to <strong>'
                                + name + '</strong>. Nothing needs doing — you stayed on the site throughout.</p>'
                                + button(SITE_URL + '/services/join', 'See your listing'),
                            FOOT
                        );
                    } else {
                        subject = 'About the changes to your listing';
                        html = emailLayout(
                            '<p style="margin:0 0 16px;font-size:16px;">We have looked at the changes you made to <strong>'
                                + name + '</strong>, and we are not able to leave them as they are.</p>'
                                + quoted(note)
                                + '<p style="margin:0 0 16px;font-size:16px;">'
                                + (hide
                                    ? 'Your listing is hidden for now. Change it and send it back to us, and we will put it straight back up.'
                                    : 'Your listing is still up. Change it whenever you can and we will take another look.')
                                + '</p>'
                                + button(SITE_URL + '/services/join', 'Update your details'),
                            FOOT
                        );
                    }

                    emailed = await sendEmail(provider.contact_email, subject, html);
                }
            } catch (mailErr: any) {
                emailed = false;
            }

            if (!emailed) {
                await logError('service-provider-decision-email', {
                    provider: id,
                    decision: decision,
                    to: provider.contact_email || null,
                });
            }

            // The decision stands either way, so this is not an error status. The
            // screen decides what to say about `emailed`.
            return { status: 200, body: { ok: true, emailed: emailed } };
        };

        const requestBody = await req.json();
        const ids = idsFrom(requestBody);

        // Bulk is approvals only, and only on this route because it is the
        // same route: launch morning is one press on ten businesses, not ten
        // presses. Everything else here is triage — a decline carries a reason
        // written for one business, and verifying a registration is a look at
        // one certificate — so those stay one at a time and say so.
        if (ids.length > 1) {
            if (requestBody.decision !== 'approve') {
                return NextResponse.json(
                    { ok: false, error: 'Only approvals can be done in bulk.' },
                    { status: 400 }
                );
            }
            if (ids.length > MAX_BATCH) {
                return NextResponse.json(
                    { ok: false, error: `That is more than ${MAX_BATCH} at once. Do it in smaller batches.` },
                    { status: 400 }
                );
            }

            const result = await decideBatch(ids, async (id) => {
                const one = await decideOne({ ...requestBody, id, ids: undefined });
                return {
                    ok: one.body && one.body.ok !== false,
                    error: one.body && one.body.error,
                    emailed: one.body && one.body.emailed,
                };
            });

            return NextResponse.json(result);
        }

        const single = await decideOne(requestBody);
        return NextResponse.json(single.body, { status: single.status });
    } catch (err: any) {
        await logError('service-provider-decision', err);
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}
