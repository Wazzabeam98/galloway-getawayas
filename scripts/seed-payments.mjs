// Seeds the test project for the payment scenarios: auth users, profiles,
// listings, bookings, and Stripe test Connect accounts.
//
//   node scripts/seed-payments.mjs           seed (resets first)
//   node scripts/seed-payments.mjs --reset   tear down and stop
//
// Nothing here is interactive. The one slow part is waiting for Stripe to
// verify a freshly created Connect account, which in test mode takes a couple
// of minutes; created accounts are cached in the manifest and reused.

import {
    loadEnv, assertTestEnvironment, stripeClient, supabaseClient,
    SEED_DOMAIN, SEED_TAG, sleep, dayOffset, writeManifest, MANIFEST,
} from './seed-lib.mjs';
import fs from 'node:fs';

const env = loadEnv();
assertTestEnvironment(env);

const stripe = stripeClient(env);
const db = supabaseClient(env);
const log = (...a) => console.log(...a);

/* ------------------------------------------------------------------ reset */

async function reset() {
    log('resetting seeded data\u2026');

    const users = await db.auth('GET', '/admin/users?per_page=200');
    const seeded = (users.users || []).filter((u) => (u.email || '').endsWith('@' + SEED_DOMAIN));

    if (!seeded.length) {
        log('  nothing to remove');
        return;
    }

    const inList = '(' + seeded.map((u) => u.id).join(',') + ')';

    // The seeded listings, needed up front: a listing can be referenced by a
    // booking or an order that a DIFFERENT (non-seeded) user made against it, and
    // those rows have to go before the listing does. Clearing children only by
    // seeded user misses them and the listing delete then fails on a foreign key.
    const listings = await db.select('listings', '?select=id&host_id=in.' + inList);
    const listingList = listings.length ? '(' + listings.map((l) => l.id).join(',') + ')' : null;

    // Children first — payouts and payments carry a booking_id with no cascade
    // behind it, so deleting the bookings out from under them would fail. Gather
    // every booking owned by a seeded user OR sitting on a seeded listing.
    const bookingFilter = listingList
        ? '?select=id&or=(guest_id.in.' + inList + ',host_id.in.' + inList + ',listing_id.in.' + listingList + ')'
        : '?select=id&or=(guest_id.in.' + inList + ',host_id.in.' + inList + ')';
    const bookings = await db.select('bookings', bookingFilter);
    if (bookings.length) {
        const bookingList = '(' + bookings.map((b) => b.id).join(',') + ')';
        // booking_resolutions is RESTRICT-linked to bookings (a resolution must
        // never be orphaned), so it has to go before the booking does or the
        // delete fails on its foreign key — which is exactly what stopped the
        // seed once the Resolution Centre landed. Its attachments cascade from
        // it, so removing the resolution rows clears those too.
        for (const table of ['booking_resolutions', 'booking_change_requests', 'payouts', 'payments', 'booking_guests', 'messages', 'reviews']) {
            await db.remove(table, '?booking_id=in.' + bookingList);
        }
        await db.remove('bookings', '?id=in.' + bookingList);
    }

    // Anything else hanging off a listing has to go before the listing does.
    // service_orders (guest experiences) postdate this reset and reference a
    // listing with no cascade, which is why a leftover order once failed the
    // whole seed on a foreign key.
    if (listingList) {
        for (const table of ['service_orders', 'listing_ical_feeds', 'calendar_overrides', 'listing_access']) {
            await db.remove(table, '?listing_id=in.' + listingList);
        }
    }

    // service_orders also carry a guest_id with no cascade, so an order made by a
    // seeded guest against a listing that is NOT seeded would block the profiles
    // delete below.
    await db.remove('service_orders', '?guest_id=in.' + inList);

    await db.remove('listings', '?host_id=in.' + inList);
    await db.remove('profiles', '?id=in.' + inList);
    for (const u of seeded) await db.auth('DELETE', '/admin/users/' + u.id);

    log('  removed ' + seeded.length + ' seeded user(s), ' + bookings.length + ' booking(s) and their rows');
}

/* ------------------------------------------------------------ Stripe side */

