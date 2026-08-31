import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { newReplyToken, hashReplyToken } from '@/lib/enquiryToken';
import { logError } from '@/lib/logError';
import { announceEnquiry } from '@/lib/serviceEnquiryAlert';
import {
    canBeEnquiredAbout,
    registrationBlockers,
    shouldStartTrial,
    trialEndsAt,
} from '@/lib/serviceProviders';
import {
    enquiryProblems,
    enquiryReference,
    expiresAt,
    isEmergency,
    needsDate,
    offersEmergency,
    priceSnapshot,
} from '@/lib/serviceEnquiries';

export const dynamic = 'force-dynamic';

// A host asks one tradesman to look at something.
//
// WHY THE ROW IS WRITTEN HERE AND NOT FROM THE BROWSER
//
// The column grants in 20260828104048_service_enquiries.sql let a signed-in host
// insert the fields that describe the job — and nothing else. The reference,
// the deadline, the status and the reply token are the platform's, because a
// host who could set their own `expires_at` could set it to next year and a
// host who could set their own status could mark themselves accepted.
//
// AN EMERGENCY IS SENT LIKE EVERYTHING ELSE, AND WAITS TWENTY MINUTES
//
// It used to return the number in this response. That was reversed because of
// what it cost the platform rather than what it gave the host: an
// introduction nobody accepted is not evidence that the platform did anything,
// and evidence is the entire argument for the subscription these trades are
// about to start paying.
//
// So nothing here returns a phone number, ever. An emergency gets the same
// token and the same email as ordinary work with a much shorter deadline on
// it, and the sweep hands the number over automatically if he has not answered
// by then. See EMERGENCY_MINUTES and dueOutcome in lib/serviceEnquiries.ts.
//
// It is still only offered for a provider who ticked that he turns out — that
// tick is the consent, and it is his. See `offersEmergency`.

interface Body {
    provider_id?: string;
    listing_id?: string | null;
    urgency?: string;
    summary?: string;
    fault_keys?: string[];
    access_note?: string;
    when_note?: string;
    host_name?: string;
    host_phone?: string;
    host_email?: string;
    band_key?: string | null;
    preferred_date?: string | null;
    window_from?: string | null;
    window_to?: string | null;
}

