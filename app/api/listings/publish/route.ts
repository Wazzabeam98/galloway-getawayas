import { logError } from '@/lib/logError';
import { revalidateListing } from '@/lib/revalidatePublic';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { coordinatePatchFor } from '@/lib/postcodeGeocode';
import { addressBlockerForPublish, NEW_LISTING_MIN_PHOTOS } from '@/lib/listingRules';
import { HOST_TERMS_VERSION, hasAgreedToCurrentTerms, termsProblem } from '@/lib/hostTerms';
import { recordAcceptance } from '@/lib/agreementRecords';
import { needsPersonName } from '@/lib/personName';
import { checkListing } from '@/lib/access';
import { sendsListingConfirmation, confirmListingSubmission } from '@/lib/listingSubmittedConfirm';
import { attachReferral, REFERRAL_COOKIE } from '@/lib/referrals';

export const dynamic = 'force-dynamic';

// Publishing a listing, which is the one thing a host may no longer do by
// writing the row.
//
// A listing's status used to be set straight from the browser — app/addhome
// wrote status='published' over the REST API. That made the review queue in
// 20260828143000 defeatable before it shipped: anyone could PATCH their own
// listing to published, or insert one already live, skipping any approval.
// 20260829020000 closes that at the database — a browser role may create a
// draft and may never change status — and this route is where publishing goes
// instead.
//
// getUser(), not getSession(): the identity must be verified against the auth
// server, not read from a cookie the caller could write. This route is the
// authority on who owns the listing, so it cannot trust a forgeable id.
//
// THE REVIEW GATE. A listing going live for the FIRST time does not go live:
// it goes to 'pending_review', the host's dashboard says "Waiting for
// approval", and an owner approves it at /admin/listings (one at a time or in
// bulk), which moves it to 'published' and emails the host — see
// app/api/admin/listings/decide. Signed out, a pending listing is not
// readable: the listings_readable policy shows anonymous callers 'published'
// rows only, and /homes/[id] shows only 'published' and 'hidden'.
//
// A listing that has been live before ('published', or 'hidden' by its host)
// was approved once and is not queued again: re-saving it stays 'published'.
export async function POST(request: Request) {
    let reporterId: string | null = null;
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        reporterId = (user && user.id) || null;

        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const body = await request.json();
        const listingId: string = body && body.listingId;
        // The terms version the host ticked "I agree" to on this submit, if the
        // box was shown to them (it is shown only when they have no current
        // agreement on record).
        const agreedTermsVersion: string | null = (body && typeof body.termsVersion === 'string') ? body.termsVersion : null;

        if (!listingId) {
            return NextResponse.json({ ok: false, error: 'Missing listing' }, { status: 400 });
        }

        const admin = adminClient();

        const { data: listing } = await admin
            .from('listings')
            .select('id, host_id, title, price_per_night, status, images, street_address, postcode, latitude, longitude, declined_at')
            .eq('id', listingId)
            .maybeSingle();

        if (!listing) {
            return NextResponse.json({ ok: false, error: 'No such listing' }, { status: 404 });
        }

        // Who may publish: the owner, OR a co-host the owner trusted with the
        // listing (can_listing) — exactly as the owner, matching the sibling
        // writes /api/listings/save and /api/listings/visibility, and the
        // provider twin /api/services/submitted. checkListing returns owner
        // access when host_id matches, so this one gate covers both. The update
        // below is a service-role write (adminClient), so row-level security is
        // NOT in the path and this route — not a table policy — is the authority
        // on who may publish; checked against the verified user id so a forged
        // cookie cannot publish for someone else. (The #440 class — a page that
        // opens for a co-host while the save behind it is refused — is exactly
        // what this closes: a full-access co-host could edit every field and open
        // the wizard, then hit a 403 on "Submit for review".)
        const access = await checkListing(user.id, listingId, 'can_listing');
        if (!access) {
            return NextResponse.json(
                { ok: false, error: 'You don’t have permission to publish this listing.' },
                { status: 403 }
            );
        }

        // The same completeness the database constraint enforces
        // (listings_published_are_complete), checked here so the host gets a
        // sentence rather than a raw 23514.
        const title = (listing.title || '').trim();
        const price = Number(listing.price_per_night || 0);
        if (!title || price <= 0) {
            return NextResponse.json(
                { ok: false, error: 'A listing needs a name and a price before it can go live.' },
                { status: 400 }
            );
        }

        // And a real address — you can't list accommodation that doesn't exist.
        const addressProblem = addressBlockerForPublish(listing);
        if (addressProblem) {
            return NextResponse.json({ ok: false, error: addressProblem }, { status: 400 });
        }

        // At least five photos to go live for the FIRST time — the Airbnb bar for a
        // listing worth booking. Only gates a listing that has never been live: a
        // 'hidden' (paused/unlisted) or already-'published' listing has been through
        // this once, so it can go live again with the photos it has. A brand-new
        // 'draft' (or a not-yet-approved 'pending_review') is what the bar is for.
        const everPublished = listing.status === 'published' || listing.status === 'hidden';
        const photoCount = Array.isArray(listing.images) ? listing.images.filter(Boolean).length : 0;
        if (!everPublished && photoCount < NEW_LISTING_MIN_PHOTOS) {
            return NextResponse.json(
                { ok: false, error: `Add at least ${NEW_LISTING_MIN_PHOTOS} photos before your listing can go live — you have ${photoCount}.` },
                { status: 400 }
            );
        }

        // THE HOST'S NAME. Guests see "Hosted by" and a first name; a listing
        // whose OWNER has no first and last name cannot publish (the wizard asks
        // first, this is the server holding the line — lib/personName). Keyed to
        // the listing's owner, not the publisher: a co-host publishing on the
        // owner's behalf does not stand in for the owner's name, and the owner is
        // who guests see. Also carries the owner's host-terms version, read below.
        const { data: owner } = await admin
            .from('profiles')
            .select('first_name, last_name, preferred_name, full_name, email, host_terms_version')
            .eq('id', listing.host_id)
            .maybeSingle();
        if (needsPersonName(owner)) {
            return NextResponse.json(
                { ok: false, needsName: true, error: 'Add your first and last name before your listing goes live.' },
                { status: 400 }
            );
        }

        // THE HOST TERMS, before a listing is submitted for review.
        //
        // Payout setup used to sit here: a host could not submit until Stripe
        // said payouts were on. That is not how Airbnb orders it, and it put a
        // bank-details form between a new host and their first listing. The
        // order now is list → submit → approved → live and bookable, and the
        // host is asked to add a payout method after approval (the approval
        // email, a dashboard banner, a reminder with each booking and before
        // check-in). Their money waits safely until they do — the payout run
        // holds a stay whose host has no payouts and pays it on the first run
        // after Stripe enables them (app/api/cron/host-payouts).
        //
        // What IS needed before submitting is the host's agreement to the terms,
        // recorded — version and server time — on their profile. Only a first-
        // time submission asks; a listing that has been live before was
        // submitted (and agreed to) already.
        // The terms are the OWNER's agreement for their own property, so they are
        // read from — and recorded against — the listing's owner, not whoever is
        // pressing submit. When the owner is doing it themselves, the box they
        // ticked (agreedTermsVersion) records their agreement. When a co-host is
        // publishing on the owner's behalf, they cannot agree for the owner: the
        // owner must already be on the current terms (the normal case — a host
        // agrees to them when they finish signing up), or the publish is refused
        // with an explained message rather than a silent 403.
        let recordTerms = false;
        if (!everPublished) {
            const recorded = owner ? (owner as any).host_terms_version : null;
            if (!hasAgreedToCurrentTerms(recorded)) {
                if (!access.isOwner) {
                    return NextResponse.json(
                        { ok: false, error: 'The listing’s owner needs to accept the current host terms before it can go live.' },
                        { status: 400 }
                    );
                }
                const problem = termsProblem(recorded, agreedTermsVersion);
                if (problem) {
                    return NextResponse.json(
                        { ok: false, needsTerms: true, termsVersion: HOST_TERMS_VERSION, error: problem },
                        { status: 400 }
                    );
                }
                recordTerms = true;
            }
        }

        // First time live waits for an owner; see THE REVIEW GATE above.
        const nextStatus = everPublished ? 'published' : 'pending_review';

        const { error } = await admin
            .from('listings')
            // THE OTHER DOOR A POSTCODE COMES THROUGH.
            //
            // The wizard writes the listing row straight from the browser and
            // then calls this, so a server-side fill in listings/save would
            // never see a brand-new listing. This is the one point the server
            // touches every publish, which makes it the right place for the
            // second half.
            //
            // Empty object when there is nothing to do, so this stays a single
            // update.
            .update({ status: nextStatus, ...(await coordinatePatchFor(listing, {})) })
            .eq('id', listingId);

        if (error) {
            return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        }

        // Publishing (or re-publishing) changes what the public grids and the
        // listing page show — refresh them at once (lib/revalidatePublic).
        revalidateListing(listingId);

        // Recorded once the submission has gone through, so a refused submit
        // records nothing. A failure here is logged rather than un-submitting
        // the listing: the host did agree, and the box will simply be shown to
        // them again next time.
        if (recordTerms) {
            // Both records at once: agreement_acceptances (the registry's
            // store, read by the sign-in prompt) and profiles.host_terms_*
            // (read above on the next submit).
            // Against the owner — whose terms these are (recordTerms is only ever
            // set when the owner is the one publishing, so user.id === host_id
            // here, but the owner id is the honest subject of the record).
            const { error: termsError } = await recordAcceptance(admin, listing.host_id, 'host', 'listing_publish');
            if (termsError) {
                await logError('listings/publish: host terms agreement not recorded', termsError, {
                    path: 'api/listings/publish',
                    userId: user.id,
                });
            }
        }

        // "We've got your listing — it's in review", the host twin of the
        // provider's confirmation (lib/listingSubmittedConfirm): only when this
        // submit moves the listing INTO review. To the account's address; a
        // failed send is logged and never un-submits the listing.
        if (sendsListingConfirmation(listing.status, nextStatus)) {
            try {
                const sent = await confirmListingSubmission((owner && (owner as any).email) || user.email, listing, owner as any);
                if (!sent) {
                    await logError('listings/publish: the in-review email to the host did not send', null, { path: 'api/listings/publish', userId: user.id });
                }
            } catch (mailErr) {
                await logError('listings/publish: the in-review email to the host did not send', mailErr, { path: 'api/listings/publish', userId: user.id });
            }
        }

        // REFERRAL: they have gone on to list a property. The first time a
        // listing goes INTO review is the moment the owner becomes a host, so
        // a referral is recorded (or advanced from 'invited' to 'listed') here.
        // Only when the owner is the one publishing, in their own browser with
        // their own referral cookie — a co-host publishing someone else's
        // listing must never attribute the owner to the co-host's referrer.
        // Best-effort: a referral never gets in the way of a listing going live.
        if (sendsListingConfirmation(listing.status, nextStatus) && user.id === listing.host_id) {
            try {
                const refCode = cookies().get(REFERRAL_COOKIE)?.value || '';
                if (refCode) {
                    await attachReferral(admin, { code: refCode, referredUserId: user.id, stage: 'listed' });
                }
            } catch (referralErr) {
                await logError('listings/publish: could not record the referral', referralErr, {
                    path: 'api/listings/publish',
                    userId: user.id,
                });
            }
        }

        return NextResponse.json({ ok: true, status: nextStatus });
    } catch (err: any) {
        console.error('[listings/publish]', err && err.message);

        // The console is nobody's alarm. A listing that will not publish is a property earning nothing, and the host
        // sees only a button that did not work.
        await logError('listings/publish: a listing could not be published', err, {
            path: 'api/listings/publish',
            userId: reporterId || undefined,
        });
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Could not publish that' },
            { status: 500 }
        );
    }
}
