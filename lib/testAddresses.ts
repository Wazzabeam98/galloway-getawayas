// Addresses that belong to automated runs rather than to people.
//
// The automated suites sign up tradesmen — scripts/journeys.mjs posts to
// /api/services/apply, the Playwright suite presses the button in a browser —
// and every one of those submissions rang the real alert bell. The services
// inbox ended up with a row of near-identical "New business waiting: E2E
// Joinery" emails, which is worse than noise: an alert that mostly fires for
// nothing is an alert that stops being read, and the one real application in
// among them is the one that gets missed.
//
// So mail about a test account is not sent. The decision is made on the
// address, not on an environment variable, for two reasons:
//
//   It cannot be got wrong per environment. NODE_ENV and VERCEL_ENV have to be
//   right on every deployment that runs a test, and this project has already
//   shipped one env-var scoping mistake (RESEND_API_KEY set on Production but
//   not Preview, which made sending look successful while nothing left).
//
//   It cannot leak. A reserved TLD can never be a real domain, so there is no
//   input on which this suppresses somebody's genuine application.
//
// RFC 2606 and RFC 6761 set these aside permanently, for exactly this use.
const RESERVED_TLDS = ['.test', '.example', '.invalid', '.localhost'];

/**
 * True for an address that can only belong to an automated run.
 *
 * Deliberately narrow. It does NOT try to spot addresses that merely look
 * automated — no "+test", no "noreply", no matching on the local part — because
 * a person really can be qa+test@gmail.com and silently dropping their
 * application is a far worse failure than one extra email.
 */
export function isAutomatedTestAddress(email: string | null | undefined): boolean {
    const address = String(email || '').trim().toLowerCase();
    if (!address.includes('@')) return false;
    const domain = address.slice(address.lastIndexOf('@') + 1);
    if (!domain) return false;
    return RESERVED_TLDS.some((tld) => domain === tld.slice(1) || domain.endsWith(tld));
}
