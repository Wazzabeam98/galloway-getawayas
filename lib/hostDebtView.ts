// What a host is shown about money they owe us, and the rules for acting on it
// (pay it now, or dispute it). Kept apart from lib/hostDebt.ts, which is the
// payout run's arithmetic and on the money-path fingerprint list — wording and
// screens should not have to re-prove the payout scenarios to change.
//
// The debt itself is the `payouts` row (status 'owed'), exactly as before; this
// only reads it and explains it. See
// supabase/migrations/20261003101500_host_debt_settle_and_dispute.sql for the
// state machine: owed → settled (payout run, or paid now), owed → disputed →
// owed (upheld / reduced) or waived.

import { outstandingOf, round2, debtReason, type OwedRow } from './hostDebt';

export interface HostDebt extends OwedRow {
    disputed_at?: string | null;
    dispute_reason?: string | null;
    dispute_outcome?: 'upheld' | 'reduced' | 'waived' | null;
    dispute_note?: string | null;
    dispute_resolved_at?: string | null;
    booking?: {
        id: string;
        check_in: string | null;
        check_out: string | null;
        listing_title: string | null;
    } | null;
}

// One string literal, deliberately: supabase-js infers the row type from it,
// and a concatenation defeats that.
export const DEBT_SELECT = 'id, booking_id, host_id, amount, kind, status, note, created_at, settled_amount, waived_amount, disputed_at, dispute_reason, dispute_outcome, dispute_note, dispute_resolved_at, due_notice_sent_at';

// The figures a host needs to see on one debt: what it was, what has come back
// so far, what was let go on review, and what is still to pay.
export function debtFigures(d: HostDebt) {
    const original = round2(Math.abs(Number(d.amount || 0)));
    const recovered = round2(Number(d.settled_amount || 0));
    const waived = round2(Number(d.waived_amount || 0));
    return { original, recovered, waived, outstanding: outstandingOf(d) };
}

// Where a debt stands, in the host's words.
export function debtStatusLabel(d: HostDebt, hasComingPayouts: boolean): string {
    if (d.status === 'disputed') return 'Under review — not being taken while we look at it';
    if (d.status === 'waived') return 'Written off after review';
    if (d.status === 'settled') return 'Paid';
    if (outstandingOf(d) <= 0) return 'Paid';
    return hasComingPayouts ? 'Coming off your next payouts' : 'Due now';
}

export function debtTitle(d: HostDebt): string {
    return debtReason(d.kind);
}

// ONE rule for the dispute reason, used by the form and by the route.
export const DISPUTE_REASON_MAX = 1000;
export function disputeReasonProblem(reason: unknown): string | null {
    const text = typeof reason === 'string' ? reason.trim() : '';
    if (text.length < 10) return 'Tell us in a sentence or two why this isn’t right.';
    if (text.length > DISPUTE_REASON_MAX) return 'Keep it under ' + DISPUTE_REASON_MAX + ' characters.';
    return null;
}

// ONE rule for an admin decision, used by the form and by the route.
export type DebtOutcome = 'upheld' | 'reduced' | 'waived';
export function decisionProblem(outcome: unknown, keep: unknown, outstanding: number, note: unknown): string | null {
    if (outcome !== 'upheld' && outcome !== 'reduced' && outcome !== 'waived') return 'Choose an outcome.';
    if (typeof note !== 'string' || note.trim().length < 3) return 'Add a note — the host is sent it.';
    if (outcome === 'reduced') {
        const n = Number(keep);
        if (!(n > 0) || round2(n) >= round2(outstanding)) {
            return 'A reduced amount must be more than £0 and less than what is outstanding.';
        }
    }
    return null;
}

// Every debt a host should see: still owed, under review, and the ones closed
// in the last 90 days (so "Paid" and "Written off" are visible rather than the
// debt simply vanishing), oldest first, each with the booking it came from.
export async function hostDebtsForHost(admin: any, hostId: string): Promise<HostDebt[]> {
    if (!hostId) return [];
    const since = new Date(Date.now() - 90 * 86400000).toISOString();

    const { data } = await admin
        .from('payouts')
        .select(DEBT_SELECT)
        .eq('host_id', hostId)
        .in('kind', ['penalty', 'reversal', 'dispute'])
        .or('status.eq.owed,status.eq.disputed,and(status.in.(settled,waived),created_at.gte.' + since + ')')
        .order('created_at', { ascending: true });

    const rows: HostDebt[] = (data || []) as HostDebt[];
    return attachBookings(admin, rows);
}

export async function attachBookings(admin: any, rows: HostDebt[]): Promise<HostDebt[]> {
    const ids = Array.from(new Set(rows.map((r) => r.booking_id).filter(Boolean))) as string[];
    if (!ids.length) return rows;

    const { data: bookings } = await admin
        .from('bookings')
        .select('id, check_in, check_out, listing_id')
        .in('id', ids);
    const listingIds = Array.from(new Set((bookings || []).map((b: any) => b.listing_id).filter(Boolean)));
    const { data: listings } = listingIds.length
        ? await admin.from('listings').select('id, title').in('id', listingIds)
        : { data: [] };

    const titleOf: Record<string, string> = {};
    (listings || []).forEach((l: any) => { titleOf[l.id] = l.title; });
    const byId: Record<string, any> = {};
    (bookings || []).forEach((b: any) => {
        byId[b.id] = { id: b.id, check_in: b.check_in, check_out: b.check_out, listing_title: titleOf[b.listing_id] || null };
    });

    return rows.map((r) => ({ ...r, booking: r.booking_id ? byId[r.booking_id] || null : null }));
}

// Whether this host has any stay still to be paid out — the thing a debt comes
// off. Same definition as the payout run: confirmed, not yet paid out.
export async function hostHasComingPayouts(admin: any, hostId: string): Promise<boolean> {
    const { data } = await admin
        .from('bookings')
        .select('id')
        .eq('host_id', hostId)
        .eq('status', 'confirmed')
        .is('paid_out_at', null)
        .limit(1);
    return !!(data && data.length);
}