// A Connect account that can actually receive a transfer. Stripe test mode
// parks a new custom account in `pending_verification` for a minute or two
// even with the magic test values, so this waits rather than handing back an
// account the payout run would skip.
async function createOnboardedAccount(label) {
    const account = await stripe.request('POST', '/accounts', {
        type: 'custom',
        country: 'GB',
        email: label + '@' + SEED_DOMAIN,
        business_type: 'individual',
        capabilities: { transfers: { requested: 'true' }, card_payments: { requested: 'true' } },
        business_profile: {
            mcc: '7011',
            url: 'https://gallowaygetaways.co.uk',
            product_description: 'Self-catering holiday letting',
        },
        individual: {
            first_name: 'Seed',
            last_name: label,
            email: label + '@' + SEED_DOMAIN,
            phone: '+442071234567',
            id_number: '000000000',
            dob: { day: 1, month: 1, year: 1901 },
            // Stripe's magic value for an instantly matching address.
            address: { line1: 'address_full_match', city: 'Dumfries', postal_code: 'DG1 1AA', country: 'GB' },
        },
        tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: '127.0.0.1' },
        external_account: {
            object: 'bank_account', country: 'GB', currency: 'gbp',
            account_number: '00012345', routing_number: '108800',
        },
        metadata: { [SEED_TAG]: label },
    });

    log('  ' + label + ': created ' + account.id + ', waiting for verification…');

    for (let i = 0; i < 40; i++) {
        const fresh = await stripe.request('GET', '/accounts/' + account.id);
        if (fresh.payouts_enabled) {
            log('  ' + label + ': payouts enabled after ~' + i * 5 + 's');
            return fresh;
        }
        await sleep(5000);
    }
    throw new Error(label + ': Connect account never became payouts_enabled');
}

// A host who started onboarding and stopped. Scenario 21.
async function createUnonboardedAccount(label) {
    const account = await stripe.request('POST', '/accounts', {
        type: 'express',
        country: 'GB',
        email: label + '@' + SEED_DOMAIN,
        business_type: 'individual',
        capabilities: { transfers: { requested: 'true' }, card_payments: { requested: 'true' } },
        metadata: { [SEED_TAG]: label },
    });
    log('  ' + label + ': created ' + account.id + ' (payouts_enabled=' + account.payouts_enabled + ')');
    return account;
}

// Connect accounts are reused between runs because creating them is slow, so
// each run has to start them from a known state. A balance left over from last
// time — positive, or negative after a clawback — quietly changes what the next
// run observes.
async function normaliseConnectedBalance(accountId, label) {
    const balance = await stripe.request('GET', '/balance', null, { account: accountId });
    const gbp = (balance.available || []).find((b) => b.currency === 'gbp');
    const amount = gbp ? gbp.amount : 0;
    if (amount === 0) return;

    if (amount > 0) {
        // Send it on to their bank, the way a real payout would.
        await stripe.request('POST', '/payouts', { amount, currency: 'gbp' }, { account: accountId });
        log('  ' + label + ': drained £' + (amount / 100).toFixed(2) + ' to bank');
    } else {
        // Left negative by a previous clawback. Top it back up to zero.
        await stripe.request('POST', '/transfers', {
            amount: -amount, currency: 'gbp', destination: accountId,
            description: SEED_TAG + ': resetting a negative balance',
        });
        log('  ' + label + ': topped up £' + (-amount / 100).toFixed(2) + ' to clear a negative balance');
    }
}

// Transfers come out of the platform's *available* balance, which starts at
// zero because ordinary test charges sit in pending for a week. This test
// token lands straight in available.
async function fundPlatform(pounds) {
    const balance = await stripe.request('GET', '/balance');
    const gbp = (balance.available || []).find((b) => b.currency === 'gbp');
    const have = gbp ? gbp.amount / 100 : 0;
    if (have >= pounds) {
        log('  platform available balance is £' + have.toFixed(2) + ' — enough');
        return have;
    }
    const need = Math.ceil(pounds - have);
    await stripe.request('POST', '/charges', {
        amount: need * 100,
        currency: 'gbp',
        source: 'tok_bypassPending',
        description: SEED_TAG + ': funding the platform available balance',
    });
    const after = await stripe.request('GET', '/balance');
    const now = ((after.available || []).find((b) => b.currency === 'gbp') || {}).amount / 100;
    log('  platform available balance topped up to £' + now.toFixed(2));
    return now;
}

// A booking can only be refunded if a real charge sits behind it, and the
// clawback cases all start with a refund. So every seeded booking gets a
// genuine test-mode PaymentIntent for its full amount.
async function chargeFor(pounds, label) {
    const intent = await stripe.request('POST', '/payment_intents', {
        amount: Math.round(pounds * 100),
        currency: 'gbp',
        payment_method: 'pm_card_visa',
        payment_method_types: ['card'],
        confirm: 'true',
        description: SEED_TAG + ': ' + label,
        metadata: { [SEED_TAG]: label },
    });
    if (intent.status !== 'succeeded') {
        throw new Error(label + ': payment intent ended ' + intent.status);
    }
    return intent.id;
}

