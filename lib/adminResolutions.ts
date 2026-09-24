// Pure rules for the admin side of the stay Resolution Centre — the queue an
// escalated money request lands in, and the decision an admin records to close
// it. Kept free of Supabase/Stripe so the guard and the labels can be unit-
// tested on their own; app/admin/resolutions and the resolve route wire these in.
//
// An escalation moves NO money (see the migration): the guest declined or ignored
// a request they never paid, so there is nothing on the platform to send back.
// The admin records who the platform sided with and why, and that closes it.

import type { ResolutionStatus } from './resolutions';

export type AdminOutcome = 'for_host' | 'for_guest' | 'split' | 'dismissed';

// The four decisions, in the order the form offers them, each with the sentence
// the admin (and later the audit trail) reads. No money instruction is encoded
// here — these are findings, not transfers.
export const ADMIN_OUTCOMES: { value: AdminOutcome; label: string; blurb: string }[] = [
    { value: 'for_host', label: 'For the host', blurb: 'The request was fair. Settle it with the guest off-platform.' },
    { value: 'for_guest', label: 'For the guest', blurb: 'The request does not stand. Nothing is owed.' },
    { value: 'split', label: 'Split / partial', blurb: 'Part of the request stands. Record what was agreed in the note.' },
    { value: 'dismissed', label: 'Dismissed', blurb: 'Raised in error or withdrawn. Close it with no finding.' },
];

const OUTCOME_VALUES = ADMIN_OUTCOMES.map((o) => o.value);

export function isAdminOutcome(value: unknown): value is AdminOutcome {
    return typeof value === 'string' && (OUTCOME_VALUES as string[]).includes(value);
}

export function outcomeLabel(value: string | null | undefined): string {
    const found = ADMIN_OUTCOMES.find((o) => o.value === value);
    return found ? found.label : 'Closed';
}

// A row is an OPEN escalation — the thing the queue lists and the only thing the
// resolve route may act on — while it is 'escalated' and not yet closed. Once
// resolved_at is stamped it drops out of the queue and can't be re-decided.
export function isOpenEscalation(row: { status: string | ResolutionStatus; resolved_at: string | null }): boolean {
    return row.status === 'escalated' && !row.resolved_at;
}

// The route's guard: an admin may resolve only an open escalation, and only with
// a real outcome and a non-empty note. The note is required for the same reason
// the migration ledger requires one — a closed dispute must always say why.
export function validateAdminResolve(
    row: { status: string; resolved_at: string | null } | null | undefined,
    outcome: unknown,
    note: unknown,
): { ok: boolean; error?: string } {
    if (!row) return { ok: false, error: 'No such escalation.' };
    if (!isOpenEscalation(row)) return { ok: false, error: 'That escalation is already closed.' };
    if (!isAdminOutcome(outcome)) return { ok: false, error: 'Choose an outcome.' };
    if (typeof note !== 'string' || !note.trim()) return { ok: false, error: 'Add a note saying why.' };
    return { ok: true };
}
