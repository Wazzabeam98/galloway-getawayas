import { logError } from '@/lib/logError';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { displayName } from '@/lib/utils';
import { cohostTarget, type CohostTarget } from '@/lib/cohostTargets';

export const dynamic = 'force-dynamic';

// Who may manage co-hosts on a listing — or on a business (an experience or a
// trade; the same system, lib/cohostTargets): the owner, or a full-access co-host
// (the owner's equal). Returns the thing, normalised to { id, title, host_id },
// and whether the caller is the owner — callers use `isOwner` for the one thing
// a co-host still can't do, mint another full-access co-host. Null when the
// caller is neither.
async function manageAuth(admin: any, target: CohostTarget, listingId: string, userId: string): Promise<{ listing: any; isOwner: boolean } | null> {
    const { data: row } = await admin
        .from(target.parent)
        .select('id, ' + target.titleCol + ', ' + target.ownerCol)
        .eq('id', listingId)
        .maybeSingle();

    if (!row) return null;
    const listing = { id: row.id, title: row[target.titleCol], host_id: row[target.ownerCol] };
    if (listing.host_id === userId) return { listing, isOwner: true };

    const { data: access } = await admin
        .from(target.table)
        .select('can_calendar, can_messages, can_bookings, can_listing, can_earnings')
        .eq(target.fk, listingId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .eq('role', 'co_host')
        .maybeSingle();

    const full =
        !!access &&
        access.can_calendar &&
        access.can_messages &&
        access.can_bookings &&
        access.can_listing &&
        access.can_earnings;

    return full ? { listing, isOwner: false } : null;
}

// Every permission ticked — an owner-equal grant. Only the owner may create one:
// a full-access co-host managing co-hosts may add and adjust helpers, but cannot
// mint another of their own kind. (Airbnb draws the same line; it also keeps
// uncontrolled escalation of who can move the owner's money out of reach.)
function isFullGrant(p: { can_calendar: boolean; can_messages: boolean; can_bookings: boolean; can_listing: boolean; can_earnings: boolean }): boolean {
    return p.can_calendar && p.can_messages && p.can_bookings && p.can_listing && p.can_earnings;
}

export async function POST(request: Request) {
    let reporterId: string | null = null;
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession() — getSession() trusts an unsigned
        // cookie, so a forged one impersonates any user. getUser() verifies
        // the token against the auth server. Matches the admin/services routes.
        const { data: { user } } = await supabase.auth.getUser();
        reporterId = (user && user.id) || null;

        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const body = await request.json();
        const action: string = (body && body.action) || 'invite';
        const admin: any = adminClient();
        // A listing's co-hosts, or a business's (kind: 'provider').
        const target = cohostTarget(body && body.kind);

        // ---- Invite someone ------------------------------------------------
        if (action === 'invite') {
            const listingId: string = target.kind === 'provider' ? body.providerId : body.listingId;
            const email: string = ((body.email || '') as string).trim().toLowerCase();
            const role = 'co_host';

            if (!listingId || !email) {
                return NextResponse.json(
                    { ok: false, error: 'Choose a ' + target.noun + ' and enter an email address.' },
                    { status: 400 }
                );
            }

            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
                return NextResponse.json(
                    { ok: false, error: 'That doesn\u2019t look like an email address.' },
                    { status: 400 }
                );
            }

            const auth = await manageAuth(admin, target, listingId, user.id);
            if (!auth) {
                return NextResponse.json({ ok: false, error: 'Not your listing' }, { status: 403 });
            }
            const listing = auth.listing;

            // Whether it's their own address or someone else's, the owner of a
            // listing already has everything a co-host could be given.
            const { data: ownerUser } = await admin.auth.admin.getUserById(listing.host_id);
            const ownerEmail = ((ownerUser && ownerUser.user && ownerUser.user.email) || '').toLowerCase();

            if (email === ownerEmail) {
                return NextResponse.json(
                    { ok: false, error: 'They already own this ' + target.noun + '.' },
                    { status: 400 }
                );
            }

            // Staff permissions are fixed by the database trigger; these are
            // only meaningful for a co-host.
            const permissions = {
                can_calendar: !!body.can_calendar,
                can_messages: !!body.can_messages,
                can_bookings: !!body.can_bookings,
                can_listing: !!body.can_listing,
                can_earnings: !!body.can_earnings,
            };

            if (role === 'co_host' && !Object.values(permissions).some(Boolean)) {
                return NextResponse.json(
                    { ok: false, error: 'Choose at least one thing they can do.' },
                    { status: 400 }
                );
            }

            // A full-access co-host may add helpers, but only the owner may hand
            // out full access — their own level — so it cannot spread on its own.
            if (!auth.isOwner && isFullGrant(permissions)) {
                return NextResponse.json(
                    { ok: false, error: 'Only the owner can give a co-host full access.' },
                    { status: 403 }
                );
            }

            // If they already have an account, link it now so they see the
            // listing the moment they sign in.
            const { data: existingProfile } = await admin
                .from('profiles')
                .select('id')
                .ilike('email', email)
                .maybeSingle();

            const { data: created, error } = await admin
                .from(target.table)
                .insert({
                    [target.fk]: listingId,
                    email: email,
                    user_id: (existingProfile && existingProfile.id) || null,
                    role: role,
                    invited_by: user.id,
                    ...permissions,
                })
                .select('id, invite_token')
                .single();

            if (error) {
                const duplicate = (error.message || '').indexOf(target.uniqueIndex) !== -1;
                return NextResponse.json(
                    {
                        ok: false,
                        error: duplicate
                            ? 'That person already has access to this ' + target.noun + '.'
                            : error.message,
                    },
                    { status: 400 }
                );
            }

            const link = SITE_URL + '/invite/' + created.invite_token;

            await sendEmail(
                email,
                'You\u2019ve been invited to co-host ' + (listing.title || target.fallbackTitle),
                emailLayout(
                    '<p style="margin:0 0 16px;font-size:16px;">You\u2019ve been invited to help '
                        + (target.kind === 'provider' ? 'run' : 'look after') + ' <strong>'
                        + escapeHtml(listing.title || target.fallbackTitle)
                        + '</strong> on Galloway Getaways.</p>'
                        + '<p style="margin:0 0 16px;font-size:16px;">Exactly what you can do is up to the owner, and you\u2019ll see it when you accept.</p>'
                        + '<p style="margin:0 0 16px;font-size:16px;">If you don\u2019t already have an account, you\u2019ll be asked to make one first. Use this same email address.</p>'
                        + button(link, 'Accept the invitation'),
                    'You\u2019re receiving this because someone invited you to help with their ' + target.noun + '.'
                )
            );

            return NextResponse.json({ ok: true, id: created.id });
        }

        // ---- Change what someone can do ------------------------------------
        if (action === 'update') {
            const accessId: string = body.accessId;

            const { data: row } = await admin
                .from(target.table)
                .select('id, role, ' + target.fk)
                .eq('id', accessId)
                .maybeSingle();

            if (!row) {
                return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
            }

            const auth = await manageAuth(admin, target, row[target.fk], user.id);
            if (!auth) {
                return NextResponse.json({ ok: false, error: 'Not your listing' }, { status: 403 });
            }

            const nextPerms = {
                can_calendar: !!body.can_calendar,
                can_messages: !!body.can_messages,
                can_bookings: !!body.can_bookings,
                can_listing: !!body.can_listing,
                can_earnings: !!body.can_earnings,
            };

            // Same line as invite: a co-host manager may not raise anyone to full
            // access — only the owner mints an owner-equal.
            if (!auth.isOwner && isFullGrant(nextPerms)) {
                return NextResponse.json(
                    { ok: false, error: 'Only the owner can give a co-host full access.' },
                    { status: 403 }
                );
            }

            await admin
                .from(target.table)
                .update(nextPerms)
                .eq('id', accessId);

            return NextResponse.json({ ok: true });
        }

        // ---- Take access away ----------------------------------------------
        if (action === 'revoke') {
            const accessId: string = body.accessId;

            const { data: row } = await admin
                .from(target.table)
                .select('id, ' + target.fk)
                .eq('id', accessId)
                .maybeSingle();

            if (!row) {
                return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
            }

            const auth = await manageAuth(admin, target, row[target.fk], user.id);
            if (!auth) {
                return NextResponse.json({ ok: false, error: 'Not your listing' }, { status: 403 });
            }

            await admin
                .from(target.table)
                .update({ status: 'revoked' })
                .eq('id', accessId);

            return NextResponse.json({ ok: true });
        }

        // ---- Step away from a property you help with ------------------------
        if (action === 'leave') {
            // Leave by the grant id, or — now that leaving lives in the listing's
            // own settings rather than on a dashboard card — by the listing id,
            // resolving the caller's own active grant on it.
            const accessId: string = body.accessId;
            const listingId: string = target.kind === 'provider' ? body.providerId : body.listingId;

            const query = admin
                .from(target.table)
                .select('id, user_id, email, ' + target.fk)
                .eq('user_id', user.id)
                .eq('status', 'active');
            const { data: row } = accessId
                ? await query.eq('id', accessId).maybeSingle()
                : await query.eq(target.fk, listingId).maybeSingle();

            if (!row || row.user_id !== user.id) {
                return NextResponse.json({ ok: false, error: 'Not yours to leave' }, { status: 403 });
            }

            await admin
                .from(target.table)
                .update({ status: 'revoked' })
                .eq('id', row.id);

            // The owner needs to know they've lost a pair of hands.
            const { data: parent } = await admin
                .from(target.parent)
                .select(target.titleCol + ', ' + target.ownerCol)
                .eq('id', row[target.fk])
                .maybeSingle();
            const listing = parent ? { title: parent[target.titleCol], host_id: parent[target.ownerCol] } : null;

            if (listing) {
                const { data: ownerUser } = await admin.auth.admin.getUserById(listing.host_id);
                const ownerEmail = (ownerUser && ownerUser.user && ownerUser.user.email) || '';

                // Name the person, not their raw email — the subject should not
                // carry an address (it leaks and reads unprofessionally).
                const { data: leaverProfile } = await admin
                    .from('profiles')
                    .select('full_name, first_name, last_name, preferred_name, show_full_name')
                    .eq('id', row.user_id)
                    .maybeSingle();
                const leaverName = displayName(leaverProfile, row.email || 'A co-host');

                if (ownerEmail) {
                    await sendEmail(
                        ownerEmail,
                        leaverName + ' has stepped down as a co-host',
                        emailLayout(
                            '<p style="margin:0 0 16px;font-size:16px;"><strong>'
                                + escapeHtml(leaverName)
                                + '</strong> no longer helps with <strong>'
                                + escapeHtml(listing.title || 'your ' + target.noun)
                                + '</strong>. They removed themselves.</p>'
                                + '<p style="margin:0 0 16px;font-size:16px;">Nothing else has changed, and you can invite someone else whenever you like.</p>'
                                + button(SITE_URL + target.peopleUrl, 'Manage co-hosts'),
                            target.footer
                        )
                    );
                }
            }

            return NextResponse.json({ ok: true });
        }

        return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
    } catch (err: any) {
        console.error('[listing-access]', err && err.message);

        // The console is nobody's alarm. The person invited is waiting for an email that is never coming, and the
        // host believes they have handed over access.
        await logError('listing-access: a co-host invitation failed', err, {
            path: 'api/listing-access',
            userId: reporterId || undefined,
        });
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Something went wrong' },
            { status: 500 }
        );
    }
}