export async function POST(req: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });

        // getUser() asks the auth server. getSession() would only decode the
        // cookie, so anyone could claim to be anyone by editing it.
        const { data: auth } = await supabase.auth.getUser();
        if (!auth || !auth.user) {
            return NextResponse.json({ ok: false, error: 'Sign in to ask for help.' }, { status: 401 });
        }

        const body: Body = await req.json();
        const admin = adminClient();

        // ---- who is being asked -------------------------------------------
        const { data: provider } = await admin
            .from('service_providers')
            .select('id, owner_id, business_name, trade, status, kind, contact_email, contact_phone, sms_opt_out, callout_fee, hourly_rate, callout_waived, does_gas, does_oil, notify_user_ids, plan, trial_ends_at')
            .eq('id', String(body.provider_id || ''))
            .maybeSingle();

        if (!provider) {
            return NextResponse.json({ ok: false, error: 'No such business.' }, { status: 404 });
        }

        // Re-checked here rather than trusted from the page. A provider can be
        // hidden or declined between a host loading the list and pressing the
        // button, and the stale page would still hold their id.
        if (provider.status !== 'approved') {
            return NextResponse.json(
                { ok: false, error: 'That business is not taking enquiries.' },
                { status: 409 }
            );
        }

        const trade = String(provider.trade || '');
        if (!canBeEnquiredAbout(trade)) {
            return NextResponse.json(
                { ok: false, error: 'That trade cannot be enquired about yet.' },
                { status: 409 }
            );
        }

        // A Gas Safe number that ran out last month must not receive a gas
        // enquiry this month. The approval checked it once; this checks it
        // again on the day it matters, because expiry happens on a calendar
        // rather than on an edit.
        const { data: regRows } = await admin
            .from('service_provider_registrations')
            .select('scheme, number, verified_at, verified_number, expires_at')
            .eq('provider_id', provider.id);

        const blockers = registrationBlockers(
            { trade, does_gas: provider.does_gas, does_oil: provider.does_oil },
            regRows || []
        );
        if (blockers.length) {
            await logError('service-enquiry-blocked', {
                provider: String(provider.id),
                blockers: blockers.join(', '),
            });
            return NextResponse.json(
                { ok: false, error: 'That business is not taking enquiries.' },
                { status: 409 }
            );
        }

        // ---- what is being asked ------------------------------------------
        const draft = {
            trade,
            provider_id: String(provider.id),
            urgency: String(body.urgency || ''),
            summary: String(body.summary || ''),
            fault_keys: body.fault_keys || [],
            host_name: String(body.host_name || ''),
            host_phone: String(body.host_phone || ''),
            preferred_date: body.preferred_date || null,
            window_from: body.window_from || null,
            window_to: body.window_to || null,
        };

        const problems = enquiryProblems(draft);
        if (problems.length) {
            return NextResponse.json({ ok: false, problems }, { status: 400 });
        }

        const emergency = isEmergency(draft.urgency);

        // ---- the property --------------------------------------------------
        //
        // Their own listing only. Without this, a host could attach somebody
        // else's address to an enquiry and have us email it to a stranger.
        let listing: any = null;
        if (body.listing_id) {
            const { data } = await admin
                .from('listings')
                .select('id, host_id, title, location, bedrooms')
                .eq('id', String(body.listing_id))
                .maybeSingle();

            if (data && data.host_id === auth.user.id) listing = data;
        }

        // ---- the emergency gate --------------------------------------------
        if (emergency) {
            const { data: extras } = await admin
                .from('service_provider_extras')
                .select('extra_key, offered')
                .eq('provider_id', provider.id);

            const offered = (extras || [])
                .filter((e: any) => e.offered)
                .map((e: any) => String(e.extra_key));

            if (!offersEmergency(provider, offered)) {
                return NextResponse.json(
                    { ok: false, error: 'That business does not turn out to emergencies.' },
                    { status: 409 }
                );
            }
        }

        // ---- band price, where there is one ---------------------------------
        let bandPrice: any = null;
        if (body.band_key) {
            const { data: priceRow } = await admin
                .from('service_provider_prices')
                .select('band_key, price')
                .eq('provider_id', provider.id)
                .eq('band_key', String(body.band_key))
                .maybeSingle();

            bandPrice = priceRow ? priceRow.price : null;
        }

        // ---- write it -------------------------------------------------------
        const sentAt = new Date();
        const token = newReplyToken();

        const row: any = {
            host_id: auth.user.id,
            listing_id: listing ? listing.id : null,
            provider_id: provider.id,
            trade,
            business_name: String(provider.business_name || ''),
            price_snapshot: priceSnapshot(provider, body.band_key || null, bandPrice),
            area_key: String((listing && listing.location) || ''),
            fault_keys: (body.fault_keys || []).map((k) => String(k)),
            summary: String(body.summary || '').trim(),
            urgency: draft.urgency,
            access_note: String(body.access_note || '').trim(),
            when_note: String(body.when_note || '').trim(),
            host_name: draft.host_name.trim(),
            host_phone: draft.host_phone.trim(),
            host_email: String(body.host_email || auth.user.email || '').trim(),
            status: 'sent',
            sent_at: sentAt.toISOString(),
            expires_at: expiresAt(draft.urgency, sentAt),
            reply_token_hash: hashReplyToken(token),

            // Only where the urgency asks for them. A date arriving on an
            // emergency is a stale form field rather than an intention, and it
            // would be quoted back at the tradesman as if the host had asked
            // for next Tuesday while their ceiling came down.
            preferred_date: needsDate(draft.urgency) ? draft.preferred_date : null,
            window_from: needsDate(draft.urgency) ? draft.window_from : null,
            window_to: needsDate(draft.urgency) ? draft.window_to : null,
        };

        // The reference is four characters of a 32-letter alphabet, so a
        // collision is rare and not impossible. Three attempts, then it is a
        // fault worth hearing about rather than a retry loop.
        let saved: any = null;
        let lastError: any = null;

        for (let attempt = 0; attempt < 3; attempt++) {
            const { data, error } = await admin
                .from('service_enquiries')
                .insert({ ...row, reference: enquiryReference() })
                .select('*')
                .single();

            if (!error) { saved = data; break; }
            lastError = error;

            // One live enquiry per host, per provider, per trade, PER URGENCY
            // and per property — see 20260828113521_one_open_per_job.sql. A pending
            // quote no longer blocks a burst pipe, and two cottages with two
            // different faults are two enquiries.
            //
            // What is left is the resend-because-nobody-answered case, which
            // is not a retry worth making silently.
            if (String(error.message || '').indexOf('one_open') !== -1) {
                return NextResponse.json(
                    {
                        ok: false,
                        error: 'You have already asked them about this, and are waiting to hear back. '
                            + 'Withdraw that one first, or ask somebody else.',
                    },
                    { status: 409 }
                );
            }

            if (String(error.message || '').indexOf('reference') === -1) break;
        }

        if (!saved) {
            await logError('service-enquiry-insert', {
                provider: String(provider.id),
                error: String((lastError && lastError.message) || 'unknown'),
            });
            return NextResponse.json({ ok: false, error: 'Could not send that.' }, { status: 500 });
        }

        // The emails are the product, but a send that fails must not lose the
        // enquiry — the row is already written and visible on the host's
        // screen either way.
        const alert = await announceEnquiry(saved, provider, listing, token);

        // HIS FREE NINETY DAYS START HERE.
        //
        // This is the only place a subscription clock is ever started. It used
        // to be the admin approve route, and it moved because approval is not
        // when the value arrives: a plumber approved in September who hears
        // nothing until January was spending his free period waiting for us to
        // find him work. The lead is the product, so the lead starts the clock.
        //
        // ON THE SEND, NOT ON THE ANSWER. Accepting, declining and expiring are
        // all endings an enquiry has, so all three would start it, which means
        // every enquiry starts it and only the date is in question. The most
        // an answer can be behind the send is the expiry window — twenty
        // minutes on an emergency, five days at the outside — and five days
        // against ninety is not worth three code paths that have to agree.
        // Stamping here also cannot be gamed by ignoring the email.
        //
        // ONLY IF IT ACTUALLY WENT. `alert.provider` is false when sendEmail
        // refused, when there is no API key, and when the address is a test
        // one — and a lead he never received is not a lead to charge him for.
        //
        // GUARDED IN THE STATEMENT, not just in JavaScript. Two enquiries
        // landing in the same second would both read a null date; `is null` in
        // the update means only one of them writes, and the loser is a no-op
        // rather than a second clock overwriting the first.
        //
        // Nothing here may fail the enquiry. The row is written, the emails
        // have gone, and the host is looking at the screen. A clock that fails
        // to start costs a provider nothing and us a month — worth an error in
        // the log, never worth an error on the page.
        if (alert.provider && shouldStartTrial(provider)) {
            try {
                const started = new Date();

                const { error: trialError } = await admin
                    .from('service_providers')
                    .update({
                        trial_ends_at: trialEndsAt(started),
                        updated_at: started.toISOString(),
                    })
                    .eq('id', provider.id)
                    .is('trial_ends_at', null);

                if (trialError) {
                    await logError('service-trial-start', {
                        provider: String(provider.id),
                        enquiry: String(saved.id),
                        error: String(trialError.message),
                    });
                }
            } catch (err: any) {
                await logError('service-trial-start', {
                    provider: String(provider.id),
                    enquiry: String(saved.id),
                    error: String(err && err.message),
                });
            }
        }

        return NextResponse.json({
            ok: true,
            reference: saved.reference,
            status: saved.status,
            urgency: saved.urgency,
            // When the number is handed over if nobody answers. Only an
            // emergency ends that way; for everything else this is the moment
            // the host is told to try somebody else.
            expires_at: saved.expires_at,
            emergency,
            business_name: saved.business_name,
            emailed: alert,
        });
    } catch (err: any) {
        await logError('service-enquiry', err);
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}
