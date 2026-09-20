// Moving a slot booking to another session — the orchestration around the
// atomic RPC.
//
// The all-or-nothing swap itself lives in the database
// (move_order_family_to_session, 20260920210144): it moves a confirmed slot
// booking and its confirmed top-up children from one session to another in one
// transaction, or moves nobody. This module is the thin layer above it: call the
// RPC, and — only when it succeeds — tell the provider what changed, naming BOTH
// the old and the new time so a booking they were counting on for one slot isn't
// silently sitting on another.
//
// Relative imports on purpose: this module is exercised by a unit test, and the
// '@/' alias is a build-time path Node cannot resolve at runtime (the same reason
// experienceCancel.ts and slotNotify.ts import relatively).
import { sendEmail, emailLayout, detailRows, escapeHtml } from './email';
import { logError } from './logError';

export interface MoveResult {
    ok: boolean;
    error?: string;
    seats?: number;
    moved?: number;
    fromSessionId?: string;
    toSessionId?: string;
    fromDate?: string;
    fromTime?: string;
    toDate?: string;
    toTime?: string;
    /** True once the provider notification has been attempted (best-effort). */
    notified?: boolean;
}

// A human "date at time" for an email. The RPC hands back the date as YYYY-MM-DD
// and the time as HH:MM already, so this is presentation only.
export function whenLabel(date: string | null | undefined, time: string | null | undefined): string {
    const d = String(date || '').trim();
    const t = time ? String(time).slice(0, 5) : '';
    if (!d) return 'the booked time';
    return t ? d + ' at ' + t : d;
}

// The provider's "your booking has moved" email — PURE so a test can prove it
// names both times. The subject and the body both carry the old and the new
// slot, because the whole point of the notice is the change between them.
export function moveProviderEmail(args: {
    business?: string | null;
    itemName?: string | null;
    fromDate?: string | null;
    fromTime?: string | null;
    toDate?: string | null;
    toTime?: string | null;
    seats?: number | null;
}): { subject: string; html: string } {
    const oldWhen = whenLabel(args.fromDate, args.fromTime);
    const newWhen = whenLabel(args.toDate, args.toTime);
    const what = args.itemName || args.business || 'a booking';
    const seats = Math.max(1, Number(args.seats) || 1);
    const people = seats === 1 ? '1 place' : seats + ' places';

    const subject = 'A booking moved: ' + oldWhen + ' → ' + newWhen;
    const html = emailLayout(
        '<p style="margin:0 0 16px;font-size:16px;">A guest has moved their booking of <strong>'
        + escapeHtml(String(what)) + '</strong> (' + escapeHtml(people) + ') to a new time. '
        + 'The old slot has been freed and the new one claimed.</p>'
        + detailRows([
            { label: 'Was', value: escapeHtml(oldWhen) },
            { label: 'Now', value: escapeHtml(newWhen) },
        ])
        + '<p style="margin:16px 0 0;font-size:15px;color:#374151;">Please expect them at the new time, '
        + 'not the old one.</p>',
        'You’re receiving this because you offer experiences on Galloway Getaways.'
    );
    return { subject, html };
}

// Read the RPC's jsonb into a typed result.
function readRpc(row: any): MoveResult {
    if (!row || typeof row !== 'object') return { ok: false, error: 'move-failed' };
    if (!row.ok) return { ok: false, error: String(row.error || 'move-failed') };
    return {
        ok: true,
        seats: Number(row.seats) || 0,
        moved: Number(row.moved) || 0,
        fromSessionId: row.from_session || undefined,
        toSessionId: row.to_session || undefined,
        fromDate: row.from_date || undefined,
        fromTime: row.from_time || undefined,
        toDate: row.to_date || undefined,
        toTime: row.to_time || undefined,
    };
}

// Move a confirmed slot booking's whole family to another session, then — on
// success only — notify the provider. The caller (the route) has already checked
// the signed-in user is the order's payer.
//
// The money invariant lives in the RPC: it either lands the whole family on the
// target or leaves the source untouched. This function never partially applies
// anything; the notification is best-effort and its failure never un-does a move
// that has already committed.
export async function moveOrderFamily(
    admin: any,
    args: { orderId: string; targetSessionId: string; windowHours?: number }
): Promise<MoveResult> {
    let data: any = null;
    let error: any = null;
    try {
        const res = await admin.rpc('move_order_family_to_session', {
            p_order: args.orderId,
            p_target_session: args.targetSessionId,
            p_window_hours: Number.isFinite(args.windowHours as number) ? args.windowHours : 48,
        });
        data = res.data;
        error = res.error;
    } catch (e: any) {
        error = e;
    }

    // An unhandled raise inside the RPC (e.g. the no-overlap exclusion, 23P01)
    // rolled the whole thing back — the source is untouched, so this is a clean
    // "that time just went", not a half-move.
    if (error) {
        await logError('experience-move-rpc', { order: args.orderId, target: args.targetSessionId, message: String(error && error.message || error) });
        return { ok: false, error: 'unavailable' };
    }

    const result = readRpc(data);
    if (!result.ok) return result;

    // Tell the provider — best-effort, naming both times. A hiccup here must not
    // fail a move that has already committed.
    try {
        const { data: order } = await admin
            .from('service_orders')
            .select('provider_id, provider_business_name, item_name')
            .eq('id', args.orderId)
            .maybeSingle();
        const { data: prov } = order
            ? await admin.from('service_providers').select('contact_email').eq('id', order.provider_id).maybeSingle()
            : { data: null };
        if (prov && prov.contact_email) {
            const mail = moveProviderEmail({
                business: order.provider_business_name,
                itemName: order.item_name,
                fromDate: result.fromDate,
                fromTime: result.fromTime,
                toDate: result.toDate,
                toTime: result.toTime,
                seats: result.seats,
            });
            await sendEmail(String(prov.contact_email), mail.subject, mail.html);
            result.notified = true;
        }
    } catch (e: any) {
        await logError('experience-move-provider-email', { order: args.orderId, message: String(e && e.message) });
    }

    return result;
}
