import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { ownerOrFullAccess } from '@/lib/access';
import { logError } from '@/lib/logError';
import {
    MAX_NOTIFICATION_EMAILS,
    normalizeNotificationEmail,
    isValidNotificationEmail,
} from '@/lib/notificationEmails';
import { newSubscriberToken, hashSubscriberToken } from '@/lib/listingSubscriberToken';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';

export const dynamic = 'force-dynamic';

// The extra addresses an owner forwards a listing's booking emails to. Only the
// owner or a full-access co-host may see or change the list — checked here with
// ownerOrFullAccess (lib/access), the same gate the owner-equivalent host
// actions use — and the table is service-role only, so this route is the only
// way in. The browser never touches listing_notification_subscribers directly.

// The shape returned to the editor. Deliberately not the row: the confirm-token
// hash and the unsubscribe token never leave the server.
function publicRow(r: any) {
    return { id: r.id, email: r.email, confirmed: !!r.confirmed_at };
}

async function gate(listingId: string) {
    const supabase = createRouteHandlerClient({ cookies });
    // getUser(), not getSession(): this decides who may change who gets copies
    // of a listing's mail, so the id must be one the auth server verified.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 }) };
    if (!listingId) return { error: NextResponse.json({ ok: false, error: 'Missing listing' }, { status: 400 }) };
    const access = await ownerOrFullAccess(user.id, listingId);
    if (!access) return { error: NextResponse.json({ ok: false, error: 'Not allowed' }, { status: 403 }) };
    return { user, access };
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
    try {
        const listingId = params.id;
        const g = await gate(listingId);
        if (g.error) return g.error;

        const admin = adminClient();
        const { data } = await admin
            .from('listing_notification_subscribers')
            .select('id, email, confirmed_at')
            .eq('listing_id', listingId)
            .order('created_at', { ascending: true });

        return NextResponse.json({ ok: true, subscribers: (data || []).map(publicRow) });
    } catch (err) {
        await logError('notification-emails GET failed', { error: String((err as any) && (err as any).message) }, { path: 'api/listings/notification-emails' });
        return NextResponse.json({ ok: false, error: 'Something went wrong' }, { status: 500 });
    }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
    try {
        const listingId = params.id;
        const g = await gate(listingId);
        if (g.error) return g.error;

        const body = await request.json().catch(() => ({}));
        const email = normalizeNotificationEmail(body && body.email);

        // Mirror the client-side rules server-side, through the shared helper.
        if (!isValidNotificationEmail(email)) {
            return NextResponse.json({ ok: false, error: 'That doesn’t look like an email address.' }, { status: 400 });
        }

        const admin = adminClient();

        const { data: listing } = await admin
            .from('listings')
            .select('id, title')
            .eq('id', listingId)
            .maybeSingle();
        if (!listing) return NextResponse.json({ ok: false, error: 'No such listing' }, { status: 404 });

        const { data: existing } = await admin
            .from('listing_notification_subscribers')
            .select('id, email, confirmed_at')
            .eq('listing_id', listingId);

        const rows = existing || [];
        const already = rows.find((r: any) => normalizeNotificationEmail(r.email) === email);

        // Already confirmed — nothing to do, and no second confirmation email.
        if (already && already.confirmed_at) {
            return NextResponse.json({ ok: true, subscriber: publicRow(already), already: true });
        }

        // The cap counts what is already there. An unconfirmed row for this same
        // address does not count against it (we are about to resend to it).
        const counts = rows.filter((r: any) => normalizeNotificationEmail(r.email) !== email).length;
        if (!already && counts >= MAX_NOTIFICATION_EMAILS) {
            return NextResponse.json(
                { ok: false, error: `You can add up to ${MAX_NOTIFICATION_EMAILS} addresses per property.` },
                { status: 400 },
            );
        }

        // Fresh one-time token every time, so a resend invalidates the old link.
        const rawToken = newSubscriberToken();
        const tokenHash = hashSubscriberToken(rawToken);

        let rowId = already && already.id;
        if (already) {
            const { error } = await admin
                .from('listing_notification_subscribers')
                .update({ confirm_token_hash: tokenHash, email })
                .eq('id', already.id);
            if (error) throw error;
        } else {
            const { data: inserted, error } = await admin
                .from('listing_notification_subscribers')
                .insert({ listing_id: listingId, email, confirm_token_hash: tokenHash, created_by: g.user!.id })
                .select('id, email, confirmed_at')
                .single();
            if (error) throw error;
            rowId = inserted.id;
        }

        await sendConfirmationEmail(email, listing.title || 'a property', rawToken);

        return NextResponse.json({ ok: true, subscriber: { id: rowId, email, confirmed: false } });
    } catch (err) {
        await logError('notification-emails POST failed', { error: String((err as any) && (err as any).message) }, { path: 'api/listings/notification-emails' });
        return NextResponse.json({ ok: false, error: 'Something went wrong' }, { status: 500 });
    }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
    try {
        const listingId = params.id;
        const g = await gate(listingId);
        if (g.error) return g.error;

        const body = await request.json().catch(() => ({}));
        const subId = body && body.id;
        if (!subId) return NextResponse.json({ ok: false, error: 'Missing address' }, { status: 400 });

        const admin = adminClient();
        // Scoped to this listing, so an id from another listing can't be removed
        // through a listing this caller happens to have access to.
        const { error } = await admin
            .from('listing_notification_subscribers')
            .delete()
            .eq('id', subId)
            .eq('listing_id', listingId);
        if (error) throw error;

        return NextResponse.json({ ok: true });
    } catch (err) {
        await logError('notification-emails DELETE failed', { error: String((err as any) && (err as any).message) }, { path: 'api/listings/notification-emails' });
        return NextResponse.json({ ok: false, error: 'Something went wrong' }, { status: 500 });
    }
}

// The one-time confirmation. Sent through sendEmail so a failed send retries
// through the email outbox like every other message. push: false — the address
// may not be an account, and a confirmation is not something to push anyway. It
// carries no booking link and does not go to the owner, so the listing fan-out
// never copies it.
async function sendConfirmationEmail(email: string, listingTitle: string, rawToken: string): Promise<void> {
    const url = SITE_URL + '/notifications/confirm?token=' + encodeURIComponent(rawToken);
    const title = escapeHtml(listingTitle);
    const html = emailLayout(
        '<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#111827;">Confirm these emails</h1>' +
        '<p style="margin:0;">A host on Galloway Getaways would like to send you a copy of the booking emails for ' +
        '<strong>' + title + '</strong> &mdash; new bookings, cancellations, changes and messages.</p>' +
        '<p style="margin:16px 0 0;">If that sounds right, confirm it below. We won’t send you anything until you do, ' +
        'and you can stop the emails at any time from a link in every one.</p>' +
        button(url, 'Yes, send me these emails') +
        '<p style="margin:20px 0 0;color:#6b7280;font-size:14px;">If you weren’t expecting this, you can ignore this email and nothing will be sent.</p>',
        "You received this because a host added your address to a property's notifications. No account has been created.",
    );
    await sendEmail(email, 'Confirm notifications for ' + listingTitle, html, false);
}
