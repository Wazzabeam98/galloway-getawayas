import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { hashReplyToken } from '@/lib/enquiryToken';
import { logError } from '@/lib/logError';
import { announceResponse } from '@/lib/serviceEnquiryAlert';
import { canRespond } from '@/lib/serviceEnquiries';

export const dynamic = 'force-dynamic';

// A tradesman answering, without signing in.
//
// WHY THIS IS A POST AND THE EMAIL LINK IS NOT
//
// The email links to a page. The page shows him what he is being asked and
// then he presses a button, and the button lands here. It would be shorter to
// answer straight from the link — and it would be wrong, because mail
// scanners, corporate filters and link previewers all fetch every URL in an
// email before a person has read a word of it. A GET that accepts an enquiry
// gets accepted by a virus scanner at four in the morning.
//
// So: opening the link marks it opened, which is true and harmless. Answering
// takes a press.
//
// WHAT A LEAKED TOKEN CAN AND CANNOT DO
//
// It can answer on his behalf, which is a nuisance. It cannot collect the
// host's phone number: accepting sends the details to the provider's
// registered contact address, never to whoever pressed the button. See
// announceResponse, where that is the load-bearing line.

interface Body {
    token?: string;
    reply?: string;
    message?: string;
}

export async function POST(req: Request) {
    try {
        const body: Body = await req.json();

        const token = String(body.token || '');
        const reply = String(body.reply || '');

        if (!token) {
            return NextResponse.json({ ok: false, error: 'No link.' }, { status: 400 });
        }
        if (reply !== 'yes' && reply !== 'no') {
            return NextResponse.json({ ok: false, error: 'Say yes or no.' }, { status: 400 });
        }

        const admin = adminClient();
        const hash = hashReplyToken(token);

        const { data: enquiry } = await admin
            .from('service_enquiries')
            .select('*')
            .eq('reply_token_hash', hash)
            .maybeSingle();

        if (!enquiry) {
            return NextResponse.json({ ok: false, error: 'That link is not valid.' }, { status: 404 });
        }

        // An expired enquiry is not answerable, and saying so plainly saves
        // him a wasted journey: the host was told two days ago to try
        // somebody else, and telling him it went through would be a lie.
        if (!canRespond(String(enquiry.status || ''))) {
            return NextResponse.json({
                ok: false,
                error: 'This one has already been dealt with.',
                status: enquiry.status,
            }, { status: 409 });
        }

        const now = new Date().toISOString();
        const message = String(body.message || '').trim().slice(0, 2000);

        const { data: saved, error } = await admin
            .from('service_enquiries')
            .update({
                status: reply === 'yes' ? 'accepted' : 'declined',
                responded_at: now,
                token_used_at: now,
                updated_at: now,
                provider_reply: reply === 'yes' && message ? message : null,
                decline_reason: reply === 'no' && message ? message : null,
            })
            .eq('id', enquiry.id)
            // Guarded on the status we read, so two presses of the same button
            // cannot produce two answers and two sets of emails.
            .in('status', ['sent', 'viewed'])
            .select('*')
            .single();

        if (error || !saved) {
            return NextResponse.json({
                ok: false,
                error: 'This one has already been dealt with.',
            }, { status: 409 });
        }

        const { data: provider } = await admin
            .from('service_providers')
            .select('id, business_name, contact_email, contact_phone')
            .eq('id', saved.provider_id)
            .maybeSingle();

        let listing: any = null;
        if (saved.listing_id) {
            const { data } = await admin
                .from('listings')
                .select('id, title, location')
                .eq('id', saved.listing_id)
                .maybeSingle();
            listing = data;
        }

        const alert = await announceResponse(saved, provider, listing);

        return NextResponse.json({ ok: true, status: saved.status, emailed: alert });
    } catch (err: any) {
        await logError('service-enquiry-respond', err);
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}
