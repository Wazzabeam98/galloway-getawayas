import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sendEmail, emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';

export const dynamic = 'force-dynamic';

function adminClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );
}

// Only the owner of a listing may hand out access to it. A co-host cannot
// invite further people, however much else they can do.
async function ownsListing(admin: any, listingId: string, userId: string) {
    const { data } = await admin
        .from('listings')
        .select('id, title, host_id')
        .eq('id', listingId)
        .maybeSingle();

    if (!data || data.host_id !== userId) return null;
    return data;
}

export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { session } } = await supabase.auth.getSession();

        if (!session || !session.user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const body = await request.json();
        const action: string = (body && body.action) || 'invite';
        const admin = adminClient();

        // ---- Invite someone ------------------------------------------------
        if (action === 'invite') {
            const listingId: string = body.listingId;
            const email: string = ((body.email || '') as string).trim().toLowerCase();
            const role = 'co_host';

            if (!listingId || !email) {
                return NextResponse.json(
                    { ok: false, error: 'Choose a property and enter an email address.' },
                    { status: 400 }
                );
            }

            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
                return NextResponse.json(
                    { ok: false, error: 'That doesn\u2019t look like an email address.' },
                    { status: 400 }
                );
            }

            const listing = await ownsListing(admin, listingId, session.user.id);
            if (!listing) {
                return NextResponse.json({ ok: false, error: 'Not your listing' }, { status: 403 });
            }

            // Whether it's their own address or someone else's, the owner of a
            // listing already has everything a co-host could be given.
            const { data: ownerUser } = await admin.auth.admin.getUserById(listing.host_id);
            const ownerEmail = ((ownerUser && ownerUser.user && ownerUser.user.email) || '').toLowerCase();

            if (email === ownerEmail) {
                return NextResponse.json(
                    { ok: false, error: 'They already own this property.' },
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

            // If they already have an account, link it now so they see the
            // listing the moment they sign in.
            const { data: existingProfile } = await admin
                .from('profiles')
                .select('id')
                .ilike('email', email)
                .maybeSingle();

            const { data: created, error } = await admin
                .from('listing_access')
                .insert({
                    listing_id: listingId,
                    email: email,
                    user_id: (existingProfile && existingProfile.id) || null,
                    role: role,
                    invited_by: session.user.id,
                    ...permissions,
                })
                .select('id, invite_token')
                .single();

            if (error) {
                const duplicate = (error.message || '').indexOf('listing_access_unique_person') !== -1;
                return NextResponse.json(
                    {
                        ok: false,
                        error: duplicate
                            ? 'That person already has access to this property.'
                            : error.message,
                    },
                    { status: 400 }
                );
            }

            const link = SITE_URL + '/invite/' + created.invite_token;
            const who = role === 'staff' ? 'to help look after' : 'as a co-host for';

            await sendEmail(
                email,
                'You\u2019ve been invited ' + who + ' ' + (listing.title || 'a property'),
                emailLayout(
                    '<p style="margin:0 0 16px;font-size:16px;">You\u2019ve been invited '
                        + who
                        + ' <strong>'
                        + escapeHtml(listing.title || 'a property')
                        + '</strong> on Galloway Getaways.</p>'
                        + (role === 'staff'
                            ? '<p style="margin:0 0 16px;font-size:16px;">You\u2019ll be able to see when guests are arriving and leaving, so you know when the place needs turning around. You won\u2019t see prices, messages or earnings.</p>'
                            : '<p style="margin:0 0 16px;font-size:16px;">You\u2019ll be able to help manage it. Exactly what you can do is up to the owner, and you\u2019ll see it when you accept.</p>')
                        + '<p style="margin:0 0 16px;font-size:16px;">If you don\u2019t already have an account, you\u2019ll be asked to make one first. Use this same email address.</p>'
                        + button(link, 'Accept the invitation'),
                    'You\u2019re receiving this because someone invited you to help with their property.'
                )
            );

            return NextResponse.json({ ok: true, id: created.id });
        }

        // ---- Change what someone can do ------------------------------------
        if (action === 'update') {
            const accessId: string = body.accessId;

            const { data: row } = await admin
                .from('listing_access')
                .select('id, listing_id, role')
                .eq('id', accessId)
                .maybeSingle();

            if (!row) {
                return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
            }

            const listing = await ownsListing(admin, row.listing_id, session.user.id);
            if (!listing) {
                return NextResponse.json({ ok: false, error: 'Not your listing' }, { status: 403 });
            }

            await admin
                .from('listing_access')
                .update({
                    can_calendar: !!body.can_calendar,
                    can_messages: !!body.can_messages,
                    can_bookings: !!body.can_bookings,
                    can_listing: !!body.can_listing,
                    can_earnings: !!body.can_earnings,
                })
                .eq('id', accessId);

            return NextResponse.json({ ok: true });
        }

        // ---- Take access away ----------------------------------------------
        if (action === 'revoke') {
            const accessId: string = body.accessId;

            const { data: row } = await admin
                .from('listing_access')
                .select('id, listing_id')
                .eq('id', accessId)
                .maybeSingle();

            if (!row) {
                return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
            }

            const listing = await ownsListing(admin, row.listing_id, session.user.id);
            if (!listing) {
                return NextResponse.json({ ok: false, error: 'Not your listing' }, { status: 403 });
            }

            await admin
                .from('listing_access')
                .update({ status: 'revoked' })
                .eq('id', accessId);

            return NextResponse.json({ ok: true });
        }

        // ---- Step away from a property you help with ------------------------
        if (action === 'leave') {
            const accessId: string = body.accessId;

            const { data: row } = await admin
                .from('listing_access')
                .select('id, listing_id, user_id, email')
                .eq('id', accessId)
                .maybeSingle();

            if (!row || row.user_id !== session.user.id) {
                return NextResponse.json({ ok: false, error: 'Not yours to leave' }, { status: 403 });
            }

            await admin
                .from('listing_access')
                .update({ status: 'revoked' })
                .eq('id', accessId);

            // The owner needs to know they've lost a pair of hands.
            const { data: listing } = await admin
                .from('listings')
                .select('title, host_id')
                .eq('id', row.listing_id)
                .maybeSingle();

            if (listing) {
                const { data: ownerUser } = await admin.auth.admin.getUserById(listing.host_id);
                const ownerEmail = (ownerUser && ownerUser.user && ownerUser.user.email) || '';

                if (ownerEmail) {
                    await sendEmail(
                        ownerEmail,
                        row.email + ' has stepped down as a co-host',
                        emailLayout(
                            '<p style="margin:0 0 16px;font-size:16px;"><strong>'
                                + escapeHtml(row.email)
                                + '</strong> no longer helps with <strong>'
                                + escapeHtml(listing.title || 'your property')
                                + '</strong>. They removed themselves.</p>'
                                + '<p style="margin:0 0 16px;font-size:16px;">Nothing else has changed, and you can invite someone else whenever you like.</p>'
                                + button(SITE_URL + '/dashboard/people', 'Manage co-hosts'),
                            'You\u2019re receiving this because you host on Galloway Getaways.'
                        )
                    );
                }
            }

            return NextResponse.json({ ok: true });
        }

        return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
    } catch (err: any) {
        console.error('[listing-access]', err && err.message);
        return NextResponse.json(
            { ok: false, error: (err && err.message) || 'Something went wrong' },
            { status: 500 }
        );
    }
}
