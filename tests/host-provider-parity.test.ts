// Host ↔ experience-provider parity (GG-PARITY-AUDIT, 21 Oct 2026): reviews,
// payouts, earnings, the pending-work badge — and the host's own "it's in
// review" email (tested with the publish route, publish-submit-for-review).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases, stubModule, clearModule } from './helpers/stub';

installAliases();

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const { providerPayoutRows } = require('../lib/providerPayoutRows');
const { scheduleFromBody, PROVIDER_RELEASE_SENTENCE } = require('../lib/payoutScheduleInput');
const { experienceReviewRequestEmail, experienceReviewReceivedEmail } = require('../lib/experienceReviewEmails');
const { stayReviewReceivedEmail } = require('../lib/stayReviewEmails');
const { reviewSubmissionProblem, experienceReviewDaysLeft } = require('../lib/experienceReviewRules');
const { pushForEmail } = require('../lib/pushRules');

// ---------------------------------------------------------------------------
// EARNINGS — "Your payouts", the host's list for an experience

const held = (over: any) => ({
    id: 'o', provider_id: 'p', status: 'confirmed', service_date: '2026-10-20', price: 100, commission_rate: 0.1,
    amount_refunded: 0, funds_flow: 'held', paid_out_at: null, item_name: 'Smokehouse tasting', ...over,
});

test('still to come: held and unpaid, paid the day after, due now once the date has passed', () => {
    const { awaiting, stillToCome } = providerPayoutRows([
        held({ id: 'past', service_date: '2026-10-19' }),
        held({ id: 'future', service_date: '2026-10-25' }),
    ], '2026-10-21');
    assert.deepEqual(awaiting.map((r: any) => [r.id, r.payDate, r.dueNow]), [['past', '2026-10-20', true], ['future', '2026-10-26', false]]);
    assert.equal(awaiting[0].expected, 90, 'their share: what was paid, less our 10%');
    assert.equal(stillToCome, 180);
});

test('already paid: the payout amount and the day it went, newest first', () => {
    const { alreadyPaid, awaiting } = providerPayoutRows([
        held({ id: 'a', paid_out_at: '2026-10-02T03:00:00Z', payout_amount: 45 }),
        held({ id: 'b', paid_out_at: '2026-10-09T03:00:00Z', payout_amount: 90 }),
    ], '2026-10-21');
    assert.equal(awaiting.length, 0);
    assert.deepEqual(alreadyPaid.map((r: any) => [r.id, r.paidOn, r.amount]), [['b', '2026-10-09', 90], ['a', '2026-10-02', 45]]);
});

test('the payout run\'s rule: refunded, direct and plain-cancelled orders are not owed', () => {
    const { awaiting } = providerPayoutRows([
        held({ id: 'refunded', status: 'refunded' }),
        held({ id: 'direct', funds_flow: 'direct' }),
        held({ id: 'cancelled', status: 'cancelled', cancel_ack: null }),
        held({ id: 'walked', status: 'cancelled', cancel_ack: { at: 'x' } }),
    ], '2026-10-21');
    assert.deepEqual(awaiting.map((r: any) => r.id), ['walked'], 'a walk-away is the provider\'s to keep');
});