// A saved card, the way one is left behind when a guest pays a deposit. The
// balance charge later uses this off-session, with the guest nowhere near it.
//
// `token` picks the behaviour: pm_card_visa just works, pm_card_chargeDeclined
// always declines, pm_card_authenticationRequired makes the bank demand the
// guest confirm — which is not the same thing as a decline, and is the case
// scenario 11 exists for.
async function savedCard(token, label) {
    const customer = await stripe.request('POST', '/customers', {
        email: label + '@' + SEED_DOMAIN,
        description: SEED_TAG + ': ' + label,
    });

    // A `tok_` has to be turned into a payment method first. This matters for
    // the declining card: pm_card_chargeDeclined is rejected when it is
    // attached, so it can never stand for a card that was fine at deposit time
    // and fails later. tok_chargeCustomerFail attaches cleanly and fails when
    // charged, which is the situation the failure ladder is actually for.
    const methodId = token.indexOf('tok_') === 0
        ? (await stripe.request('POST', '/payment_methods', { type: 'card', card: { token } })).id
        : token;

    const method = await stripe.request('POST', '/payment_methods/' + methodId + '/attach', {
        customer: customer.id,
    });
    return { customerId: customer.id, paymentMethodId: method.id };
}

/* ---------------------------------------------------------- Supabase side */

async function createUser(label, fullName) {
    const email = label + '@' + SEED_DOMAIN;
    const user = await db.auth('POST', '/admin/users', {
        email,
        password: 'seed-password-' + label,
        email_confirm: true,
        user_metadata: { full_name: fullName, [SEED_TAG]: true },
    });
    return { id: user.id, email, label };
}

async function upsertProfile(user, patch) {
    const existing = await db.select('profiles', '?select=id&id=eq.' + user.id);
    const row = { id: user.id, email: user.email, full_name: user.label, ...patch };
    if (existing.length) {
        const [updated] = await db.update('profiles', '?id=eq.' + user.id, patch);
        return updated;
    }
    const [inserted] = await db.insert('profiles', row);
    return inserted;
}

async function createListing(host, title, patch = {}) {
    const [listing] = await db.insert('listings', {
        host_id: host.id,
        title: 'SEED — ' + title,
        description: 'Seeded for payment scenario testing.',
        location: 'Dumfries & Galloway',
        price_per_night: 100,
        max_guests: 4,
        status: 'published',
        cancellation_policy: 'Moderate',
        ...patch,
    });
    return listing;
}

async function createBooking(listing, guest, host, patch = {}) {
    // The charge stands for what was actually collected, not the headline
    // price — on a deposit booking those differ, and a refund goes against the
    // charge. A booking that has not been paid yet gets none, because the
    // whole point of it is to go through checkout for real.
    const total = patch.total_price !== undefined ? patch.total_price : 500;
    const collected = patch.amount_paid !== undefined ? patch.amount_paid : total;
    const noCharge = patch.noCharge === true;
    delete patch.noCharge;
    const intentId = noCharge ? null : await chargeFor(collected, (patch.label || listing.title));
    delete patch.label;
    const [booking] = await db.insert('bookings', {
        stripe_payment_intent_id: intentId,
        listing_id: listing.id,
        guest_id: guest.id,
        host_id: host.id,
        check_in: dayOffset(-3),
        check_out: dayOffset(-1),
        guests: 2,
        adults: 2,
        total_price: 500,
        status: 'confirmed',
        payment_status: 'paid',
        amount_paid: 500,
        amount_refunded: 0,
        commission_rate: 10,
        paid_at: new Date().toISOString(),
        ...patch,
    });
    return booking;
}

// The frozen per-night price series a booking carries since #120. A shortening
// credits removed nights at what was PAID, read from here, so the change money
// scenarios seed it explicitly rather than leaning on today's rate.
function breakdown(startOffset, nights, rate) {
    const out = [];
    for (let i = 0; i < nights; i++) {
        out.push({ date: dayOffset(startOffset + i), rate });
    }
    return out;
}

/* ------------------------------------------------------------------ main */

