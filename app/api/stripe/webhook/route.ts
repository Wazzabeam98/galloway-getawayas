import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { verifyStripeSignature } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

function adminClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );
}

export async function POST(request: Request) {
    // The signature is calculated over the exact bytes Stripe sent, so the
    // body has to be read as text before anything parses it.
    const rawBody = await request.text();
    const signature = request.headers.get('stripe-signature');
    const secret = process.env.STRIPE_WEBHOOK_SECRET || '';

    const valid = await verifyStripeSignature(rawBody, signature, secret);
    if (!valid) {
        console.error('[stripe/webhook] bad signature');
        return NextResponse.json({ ok: false }, { status: 400 });
    }

    let event: any;
    try {
        event = JSON.parse(rawBody);
    } catch (err) {
        return NextResponse.json({ ok: false }, { status: 400 });
    }

    const admin = adminClient();

    // Stripe retries, so the same event can arrive more than once. The
    // primary key on event_id turns a repeat into a harmless conflict.
    const { error: logError } = await admin
        .from('stripe_events')
        .insert({ event_id: event.id, event_type: event.type, payload: event });

    if (logError && logError.code === '23505') {
        return NextResponse.json({ ok: true, duplicate: true });
    }

    try {
        if (event.type === 'account.updated') {
            const account = event.data.object;
            const due: string[] = (account.requirements && account.requirements.currently_due) || [];
            const payoutsOn = account.payouts_enabled === true;

            await admin
                .from('profiles')
                .update({
                    stripe_charges_enabled: account.charges_enabled === true,
                    stripe_payouts_enabled: payoutsOn,
                    stripe_details_submitted: account.details_submitted === true,
                    stripe_requirements_due: due.length ? due.join(', ') : null,
                    // A host who can receive payouts has passed Stripe's
                    // identity checks — that's the verified tick.
                    identity_verified: payoutsOn,
                    identity_verified_at: payoutsOn ? new Date().toISOString() : null,
                    stripe_updated_at: new Date().toISOString(),
                })
                .eq('stripe_account_id', account.id);
        }
    } catch (err: any) {
        console.error('[stripe/webhook] handler failed:', event.type, err && err.message);
        // Still return 200 — the event is logged, and telling Stripe it
        // failed just means it retries a broken handler forever.
    }

    return NextResponse.json({ ok: true });
}
