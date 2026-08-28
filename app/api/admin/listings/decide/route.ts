import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sendEmail, emailLayout, button, escapeHtml, SITE_URL } from '@/lib/email';
import { logError } from '@/lib/logError';
import { publishProblems, fromRow } from '@/lib/listingRules';
import { idsFrom, decideBatch, MAX_BATCH } from '@/lib/reviewQueue';

export const dynamic = 'force-dynamic';

// Approving and declining host listings.
//
// A route rather than a write from the browser, for the same two reasons the
// provider one is: the decision has to be checked against `is_admin` on the
// server, and it sends an email. Neither belongs in a client component — and a
// listing's status is about to be revoked from `authenticated` entirely, so
// there will be nowhere else it *can* be done.
//
// ONE ID OR MANY. The body may carry `id` or `ids`. Launch day is meant to be
// one click on ten properties, not ten clicks, so bulk is not a second route
// with its own rules — it is this one, walking the list. See lib/reviewQueue.ts
// for why the walk is sequential and why a failure part-way does not stop it.
//
// DECLINING SENDS IT BACK TO 'draft', NOT TO A STATUS OF ITS OWN. `draft`
// already means "yours, unfinished, reopens in the wizard", which is exactly
// what a host needs in order to fix it and send it again. The difference
// between a draft that was declined and one that was never finished is
// `review_note`, which is set here and shown on their dashboard.
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

        const body = await req.json();
        const decision = String(body.decision || '');
        const note = String(body.note || '').trim();
        const ids = idsFrom(body);

        if (decision !== 'approve' && decision !== 'decline') {
            return NextResponse.json({ ok: false, error: 'Nothing to decide.' }, { status: 400 });
        }

        if (ids.length === 0) {
            return NextResponse.json({ ok: false, error: 'Nothing to decide.' }, { status: 400 });
        }

        if (ids.length > MAX_BATCH) {
            return NextResponse.json(
                { ok: false, error: `That is more than ${MAX_BATCH} at once. Do it in smaller batches.` },
                { status: 400 }
            );
        }

        // The reason is not optional and it is not for our records — it is the
        // body of the email the host receives. A decline with nothing to say
        // leaves somebody looking at a returned listing with no idea what to
        // change, which is worse than no decision at all.
        //
        // Declining many at once with ONE reason is refused for the same
        // reason: a sentence true of ten different listings is too vague to act
        // on. Declines are one at a time, deliberately. Approvals are the bulk
        // case, and they are the launch-day one.
        if (decision === 'decline') {
            if (!note) {
                return NextResponse.json(
                    { ok: false, error: 'A decline needs a reason — it is sent to the host.' },
                    { status: 400 }
                );
            }
            if (ids.length > 1) {
                return NextResponse.json(
                    {
                        ok: false,
                        error: 'Declines are one at a time, so the reason fits the listing.',
                    },
                    { status: 400 }
                );
            }
        }

        const now = new Date().toISOString();

        const result = await decideBatch(ids, async (id) => {
            const { data: listing } = await admin
                .from('listings')
                .select(
                    // Every column fromRow() reads, or publishProblems() reports a
                    // problem that is really a missing SELECT — which is exactly
                    // what the first run of these tests caught.
                    'id, title, host_id, status, images, property_type, street_address, location, postcode, price_per_night, max_guests, bedrooms, beds, bathrooms, amenities, description, check_in_method, weekend_price'
                )
                .eq('id', id)
                .maybeSingle();

            if (!listing) return { ok: false, error: 'That listing no longer exists.' };

            // A click made against a stale screen is refused rather than doing
            // something else. Somebody else may have decided it a minute ago.
            if (listing.status !== 'pending_review') {
                return {
                    ok: false,
                    error: listing.status === 'published'
                        ? 'Already live.'
                        : `Not waiting for review — it is ${listing.status}.`,
                };
            }

            // Approving something half-finished is how a listing with no price
            // reaches the home page. The rules are the ones the wizard itself
            // enforces, so this cannot disagree with what the host was asked
            // for. The queue shows the same list, so this should be
            // unreachable from the screen — but the screen is not the guard.
            if (decision === 'approve') {
                const problems = publishProblems(fromRow(listing));
                if (problems.length > 0) {
                    return {
                        ok: false,
                        error: 'Not finished: ' + problems[0].message,
                    };
                }
            }

            const patch = decision === 'approve'
                ? { status: 'published', approved_at: now, review_note: null }
                : { status: 'draft', declined_at: now, review_note: note };

            // Only if it is still what we read, AND we look at what came back.
            //
            // Narrowing the update on status alone is not enough: an update that
            // matches no rows is not an error, so a second owner pressing
            // approve a moment later would write nothing, see no error, and send
            // the host a second email. The `.select()` is what turns "somebody
            // else got here first" into something this code can see.
            //
            // Found by mutation testing — removing the status guard changed
            // nothing any test could detect, which was the tell that it was not
            // doing the job it claimed.
            const { data: written, error: writeError } = await admin
                .from('listings')
                .update(patch)
                .eq('id', id)
                .eq('status', 'pending_review')
                .select('id');

            if (writeError) return { ok: false, error: writeError.message };

            if (!written || written.length === 0) {
                return { ok: false, error: 'Somebody else decided this a moment ago.' };
            }

            // The decision is saved by this point. An email that fails must not
            // undo it — and must not be reported as having gone either.
            const emailed = await tellTheHost(admin, listing, decision, note);

            if (!emailed) {
                await logError('listing-decision-email', {
                    listing: id,
                    decision: decision,
                });
            }

            return { ok: true, emailed };
        });

        // Not an error status even when some failed: the ones that worked have
        // worked, and the screen reports per row.
        return NextResponse.json(result);
    } catch (err: any) {
        console.error('[admin/listings/decide]', err && err.message);
        await logError('[admin/listings/decide] ' + ((err && err.message) || 'failed'), err, {
            path: 'admin/listings/decide',
        });
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}

