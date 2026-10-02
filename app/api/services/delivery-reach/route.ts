import { adminClient } from '@/lib/supabaseAdmin';
import { NextResponse } from 'next/server';
import { deliveryReach, type ReachDecision } from '@/lib/postcodeGeocode';
import { outOfReachMessage } from '@/lib/deliveryReachMessage';
import { extractUkPostcode, hasUkPostcode } from '@/lib/postcode';
import { withinLimits, callerAddress } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

// PREFLIGHT: can this provider reach this delivery address? A read-only check so
// the delivery-address modal can refuse an out-of-area postcode at Save, with
// the SAME plain message the order route shows before payment — not a failed
// checkout later. It creates nothing and charges nothing.
//
// It is the exact same test the order route runs (deliveryReach, from the
// provider's own delivery_radius_miles and base postcode, falling back to the
// Dumfries & Galloway council-area gate when they set no radius). The order route
// stays the authority — this route is a courtesy that runs the check early, and
// the money path re-runs it on the frozen provider row regardless of what the
// browser was told here.
//
// No sign-in required (an anonymous standalone booker types an address too), so
// it is rate-limited by IP: the check hits a free geocoder (postcodes.io), and an
// open endpoint that geocodes on demand is somebody's to abuse.
export async function POST(request: Request) {
    try {
        const verdict = await withinLimits([
            { bucket: 'delivery-reach:ip', key: callerAddress(request.headers), max: 60, windowMinutes: 60 },
        ]);
        if (!verdict.ok) {
            return NextResponse.json({ ok: false, error: 'Too many address checks in a short time. Try again shortly.' }, { status: 429 });
        }

        const body = await request.json().catch(() => ({}));
        const providerId = String(body?.providerId || '').trim();
        // Accept either a bare postcode or a full address line; the reach check
        // only needs the postcode, extracted the same forgiving way the order
        // route does.
        const raw = String(body?.postcode || body?.address || '').slice(0, 300).trim();
        const postcode = extractUkPostcode(raw);
        if (!providerId) return NextResponse.json({ ok: false, error: 'Missing provider' }, { status: 400 });
        if (!postcode || !hasUkPostcode(raw)) {
            return NextResponse.json({ ok: false, error: 'Add a full address, including a postcode.' }, { status: 400 });
        }

        const admin = adminClient();
        const { data: prov } = await admin
            .from('service_providers')
            .select('id, business_name, shape, fulfilment, delivery_radius_miles, collection_postcode')
            .eq('id', providerId)
            .maybeSingle();
        if (!prov) return NextResponse.json({ ok: false, error: 'That provider isn’t available.' }, { status: 404 });

        // A provider who neither delivers nor travels has no reach to check — the
        // modal shouldn't ask, but if it does, don't refuse a collection-only one.
        const travels = prov.fulfilment === 'delivery' || prov.fulfilment === 'both' || prov.shape === 'comes_to_you';
        if (!travels) return NextResponse.json({ ok: true, reachable: true });

        const radius = Number(prov.delivery_radius_miles) || 0;
        const decision: ReachDecision = await deliveryReach({
            radiusMiles: radius,
            basePostcode: prov.collection_postcode,
            guestPoint: null,
            guestPostcode: postcode,
        });

        if (decision.ok) return NextResponse.json({ ok: true, reachable: true });

        const verb = prov.shape === 'comes_to_you' ? 'travel' : 'deliver';
        return NextResponse.json({
            ok: true,
            reachable: false,
            message: outOfReachMessage(decision, prov.business_name || 'this provider', radius, verb),
        });
    } catch (err: any) {
        console.error('[services/delivery-reach]', err && err.message);
        return NextResponse.json({ ok: false, error: 'Could not check that address just now.' }, { status: 500 });
    }
}
