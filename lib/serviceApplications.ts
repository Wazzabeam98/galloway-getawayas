// An application that has not proved its address yet.
//
// WHY THIS IS A SEPARATE THING FROM AN ACCOUNT
//
// /api/services/apply used to create a real Supabase auth user on the first
// press of a public form. A stranger could type your address into it and you
// then had an account you never made: you could not sign up later, because the
// address was taken, and you got a confirmation email you never asked for.
//
// So the application is held here — in service_applications, which no browser
// role can read — and the account is made at the moment the emailed link is
// opened, by somebody who has demonstrably received mail at that address.
//
// TWO CLOCKS, AND CONFLATING THEM IS THE MISTAKE
//
// The LINK is a bearer credential: whoever holds it creates an account on that
// address. The APPLICATION is a person's work — their trades, their areas,
// their prices — and losing it is the failure this whole flow was reorganised
// to avoid. They should not expire together, and they do not.
//
//   LINK_DAYS      the link stops working
//   RETENTION_DAYS the application is deleted
//
// A tradesman opening a dead link three weeks later loses nothing: the row is
// still there and one press mints a new token against it. Fourteen days is set
// from a real case rather than a round number — a joiner who applies on Friday
// and spends a fortnight on a job in Ayrshire is ordinary, and the link sitting
// unused in his inbox costs us nothing.

import { emailLayout, escapeHtml, button, SITE_URL } from '@/lib/email';
import { newApplicationToken, hashApplicationToken } from '@/lib/serviceApplicationToken';

/** How long an emailed link works for. */
export const LINK_DAYS = 14;

/** How long the application itself is kept if nobody ever opens the link. */
export const RETENTION_DAYS = 90;

/** How many times we will re-send a link before saying talk to a person. */
export const RESEND_CEILING = 5;

/** Minimum gap between re-sends of the same application. */
export const RESEND_COOLDOWN_SECONDS = 60;

export interface ApplicationRow {
    id: string;
    email: string;
    name: string | null;
    trade: string;
    business_name: string;
    contact_phone: string | null;
    payload: any;
    token_sent_at: string;
    resend_count: number;
    last_resend_at: string | null;
    created_at: string;
    claimed_at: string | null;
    provider_id: string | null;
}

/**
 * A fresh token and the hash to store beside it.
 *
 * The token is returned once, to be emailed, and never written down. The mint
 * and the hash both live in lib/serviceApplicationToken.ts — see the note
 * there, and tests/enquiry-token.test.ts for why nothing else may do it.
 */
export function mintToken(): { token: string; hash: string } {
    const token = newApplicationToken();
    return { token, hash: hashApplicationToken(token) };
}

export function hashToken(token: string): string {
    return hashApplicationToken(token);
}

function daysAfter(iso: string, days: number): number {
    return new Date(iso).getTime() + days * 24 * 60 * 60 * 1000;
}

/** True once the emailed link has stopped working. */
export function linkExpired(row: { token_sent_at: string }, now: Date = new Date()): boolean {
    return now.getTime() > daysAfter(row.token_sent_at, LINK_DAYS);
}

/** Whole days left before the APPLICATION is deleted. Never negative. */
export function daysUntilDeleted(row: { created_at: string }, now: Date = new Date()): number {
    const left = daysAfter(row.created_at, RETENTION_DAYS) - now.getTime();
    return left <= 0 ? 0 : Math.ceil(left / (24 * 60 * 60 * 1000));
}

/** Whole days since the application was lodged. */
export function daysWaiting(row: { created_at: string }, now: Date = new Date()): number {
    const since = now.getTime() - new Date(row.created_at).getTime();
    return since <= 0 ? 0 : Math.floor(since / (24 * 60 * 60 * 1000));
}

/** Where the link goes. One place, so the email and the resend cannot disagree. */
export function finishUrl(token: string, origin?: string): string {
    return (origin || SITE_URL) + '/services/join/finish/' + encodeURIComponent(token);
}

/**
 * The email a tradesman gets, and the one a squatted stranger gets.
 *
 * They are the same message, and the last paragraph is the reason this whole
 * change exists: it can now say something true that the old flow's email could
 * not — that no account has been made. Under the old route they were reading a
 * confirmation for an account already created in their name.
 */
export function verificationEmail(row: {
    business_name: string;
    token_sent_at?: string;
}, token: string, origin?: string): { subject: string; html: string } {
    const business = escapeHtml(row.business_name || 'your business');

    return {
        subject: 'Finish listing ' + (row.business_name || 'your business') + ' on Galloway Getaways',
        html: emailLayout(
            '<p style="margin:0 0 16px;font-size:16px;">Your application for <strong>' + business
                + '</strong> is saved. There is one step left.</p>'
            + '<p style="margin:0 0 16px;font-size:16px;">Choose a password and it goes to us to read.'
                + ' Everything you typed is already saved — the work you cover, your areas, your'
                + ' prices — so this takes a few seconds.</p>'
            + button(finishUrl(token, origin), 'Finish your application')
            + '<p style="margin:0 0 16px;font-size:14px;color:#6b7280;">This link works for '
                + LINK_DAYS + ' days. After that it stops working, but <strong style="color:#111827">'
                + 'your application does not go anywhere</strong> — open it anyway and we will send'
                + ' you a new one.</p>'
            + '<p style="margin:16px 0 0;padding-top:14px;border-top:1px solid #e5e7eb;'
                + 'font-size:14px;color:#6b7280;"><strong style="color:#111827">Did not apply?</strong>'
                + ' Somebody has typed your address into our form.'
                + ' <strong style="color:#111827">No account has been made</strong> and nothing will'
                + ' happen if you ignore this. Reply to this email and we will delete it.</p>',
            'You are receiving this because this address was used to apply to list a business on Galloway Getaways.'
        ),
    };
}

/**
 * The other email: the address already has an account.
 *
 * Sent instead of telling the browser so, because "there is already an account
 * on that address" is an oracle any stranger can query — the old route
 * answered exactly that, with a 409. Both cases now look identical from
 * outside, and the difference is carried by the message only its owner can read.
 */
export function alreadyHaveAccountEmail(row: { business_name: string; trade?: string }): {
    subject: string;
    html: string;
} {
    const business = escapeHtml(row.business_name || 'your business');
    const joinUrl = SITE_URL + '/services/join?trade=' + encodeURIComponent(row.trade || '');

    return {
        subject: 'Finish listing ' + (row.business_name || 'your business') + ' on Galloway Getaways',
        html: emailLayout(
            '<p style="margin:0 0 16px;font-size:16px;">Your application for <strong>' + business
                + '</strong> is saved.</p>'
            + '<p style="margin:0 0 16px;font-size:16px;">You already have a Galloway Getaways'
                + ' account on this address, so there is nothing to set up — sign in and it will be'
                + ' waiting for you.</p>'
            + button(joinUrl, 'Sign in and finish')
            + '<p style="margin:16px 0 0;padding-top:14px;border-top:1px solid #e5e7eb;'
                + 'font-size:14px;color:#6b7280;"><strong style="color:#111827">Did not apply?</strong>'
                + ' Somebody has typed your address into our form. Nothing has changed about your'
                + ' account and nothing will happen if you ignore this. Reply and we will delete it.</p>',
            'You are receiving this because this address was used to apply to list a business on Galloway Getaways.'
        ),
    };
}