/**
 * Tell the host what happened. Returns false rather than throwing.
 *
 * The host's address is on their profile, not on the listing — a listing has no
 * contact of its own, which is the one place this differs from the provider
 * queue.
 */
async function tellTheHost(
    admin: any,
    listing: any,
    decision: string,
    note: string
): Promise<boolean> {
    try {
        const { data: host } = await admin
            .from('profiles')
            .select('email, full_name, preferred_name')
            .eq('id', listing.host_id)
            .maybeSingle();

        const to = host && host.email;
        if (!to) return false;

        const name = escapeHtml(
            String((host.preferred_name || host.full_name || '')).split(' ')[0] || 'there'
        );
        const title = escapeHtml(listing.title || 'your property');

        const FOOT = 'You are receiving this because you list a property on Galloway Getaways.';

        if (decision === 'approve') {
            return await sendEmail(
                to,
                title + ' is live on Galloway Getaways',
                emailLayout(
                    `<p style="margin:0 0 16px;font-size:16px;">Hello ${name},</p>`
                    + `<p style="margin:0 0 16px;font-size:16px;"><strong>${title}</strong> has been approved and is now on the site. Guests can find it and book it from today.</p>`
                    + '<p style="margin:0 0 16px;font-size:16px;">You can change your prices, your calendar and your house rules whenever you like — those take effect straight away.</p>'
                    + button(SITE_URL + '/dashboard', 'See your property'),
                    FOOT
                )
            );
        }

        // The reason, in the host's own words back to them, and a way in to fix
        // it. Without the link this email is a complaint rather than a task.
        return await sendEmail(
            to,
            'A few things to change on ' + title,
            emailLayout(
                `<p style="margin:0 0 16px;font-size:16px;">Hello ${name},</p>`
                + `<p style="margin:0 0 16px;font-size:16px;">Thanks for putting <strong>${title}</strong> up. It is not quite ready to go live, and we have put it back in your drafts so you can finish it off.</p>`
                + '<p style="margin:0 0 8px;font-size:16px;">What needs doing:</p>'
                + `<p style="margin:0 0 16px;padding:12px 14px;background-color:#f5f5f4;border-radius:8px;font-size:16px;">${escapeHtml(note)}</p>`
                + '<p style="margin:0 0 16px;font-size:16px;">Once you have made the changes, send it again from your dashboard and we will take another look.</p>'
                + button(SITE_URL + '/dashboard', 'Finish your listing'),
                FOOT
            )
        );
    } catch {
        return false;
    }
}