async function main() {
    const resetOnly = process.argv.includes('--reset');

    log('project: ' + env.NEXT_PUBLIC_SUPABASE_URL);
    log('stripe:  ' + env.STRIPE_SECRET_KEY.slice(0, 12) + '… (test mode)');
    log('');

    await reset();
    if (resetOnly) {
        if (fs.existsSync(MANIFEST)) fs.unlinkSync(MANIFEST);
        log('\ndone — reset only.');
        return;
    }

    // Connect accounts are slow and rate-limited, so they survive a reseed.
    const cached = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};

    log('\nStripe Connect accounts…');
    let readyAccount = cached.accounts && cached.accounts.ready;
    if (readyAccount) {
        const fresh = await stripe.request('GET', '/accounts/' + readyAccount).catch(() => null);
        if (fresh && fresh.payouts_enabled) log('  reusing ' + readyAccount);
        else readyAccount = null;
    }
    if (!readyAccount) readyAccount = (await createOnboardedAccount('host-ready')).id;

    let secondAccount = cached.accounts && cached.accounts.indebted;
    if (secondAccount) {
        const fresh = await stripe.request('GET', '/accounts/' + secondAccount).catch(() => null);
        if (fresh && fresh.payouts_enabled) log('  reusing ' + secondAccount);
        else secondAccount = null;
    }
    if (!secondAccount) secondAccount = (await createOnboardedAccount('host-indebted')).id;

    const pendingAccount = (await createUnonboardedAccount('host-pending')).id;

    // Scenario 21 finishes by proving a later run picks the host up once they
    // are onboarded. `stripe_account_id` is unique on profiles, so that needs
    // an account of its own rather than borrowing another host's.
    let spareAccount = cached.accounts && cached.accounts.spare;
    if (spareAccount) {
        const fresh = await stripe.request('GET', '/accounts/' + spareAccount).catch(() => null);
        if (fresh && fresh.payouts_enabled) log('  reusing ' + spareAccount);
        else spareAccount = null;
    }
    if (!spareAccount) spareAccount = (await createOnboardedAccount('host-spare')).id;

    log('\nPlatform balance…');
    // One full pass of either suite moves well over £2000 out to hosts before
    // any of it is reversed back, so this leaves real headroom.
    await fundPlatform(6000);

    log('\nConnected account balances…');
    for (const [label, id] of Object.entries({
        ready: readyAccount, indebted: secondAccount, pending: pendingAccount, spare: spareAccount,
    })) {
        await normaliseConnectedBalance(id, label);
    }

    log('\nUsers, listings and bookings…');
    const guest = await createUser('guest', 'Seed Guest');
    const hostReady = await createUser('host-ready', 'Seed Host Ready');
    const hostIndebted = await createUser('host-indebted', 'Seed Host Indebted');
    const hostPending = await createUser('host-pending', 'Seed Host Pending');

    await upsertProfile(guest, { is_host: false });
    await upsertProfile(hostReady, {
        is_host: true, stripe_account_id: readyAccount,
        stripe_charges_enabled: true, stripe_payouts_enabled: true, stripe_details_submitted: true,
        payout_balance_owed: 0,
    });
    await upsertProfile(hostIndebted, {
        is_host: true, stripe_account_id: secondAccount,
        stripe_charges_enabled: true, stripe_payouts_enabled: true, stripe_details_submitted: true,
        payout_balance_owed: 0,
    });
    await upsertProfile(hostPending, {
        is_host: true, stripe_account_id: pendingAccount,
        stripe_charges_enabled: false, stripe_payouts_enabled: false, stripe_details_submitted: false,
        payout_balance_owed: 0,
    });

    // Scenario 20 — the listing's rate is deliberately different from the rate
    // stamped on the booking, so a payout at the wrong one is visible.
    const listingReady = await createListing(hostReady, 'Rate-stamped cottage', { commission_rate: 25 });
    const listingIndebted = await createListing(hostIndebted, 'Clawback cottage', { commission_rate: 10 });
    const listingPending = await createListing(hostPending, 'Not-onboarded cottage', { commission_rate: 10 });

    // A pence-ending total, because that is where the rounding used to split.
    const s20 = await createBooking(listingReady, guest, hostReady, {
        label: 's20', total_price: 483.33, amount_paid: 483.33, commission_rate: 10,
        check_in: dayOffset(-6), check_out: dayOffset(-4),
    });
    const s21 = await createBooking(listingPending, guest, hostPending, {
        label: 's21', total_price: 400, amount_paid: 400,
        check_in: dayOffset(-6), check_out: dayOffset(-4),
    });
    const s22 = await createBooking(listingIndebted, guest, hostIndebted, {
        label: 's22', total_price: 600, amount_paid: 600,
        check_in: dayOffset(-6), check_out: dayOffset(-4),
    });
    // PAID AS A DEPOSIT AND A BALANCE, ON PURPOSE.
    //
    // Scenario 23 needs a host with genuinely nothing at Stripe, and it gets
    // there by draining them to their bank — which only moves the AVAILABLE
    // bucket. So the payout has to land there, and that only happens on an
    // UNTIED transfer.
    //
    // lib/payoutSource.ts names the guest's charge as a transfer's
    // source_transaction wherever one charge covers the host's share, and
    // Stripe then settles it on that charge's clock — into PENDING, for about
    // a week, where nothing can drain it. Two charges of £150 against a £270
    // share means no single charge covers it, the transfer goes untied out of
    // the platform's settled balance, and it arrives in the host's available
    // balance where this scenario can empty it.
    //
    // That is also the honest shape of the case: a deposit and a balance is
    // how most stays are actually paid.
    const s23DepositIntent = await chargeFor(150, 's23-deposit');
    const s23BalanceIntent = await chargeFor(150, 's23-balance');
    const s23 = await createBooking(listingIndebted, guest, hostIndebted, {
        label: 's23', total_price: 300, amount_paid: 300,
        check_in: dayOffset(-3), check_out: dayOffset(-1),
        noCharge: true,
        stripe_payment_intent_id: s23DepositIntent,
        balance_payment_intent_id: s23BalanceIntent,
        payment_plan: 'deposit',
        deposit_amount: 150,
        balance_amount: 0,
    });
    // Scenario 24's payout is deliberately small next to the debt scenario 23
    // leaves behind. It is seeded in the future so the first payout run cannot
    // pick it up — the runner brings its dates back once the debt exists.
    const s24 = await createBooking(listingIndebted, guest, hostIndebted, {
        label: 's24', total_price: 120, amount_paid: 120, check_in: dayOffset(10), check_out: dayOffset(12),
    });

    // A stand-in for "the clawback failed for a reason that is not a shortfall".
    // The runner points its payout_transfer_id at an already-reversed transfer,
    // which Stripe refuses — the case that used to be billed to the host as a
    // debt they never owed. Seeded in the future so no payout run takes it.
    const s23b = await createBooking(listingIndebted, guest, hostIndebted, {
        label: 's23b', total_price: 200, amount_paid: 200,
        check_in: dayOffset(14), check_out: dayOffset(16),
    });

    /* -------------------------------------------------- refunds, 12-18 */

    // Each of these needs its own listing, because the cancellation tier that
    // decides the refund lives on the listing, not the booking.
    const listingFlexible = await createListing(hostReady, 'Flexible cottage', {
        commission_rate: 10, cancellation_policy: 'Flexible',
    });
    const listingFirm = await createListing(hostReady, 'Firm cottage', {
        commission_rate: 10, cancellation_policy: 'Firm',
    });

    // 12 — a request the host has not accepted yet.
    const s12 = await createBooking(listingReady, guest, hostReady, {
        label: 's12', total_price: 450, amount_paid: 450,
        status: 'pending', payment_status: 'paid',
        check_in: dayOffset(30), check_out: dayOffset(33),
    });

    // 13 — confirmed, and the host pulls out. Carries the 5% fee.
    const s13 = await createBooking(listingReady, guest, hostReady, {
        label: 's13', total_price: 700, amount_paid: 700,
        check_in: dayOffset(40), check_out: dayOffset(43),
    });

    // 14 — goodwill money back, stay still happening, host still paid the
    // remainder. Checked in already so the payout run will take it.
    const s14 = await createBooking(listingReady, guest, hostReady, {
        label: 's14', total_price: 400, amount_paid: 400,
        check_in: dayOffset(-3), check_out: dayOffset(-1),
    });

    // 31 — one fully-paid, confirmed stay that scenario 14c hits with several
    // host goodwill refunds AT ONCE, to prove the refunded total is summed in
    // the database and not lost when two refunds overlap.
    const s31 = await createBooking(listingReady, guest, hostReady, {
        label: 's31', total_price: 500, amount_paid: 500,
        check_in: dayOffset(25), check_out: dayOffset(28),
    });

    // 15 — guest cancels with the free window still open. Flexible is full
    // refund up to 1 day before.
    const s15 = await createBooking(listingFlexible, guest, hostReady, {
        label: 's15', total_price: 300, amount_paid: 300,
        check_in: dayOffset(20), check_out: dayOffset(23),
    });

    // 16 — Firm: full to 30 days, half from 30 down to 7. 20 days out is half.
    const s16 = await createBooking(listingFirm, guest, hostReady, {
        label: 's16', total_price: 500, amount_paid: 500,
        check_in: dayOffset(20), check_out: dayOffset(23),
    });

    // 17 — Firm, 3 days out, inside the non-refundable part.
    const s17 = await createBooking(listingFirm, guest, hostReady, {
        label: 's17', total_price: 500, amount_paid: 500,
        check_in: dayOffset(3), check_out: dayOffset(6),
    });

    // 18 — only the 25% deposit has been taken. They get that back, not £800.
    const s18 = await createBooking(listingFlexible, guest, hostReady, {
        label: 's18', total_price: 800, amount_paid: 200,
        payment_status: 'deposit_paid', payment_plan: 'deposit',
        deposit_amount: 200, balance_amount: 600, balance_due_date: dayOffset(-10),
        check_in: dayOffset(30), check_out: dayOffset(33),
    });

    /* --------------------------------------------- balance charges, 3 & 7-11 */

    // All three are deposit-paid bookings with the balance now due. What
    // differs is the card left on file.
    const depositBooking = async (label, token, startsIn) => {
        const card = await savedCard(token, label);
        const b = await createBooking(listingReady, guest, hostReady, {
            label: label,
            total_price: 800, amount_paid: 200,
            payment_status: 'deposit_paid', payment_plan: 'deposit',
            deposit_amount: 200, balance_amount: 600,
            balance_due_date: dayOffset(0),
            balance_attempts: 0,
            check_in: dayOffset(startsIn), check_out: dayOffset(startsIn + 3),
            stripe_customer_id: card.customerId,
            stripe_payment_method_id: card.paymentMethodId,
        });
        return b;
    };

    const s03 = await depositBooking('s03', 'pm_card_visa', 50);
    const s07 = await depositBooking('s07', 'tok_chargeCustomerFail', 60);
    const s11 = await depositBooking('s11', 'pm_card_authenticationRequired', 70);
    // A good card, used by scenario 3b: a run that charged the balance and died
    // before settling leaves a dangling 'attempting' claim, and the next run
    // must replay the same idempotency key rather than charge a second time.
    const s29 = await depositBooking('s29', 'pm_card_visa', 80);

    // 32-34 — deposit-paid, balance due today, saved card, on a Flexible
    // listing far enough out that a cancel is a full refund. Crosscutting
    // scenario 30 races a guest cancel against the balance charge on these, so
    // there are several to give both orderings a chance to occur in one run.
    const raceBookings = [];
    const raceLabels = ['s32', 's33', 's34'];
    for (let i = 0; i < raceLabels.length; i++) {
        const label = raceLabels[i];
        const card = await savedCard('pm_card_visa', label);
        // Staggered dates so three confirmed stays on the one listing do not
        // trip the no-overlap exclusion constraint.
        const start = 45 + i * 5;
        const b = await createBooking(listingFlexible, guest, hostReady, {
            label,
            total_price: 800, amount_paid: 200,
            payment_status: 'deposit_paid', payment_plan: 'deposit',
            // Not due yet, so the balance runs in the earlier scenarios leave
            // them alone; scenario 30 makes them due the instant it races them.
            deposit_amount: 200, balance_amount: 600, balance_due_date: dayOffset(10),
            balance_attempts: 0,
            check_in: dayOffset(start), check_out: dayOffset(start + 3),
            stripe_customer_id: card.customerId,
            stripe_payment_method_id: card.paymentMethodId,
        });
        raceBookings.push(b);
    }

    /* ------------------------------------------------ checkout, 1, 2, 4, 5, 6 */

    // Instant Book, so a paid booking confirms on the webhook rather than
    // going back to the host. £100 a night and no fees, which keeps the total
    // something a test can state plainly — checkout re-quotes from the listing
    // and refuses anything that disagrees.
    const listingInstant = await createListing(hostReady, 'Instant-book cottage', {
        commission_rate: 10, price_per_night: 100, instant_book: true,
        cancellation_policy: 'Moderate',
    });

    // Each gets its own week. They share a listing, and checkout refuses dates
    // that overlap anything already pending or confirmed — including each
    // other.
    const unpaid = (label, start, nights, total) => createBooking(listingInstant, guest, hostReady, {
        label: label, noCharge: true,
        total_price: total, amount_paid: 0,
        status: 'pending_payment', payment_status: 'unpaid',
        deposit_amount: null, balance_amount: null,
        check_in: dayOffset(start), check_out: dayOffset(start + nights),
    });

    const s01 = await unpaid('s01', 60, 4, 400);   // pays the 25% deposit
    const s02 = await unpaid('s02', 70, 3, 300);   // pays in full
    const s05 = await unpaid('s05', 80, 3, 300);   // card declined at checkout
    const s06 = await unpaid('s06', 90, 3, 300);   // 3D Secure challenge

    // 4 — the balance paid by hand from the link in the reminder email.
    const card04 = await savedCard('pm_card_visa', 's04');
    const s04 = await createBooking(listingInstant, guest, hostReady, {
        label: 's04',
        total_price: 400, amount_paid: 100,
        payment_status: 'deposit_paid', payment_plan: 'deposit',
        deposit_amount: 100, balance_amount: 300,
        balance_due_date: dayOffset(30),
        check_in: dayOffset(100), check_out: dayOffset(104),
        stripe_customer_id: card04.customerId,
        stripe_payment_method_id: card04.paymentMethodId,
    });

    /* --------------------------------------------- cross-cutting, 25-29 */

    // Each of these needs a listing to itself: the tests change the price or
    // block the calendar, and that must not disturb anything else.
    const listingPrice = await createListing(hostReady, 'Price-change cottage', {
        price_per_night: 100, instant_book: true,
    });
    const listingIcal = await createListing(hostReady, 'iCal-clash cottage', {
        price_per_night: 100, instant_book: true,
    });
    const listingRace = await createListing(hostReady, 'Two-guests cottage', {
        price_per_night: 100, instant_book: true,
    });

    const unpaidOn = (listing, label, start, nights, total) =>
        createBooking(listing, guest, hostReady, {
            label: label, noCharge: true,
            total_price: total, amount_paid: 0,
            status: 'pending_payment', payment_status: 'unpaid',
            deposit_amount: null, balance_amount: null,
            check_in: dayOffset(start), check_out: dayOffset(start + nights),
        });

    const s25 = await unpaidOn(listingPrice, 's25', 120, 3, 300);
    const s26 = await unpaidOn(listingIcal, 's26', 130, 3, 300);

    // 27 — two guests, one set of dates, both still unpaid.
    const s27a = await unpaidOn(listingRace, 's27a', 140, 3, 300);
    const s27b = await unpaidOn(listingRace, 's27b', 140, 3, 300);

    // 28 — flipped between states to see what the confirmation page says.
    const s28 = await unpaidOn(listingPrice, 's28', 150, 3, 300);

    /* ----------------------------------- change money (shortenings / move) */
    // For scripts/change-scenarios.mjs. Each carries a frozen nightly_breakdown
    // so a shortening credits the dropped nights at what was paid, and each sits
    // where its cancellation window decides the refund. Dedicated listings, so
    // their date ranges can't collide with the payout/refund bookings above.
    const listingChangeFlex = await createListing(hostReady, 'Change — flexible cottage', {
        commission_rate: 10, cancellation_policy: 'Flexible',
    });
    const listingChangeFirm = await createListing(hostReady, 'Change — firm cottage', {
        commission_rate: 10, cancellation_policy: 'Firm',
    });
    const listingChangeMove = await createListing(hostReady, 'Change — move cottage', {
        commission_rate: 10, cancellation_policy: 'Moderate',
    });

    // cg1 — DEPOSIT booking, £100/night × 8 = £800, only the £200 deposit taken.
    // Flexible and far out (free window), so a shortening is a full credit but
    // still above the deposit: no card refund, the balance owed just drops.
    const cg1 = await createBooking(listingChangeFlex, guest, hostReady, {
        label: 'cg1', total_price: 800, amount_paid: 200,
        payment_status: 'deposit_paid', payment_plan: 'deposit',
        deposit_amount: 200, balance_amount: 600, balance_due_date: dayOffset(30),
        check_in: dayOffset(40), check_out: dayOffset(48),
        nightly_breakdown: breakdown(40, 8, 100),
    });

    // cg2 — fully paid, £100/night × 5 = £500, Flexible and far out: a shortening
    // is inside the free window, so the dropped night comes back in full.
    const cg2 = await createBooking(listingChangeFlex, guest, hostReady, {
        label: 'cg2', total_price: 500, amount_paid: 500,
        check_in: dayOffset(55), check_out: dayOffset(60),
        nightly_breakdown: breakdown(55, 5, 100),
    });

    // cg3 — fully paid, £100/night × 5 = £500, Firm and 20 days out: past the
    // 30-day full window, inside the partial one → 50% back on a dropped night.
    const cg3 = await createBooking(listingChangeFirm, guest, hostReady, {
        label: 'cg3', total_price: 500, amount_paid: 500,
        check_in: dayOffset(20), check_out: dayOffset(25),
        nightly_breakdown: breakdown(20, 5, 100),
    });

    // cg4 — fully paid, £100/night × 3 = £300, Firm and 4 days out: inside the
    // non-refundable window → a dropped night forfeits entirely, no money moves.
    const cg4 = await createBooking(listingChangeFirm, guest, hostReady, {
        label: 'cg4', total_price: 300, amount_paid: 300,
        check_in: dayOffset(4), check_out: dayOffset(7),
        nightly_breakdown: breakdown(4, 3, 100),
    });

    // ch1 — fully paid, £100/night × 5 = £500, already CHECKED IN (so the payout
    // run pays it out) but still running (checkout ahead), so the host can still
    // shorten it. A host-proposed shortening refunds the dropped nights in full
    // whatever the tier, and the clawback recovers the host's share.
    const ch1 = await createBooking(listingChangeFirm, guest, hostReady, {
        label: 'ch1', total_price: 500, amount_paid: 500,
        check_in: dayOffset(-2), check_out: dayOffset(3),
        nightly_breakdown: breakdown(-2, 5, 100),
    });

    // cm1 — fully paid, £100/night × 3 = £300, and a set of pricier nights to
    // move ONTO: calendar overrides at £180 on dayOffset 50–52. Moving the whole
    // stay there charges the difference (3 × £180 − 3 × £100 = £240), with no
    // cancellation penalty because no nights are lost on net.
    const cm1 = await createBooking(listingChangeMove, guest, hostReady, {
        label: 'cm1', total_price: 300, amount_paid: 300,
        check_in: dayOffset(40), check_out: dayOffset(43),
        nightly_breakdown: breakdown(40, 3, 100),
    });
    await db.insert('calendar_overrides', [
        { listing_id: listingChangeMove.id, date: dayOffset(50), price_override: 180 },
        { listing_id: listingChangeMove.id, date: dayOffset(51), price_override: 180 },
        { listing_id: listingChangeMove.id, date: dayOffset(52), price_override: 180 },
    ]);

    const manifest = {
        seededAt: new Date().toISOString(),
        project: env.NEXT_PUBLIC_SUPABASE_URL,
        accounts: { ready: readyAccount, indebted: secondAccount, pending: pendingAccount, spare: spareAccount },
        users: { guest: guest.id, hostReady: hostReady.id, hostIndebted: hostIndebted.id, hostPending: hostPending.id },
        listings: {
            ready: listingReady.id, indebted: listingIndebted.id, pending: listingPending.id,
            flexible: listingFlexible.id, firm: listingFirm.id, instant: listingInstant.id,
            price: listingPrice.id, ical: listingIcal.id, race: listingRace.id,
        },
        bookings: {
            s01: s01.id, s02: s02.id, s04: s04.id, s05: s05.id, s06: s06.id,
            s25: s25.id, s26: s26.id, s27a: s27a.id, s27b: s27b.id, s28: s28.id,
            s03: s03.id, s07: s07.id, s11: s11.id, s29: s29.id,
            s12: s12.id, s13: s13.id, s14: s14.id, s15: s15.id, s16: s16.id, s31: s31.id,
            s32: raceBookings[0].id, s33: raceBookings[1].id, s34: raceBookings[2].id,
            s17: s17.id, s18: s18.id,
            s20: s20.id, s21: s21.id, s22: s22.id, s23: s23.id, s23b: s23b.id, s24: s24.id,
            cg1: cg1.id, cg2: cg2.id, cg3: cg3.id, cg4: cg4.id, ch1: ch1.id, cm1: cm1.id,
        },
    };
    writeManifest(manifest);

    log('\nseeded:');
    log('  hosts    ready=' + readyAccount + '  indebted=' + secondAccount + '  pending=' + pendingAccount);
    log('  bookings ' + Object.entries(manifest.bookings).map(([k, v]) => k + '=' + v.slice(0, 8)).join(' '));
    log('\nmanifest written to scripts/.seed-manifest.json');
}

main().catch((err) => {
    console.error('\nseed failed:', err.message);
    process.exit(1);
});