test('the earnings page shows the list, Stripe\'s timing and (to the owner) payout settings', () => {
    const page = read('app/services/dashboard/earnings/page.tsx');
    assert.match(page, /providerPayoutRows\(/);
    assert.match(page, />Your payouts</);
    assert.match(page, /Already paid/);
    assert.match(page, /readSchedule\(provider\.stripe_account_id\)/);
    assert.doesNotMatch(page, /usually takes about a week/, 'the arrival is read off their account, not written down');
    assert.match(page, /\{isOwner && \(\s*<> <Link href="\/account\?section=payments"/);
});

// ---------------------------------------------------------------------------
// PAYOUTS — bank, schedule, Manage in Stripe

test('the schedule choice: the host\'s rules, only the chosen interval\'s anchor goes up', () => {
    assert.deepEqual(scheduleFromBody({ interval: 'daily', weekly_anchor: 'monday' }), { ok: true, schedule: { interval: 'daily' } });
    assert.deepEqual(scheduleFromBody({ interval: 'weekly', weekly_anchor: 'Monday' }), { ok: true, schedule: { interval: 'weekly', weekly_anchor: 'monday' } });
    assert.deepEqual(scheduleFromBody({ interval: 'monthly', monthly_anchor: '28' }), { ok: true, schedule: { interval: 'monthly', monthly_anchor: 28 } });
    assert.equal(scheduleFromBody({ interval: 'monthly', monthly_anchor: 29 }).ok, false, '29th–31st don\'t exist every month');
    assert.equal(scheduleFromBody({ interval: 'weekly', weekly_anchor: 'someday' }).ok, false);
    assert.equal(scheduleFromBody({ interval: 'hourly' }).ok, false);
    assert.match(PROVIDER_RELEASE_SENTENCE, /day after the experience/);
});

test('payout settings are the owner\'s alone, and never change the bank or delay_days', () => {
    const route = read('app/api/services/payout-settings/route.ts');
    assert.match(route, /\.eq\('owner_id', userId\)/, 'scoped to businesses the caller owns');
    assert.match(route, /getUser\(\)/);
    assert.match(route, /\{ settings: \{ payouts: \{ schedule: parsed\.schedule \} \} \}/, 'only the schedule the shared rule built — which never carries delay_days');
    assert.doesNotMatch(route, /external_accounts', \{|external_accounts\/[^?]/, 'reads the bank, never writes it');
    const card = read('components/services/ProviderPayoutsCard.tsx');
    assert.match(card, /action: 'dashboard'/, '"Change" / "Manage at Stripe" opens the Express dashboard');
    const connect = read('app/api/services/connect/route.ts');
    assert.match(connect, /provider\.owner_id !== user\.id/, 'the dashboard link is owner-only');
    const account = read('components/account/PaymentsSection.tsx');
    assert.match(account, /<ProviderPayoutsCard/, 'shown in /account → Payments, as a host\'s are');
});

// ---------------------------------------------------------------------------
// REVIEWS

test('the review request: the stay\'s email, for an experience, to its review page', () => {
    const { subject, html } = experienceReviewRequestEmail({ orderId: 'ord-1', title: 'Smoked on the Solway', guestFirst: 'Morag', unsubscribeToken: 'tok' });
    assert.equal(subject, 'How was Smoked on the Solway?');
    assert.match(html, /Hi Morag/);
    assert.match(html, /\/experiences\/review\/ord-1/);
    assert.match(html, /type=review_prompts/, 'the same switch and unsubscribe as a stay\'s');
    assert.doesNotMatch(html, /Reviews close on/, 'an experience review has no closing date to quote');
    const push = pushForEmail(subject, html);
    assert.equal(push && push.kind, 'review.request.experience_guest');
    // The stay's subject still finds the stay's rule first.
    assert.equal(pushForEmail('How was your stay at Rowan Cottage?', '')!.kind, 'review.request.guest');
});

test('the review-received email: the review, and a link to read and reply', () => {
    const { subject, html } = experienceReviewReceivedEmail({ title: 'Smoked on the Solway', reviewerFirst: 'Ailsa', rating: 5, comment: 'Brilliant <b>afternoon</b>' });
    assert.equal(subject, 'New review for Smoked on the Solway');
    assert.match(html, /Ailsa/);
    assert.match(html, /5 stars/);
    assert.match(html, /Brilliant &lt;b&gt;afternoon&lt;\/b&gt;/, 'the guest\'s words are escaped');
    assert.match(html, /\/services\/dashboard\/reviews/);
    const push = pushForEmail(subject, html);
    assert.equal(push && push.kind, 'review.received.provider');
    assert.equal((push as any).team, 'can_messages', 'co-hosts with messages get a copy of the email');
});

test('the stay review-received email: the host hears, without the hidden review', () => {
    const hidden = stayReviewReceivedEmail({ title: 'Rowan Cottage', reviewerFirst: 'Ailsa', rating: 5, comment: 'Secret <b>words</b>', published: false });
    assert.equal(hidden.subject, 'New review of Rowan Cottage');
    assert.match(hidden.html, /Ailsa/);
    assert.doesNotMatch(hidden.html, /Secret/, 'a double-blind review is not shown before the host has written theirs');
    assert.doesNotMatch(hidden.html, /5 stars/);
    assert.match(hidden.html, /Write your review/);
    assert.match(hidden.html, /\/dashboard\/reviews/);
    const shown = stayReviewReceivedEmail({ title: 'Rowan Cottage', reviewerFirst: 'Ailsa', rating: 5, comment: 'Lovely <b>stay</b>', published: true });
    assert.match(shown.html, /5 stars/);
    assert.match(shown.html, /Lovely &lt;b&gt;stay&lt;\/b&gt;/, 'the guest\'s words are escaped');
    const push = pushForEmail(hidden.subject, hidden.html);
    assert.equal(push && push.kind, 'review.received.host');
    assert.equal((push as any).team, undefined, 'never copied to a business\'s co-hosts, even at a shared address');
    // The route copies co-hosts with messages and sends no second push.
    const route = read('app/api/reviews/route.ts');
    assert.match(route, /listing_access[\s\S]*can_messages/);
    assert.match(route, /sendEmail\(address, subject, html, false\)/);
    assert.match(read('app/review/[bookingId]/page.tsx'), /fetch\('\/api\/reviews'/);
});

test('an experience review closes 14 days after the day, as a stay\'s does', () => {
    assert.equal(experienceReviewDaysLeft('2026-10-01', '2026-10-02'), 13);
    assert.equal(experienceReviewDaysLeft('2026-10-01', '2026-10-15'), 0, 'service day + 14 is the last day');
    assert.equal(experienceReviewDaysLeft('2026-10-01', '2026-10-16'), -1, 'closed the day after');
    assert.equal(experienceReviewDaysLeft('2026-03-20', '2026-04-03'), 0, 'across the clocks changing');
    const page = read('app/experiences/order/[orderId]/page.tsx');
    assert.match(page, /reviewDaysLeft >= 0/);
    assert.match(page, /'Last day' : `\$\{reviewDaysLeft\} days left`/, 'the stay\'s countdown words');
    assert.match(read('app/experiences/review/[orderId]/page.tsx'), /The 14 day window for reviewing this experience has now closed\./);
});

test('one rule for a review\'s shape, in the form and the route', () => {
    assert.equal(reviewSubmissionProblem('o', 5, 'A lovely afternoon'), null);
    assert.ok(reviewSubmissionProblem('o', 0, 'A lovely afternoon'));
    assert.ok(reviewSubmissionProblem('o', 6, 'A lovely afternoon'));
    assert.ok(reviewSubmissionProblem('o', 4, 'Short'));
    assert.ok(reviewSubmissionProblem('', 4, 'A lovely afternoon'));
    assert.match(read('components/marketplace/ExperienceReviewForm.tsx'), /reviewSubmissionProblem\(/);
    assert.match(read('app/api/services/reviews/route.ts'), /reviewSubmissionProblem\(/);
});

test('the review is still saved as the guest — the row policy and window trigger still decide', () => {
    const route = read('app/api/services/reviews/route.ts');
    assert.match(route, /createRouteHandlerClient/);
    assert.match(route, /await supabase\.from\('reviews'\)\.insert\(/, 'inserted with the guest\'s own client');
    assert.doesNotMatch(route, /admin\.from\('reviews'\)\.insert/, 'never with the service role');
    assert.match(route, /sendEmail\(String\(provider\.contact_email\), subject, html, false\)/, 'no second push: the reviews trigger pushes the owner');
});

test('the review-request cron: once per booking, never after a review, never when switched off', () => {
    const cron = read('app/api/cron/experience-review-reminders/route.ts');
    assert.match(cron, /auth !== 'Bearer ' \+ secret/);
    assert.match(cron, /sent_experience_review_reminders/);
    assert.match(cron, /\.eq\('order_id', o\.id\)\s*\.eq\('reviewer_id', o\.guest_id\)/);
    assert.match(cron, /review_prompts === false/);
    assert.match(cron, /\.is\('parent_order_id', null\)/);
    assert.match(cron, /recordCronRun\(JOB/);
    const vercel = JSON.parse(read('vercel.json'));
    assert.ok(vercel.crons.some((c: any) => c.path === '/api/cron/experience-review-reminders'), 'scheduled');
});

test('a provider\'s review push opens their Reviews page; guests can find the review form', () => {
    const sql = read('supabase/migrations/20261021131054_experience_review_reminders_and_review_push_link.sql');
    assert.match(sql, /else '\/services\/dashboard\/reviews' end/);
    assert.match(sql, /security definer/);
    assert.match(sql, /exception when others then\s*null;/, 'a push never stops a review being saved');
    assert.match(read('app/experiences/order/[orderId]/page.tsx'), /href=\{`\/experiences\/review\/\$\{order\.id\}`\}/);
});

// ---------------------------------------------------------------------------
// THE PENDING-WORK BADGE — "needs a reply"

test('an experience provider\'s badge counts requests still to confirm; a trade\'s, enquiries', async () => {
    const calls: any[] = [];
    function builder(table: string) {
        const ops: any[] = [];
        const chain: any = new Proxy({}, {
            get(_t, prop: string) {
                if (prop === 'then') {
                    calls.push({ table, ops });
                    if (table === 'service_providers') return (r: any) => r({ data: [{ id: 'exp', audience: 'guest' }, { id: 'trade', audience: 'host' }] });
                    if (table === 'service_orders') return (r: any) => r({ count: 2 });
                    if (table === 'service_enquiries') return (r: any) => r({ count: 3 });
                    return (r: any) => r({ data: [] });
                }
                return (...args: any[]) => { ops.push([prop, ...args]); return chain; };
            },
        });
        return chain;
    }
    stubModule('@/lib/supabaseAdmin', { adminClient: () => ({ from: builder }) });
    stubModule('@/lib/providerAccess', { providerIdsWith: async () => ['exp', 'trade'] });
    clearModule('@/lib/badgeCounts');
    const { providerRequestsFor } = require('../lib/badgeCounts');
    assert.equal(await providerRequestsFor('eilidh'), 5);
    const orders = calls.find((c) => c.table === 'service_orders').ops;
    assert.ok(orders.some((o: any) => o[0] === 'eq' && o[1] === 'status' && o[2] === 'authorised'), 'authorised: card held, waiting on the provider');
    assert.ok(orders.some((o: any) => o[0] === 'is' && o[1] === 'parent_order_id' && o[2] === null), 'the booking, not an add-places row');
    assert.ok(orders.some((o: any) => o[0] === 'gte' && o[1] === 'service_date'), 'today or later — the Needs a reply rule');
    assert.ok(!orders.some((o: any) => o[2] === 'holding'), 'a guest part-way through paying is not work');
    clearModule('@/lib/badgeCounts');
});

test('the menu dot and the Reservations line carry it for an experience provider', () => {
    const nav = read('components/base/NavMenu.tsx');
    assert.match(nav, /<MenuUnreadDot enabled=\{session != null\} host=\{isHost\} provider=\{isProvider\}/);
    assert.match(nav, /<RequestsLink label='Reservations' \/>/);
});

test('the provider Reviews page dates each review DD/MM/YYYY, never a raw timestamp', () => {
    const page = read('app/services/dashboard/reviews/page.tsx');
    assert.match(page, /ukDate\(londonDayKey\(new Date\(r\.when\)\)\)/);
    assert.doesNotMatch(page, />\{r\.when\}</);
});
