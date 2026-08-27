// The vocabulary and the rules for a service provider, in one place, so the
// sign-up form, the admin screen and anything later all agree.
//
// Same shape as lib/listingRules.ts: pure functions and constants, no queries,
// so it can be used on the server and in the browser and tested without a
// database anywhere near it.

import { blockedSkills, SkillRow } from '@/lib/serviceSkills';

// Nobody searches for "maintenance". They search for a plumber.
//
// 'spanner' — Maintenance & repairs — used to be a trade of its own, and the
// six below were buried inside it. It is now a group on the picker (see
// TRADE_GROUPS) rather than anything that gets stored, because a trade is how
// somebody is found and a roofer found only by looking under handymen is not
// really listed at all.
export const TRADES = [
    { key: 'sponge', label: 'Cleaning' },
    { key: 'bin', label: 'Waste removal' },
    { key: 'trees', label: 'Gardening & grounds' },
    { key: 'droplet', label: 'Window cleaning' },
    { key: 'electrician', label: 'Electrician' },
    { key: 'joiner', label: 'Joiner' },
    { key: 'plumber', label: 'Plumber' },
    { key: 'roofer', label: 'Roofer' },
    { key: 'painter', label: 'Painter & decorator' },
    { key: 'handyman', label: 'Handyman' },
    { key: 'chef', label: 'Private chef' },
    { key: 'cake', label: 'Cakes & baking' },
    { key: 'basket', label: 'Hampers & shopping' },
    { key: 'paw', label: 'Pet care' },
] as const;

export type TradeKey = (typeof TRADES)[number]['key'];

export function tradeLabel(key: string): string {
    const found = TRADES.filter((t) => t.key === key)[0];
    return found ? found.label : 'Service';
}

// Which sign-up a trade belongs to.
//
// Two pages, not one page with a question. A business arriving at the host
// sign-up can already see it is for property owners, and the trade list in
// front of them only contains host trades — so asking "who do you sell to?"
// is asking them to confirm something the page has already told them.
//
// Every trade belongs to exactly one of these, and there is a test that says
// so: a trade in neither would appear on no sign-up at all, which is a page
// nobody can reach rather than a visible mistake.
export const HOST_TRADES = [
    'sponge', 'bin', 'trees', 'droplet',
    'electrician', 'joiner', 'plumber', 'roofer', 'painter', 'handyman',
] as const;
export const GUEST_TRADES = ['chef', 'cake', 'basket', 'paw'] as const;

// A heading on the picker, not a thing anybody is.
//
// Six trades would swamp a page that otherwise has four entries on it, and
// they belong together in a way the others do not — somebody who needs one of
// them usually knows which. So the picker shows "Maintenance & repairs", and
// choosing it opens a second page of the actual trades.
//
// There is no cap on how many of them one business may hold, deliberately.
// Somebody ticking all six is telling us something worth seeing rather than
// something worth preventing — and a genuine handyman picks handyman.
export const TRADE_GROUPS = [
    {
        key: 'maintenance',
        label: 'Maintenance & repairs',
        hint: 'Electrician, joiner, plumber, roofer, painter, handyman.',
        trades: ['electrician', 'joiner', 'plumber', 'roofer', 'painter', 'handyman'],
    },
] as const;

export function groupByKey(key: string): { key: string; label: string; hint: string; trades: readonly string[] } | null {
    const found = TRADE_GROUPS.filter((g) => g.key === key)[0];
    return found ? { key: found.key, label: found.label, hint: found.hint, trades: found.trades } : null;
}

export function groupForTrade(trade: string): string | null {
    const found = TRADE_GROUPS.filter((g) => (g.trades as readonly string[]).indexOf(trade) !== -1)[0];
    return found ? found.key : null;
}

// What step one shows: the ungrouped trades they have not claimed, plus any
// group that still has something left in it.
//
// A group with every trade taken drops off the page rather than opening onto
// an empty second step, which is the same rule the flat list already follows.
export function pickerEntries(
    existing: Array<{ trade?: string | null }> | null | undefined,
    audience: string
): Array<{ kind: 'trade' | 'group'; key: string; label: string; hint?: string; left?: number }> {
    const left = unclaimedTrades(existing, audience);
    const entries: Array<{ kind: 'trade' | 'group'; key: string; label: string; hint?: string; left?: number }> = [];
    const seenGroups: string[] = [];

    for (const trade of left) {
        const group = groupForTrade(trade.key);

        if (!group) {
            entries.push({ kind: 'trade', key: trade.key, label: trade.label });
            continue;
        }

        if (seenGroups.indexOf(group) !== -1) continue;
        seenGroups.push(group);

        const meta = groupByKey(group);
        if (!meta) continue;

        entries.push({
            kind: 'group',
            key: group,
            label: meta.label,
            hint: meta.hint,
            left: left.filter((t) => groupForTrade(t.key) === group).length,
        });
    }

    return entries;
}

export function tradesFor(audience: string): Array<{ key: string; label: string }> {
    const keys: readonly string[] = audience === 'guest' ? GUEST_TRADES : HOST_TRADES;
    return TRADES.filter((t) => keys.indexOf(t.key) !== -1).map((t) => ({ key: t.key, label: t.label }));
}

// The audience comes from the trade rather than from an answer, so the record
// can never disagree with itself — and the guest page needs no code of its own
// to set it.
// Which trades this person has not signed up for yet.
//
// One business per trade, so the picker is a list of what they have plus what
// is left — rather than a question they have already answered.
export function unclaimedTrades(
    existing: Array<{ trade?: string | null }> | null | undefined,
    audience: string
): Array<{ key: string; label: string }> {
    const taken = (existing || []).map((p) => String(p.trade || ''));
    return tradesFor(audience).filter((t) => taken.indexOf(t.key) === -1);
}

export function audienceForTrade(trade: string): string {
    if ((GUEST_TRADES as readonly string[]).indexOf(trade) !== -1) return 'guest';
    if ((HOST_TRADES as readonly string[]).indexOf(trade) !== -1) return 'host';
    return '';
}

// Which of the two shops it appears in.
export const AUDIENCES = [
    { key: 'guest', label: 'Guests staying nearby', hint: 'Cakes, chefs, hampers — bought by someone on holiday.' },
    { key: 'host', label: 'Property owners', hint: 'Changeover cleans, gardening, repairs — bought by a host.' },
    { key: 'both', label: 'Both', hint: 'Sold to guests and to owners.' },
] as const;

// Who they sell to, said the way the admin screen says it.
export function audienceLabel(audience: string): string {
    if (audience === 'both') return 'guests and owners';
    if (audience === 'guest') return 'guests';
    if (audience === 'host') return 'owners';
    return 'not said';
}

// ---------------------------------------------------------------------------
// WHAT A PROVIDER PAYS
//
// Two models, decided by the trade rather than by the provider, and the line
// between them is about who takes the customer's money:
//
//   commission    the platform charges the customer at acceptance, so there
//                 is a transaction to take a percentage of. 10%, held in
//                 `commission_rate` on the row and snapshotted onto each
//                 enquiry, the same way bookings.commission_rate already
//                 works — so changing the rate later never rewrites what
//                 somebody already agreed to.
//   subscription  the work is quoted on site and paid off-platform. There is
//                 no transaction here to take a percentage of, and a per-job
//                 commission could not police one if there were. £20 a month
//                 after 90 free days, and the commission rate resolves to
//                 zero.
//
// This reverses an earlier decision, and the reasoning that removed the trial
// is worth keeping rather than pretending it was never made: a dormant
// `trial_ends_at` is one query away from becoming a promise on a page again.
// The answer to that is not to have no trial, it is that the trial has to be
// stamped where the promise is actually made — at approval, in the email that
// tells them they are live and gives them the date — rather than sitting on a
// draft nobody has accepted yet. Submission still starts nothing.
//
// It is also a different shape from what was removed. 'trial' used to be a
// value of `plan`, which meant the plan could not say what happened when the
// trial ended. Now `plan` says which model they are on for good, and
// `trial_ends_at` is a date on the row that passes.
//
// AN EXPLICIT MAP, NOT A DERIVED ONE
//
// The obvious shortcut is `pricingModelFor(trade) === 'quoted'`. It is wrong
// twice over: it would sweep in all four guest trades, and it keys money off
// a value that describes something else. This file has already been bitten by
// exactly that — see canBeRequested below, which used the pricing model as a
// proxy until the roofer, joiner and painter moved to `quoted` and it quietly
// changed meaning. How a trade prices is free to be re-shuffled; what it pays
// is not, so it is written down.
//
// The map is checkable rather than arbitrary: every subscription trade is one
// of the maintenance trades, and every maintenance trade is a subscription
// trade. There is a test asserting exactly that, so the two cannot drift.
// ---------------------------------------------------------------------------

export type ProviderPlan = 'commission' | 'subscription';

const TRADE_PLANS: Record<string, ProviderPlan> = {
    // Quoted on site, paid off-platform.
    plumber: 'subscription',
    electrician: 'subscription',
    handyman: 'subscription',
    roofer: 'subscription',
    joiner: 'subscription',
    painter: 'subscription',

    // The platform charges the customer at acceptance.
    sponge: 'commission',
    bin: 'commission',
    trees: 'commission',
    droplet: 'commission',
    chef: 'commission',
    cake: 'commission',
    basket: 'commission',
    paw: 'commission',
};

// Commission is the safe default for a trade nobody has placed: it bills
// nothing until there is a job, where an unplaced trade defaulting to a
// subscription would start a clock on somebody who never agreed to one.
export function planForTrade(trade: string): ProviderPlan {
    return TRADE_PLANS[String(trade || '')] || 'commission';
}

// Ninety days, from approval.
export const TRIAL_DAYS = 90;

// £20 a month, said in one place so a page and an email cannot disagree.
export const SUBSCRIPTION_MONTHLY = 20;

// Nothing bills anyone yet. This is the date the free period ends, stamped at
// approval so it starts when they are actually live rather than when they
// happened to fill a form in.
export function trialEndsAt(approvedAt: Date | string): string {
    const from = approvedAt instanceof Date ? approvedAt : new Date(String(approvedAt));
    const end = new Date(from.getTime());
    end.setUTCDate(end.getUTCDate() + TRIAL_DAYS);
    return end.toISOString();
}

// What comes off a job, as a rate.
//
// A subscription provider is 0%, whatever is sitting in `commission_rate` —
// the column has a default of 0.10 and a row written before the plan existed
// will still be carrying it. Reading the plan rather than the column is what
// stops that stale 0.10 becoming a charge.
//
// This is the value to snapshot onto an enquiry when accepted, exactly as
// bookings.commission_rate is snapshotted onto a booking. There is no enquiry
// table yet, so nothing calls this in anger — but the rule is here and tested
// rather than waiting to be invented at the point it starts costing people
// money.
export const DEFAULT_SERVICE_COMMISSION = 0.10;

export function commissionRateFor(provider: any): number {
    if (!provider) return 0;

    const plan = String(provider.plan || planForTrade(String(provider.trade || '')));
    if (plan === 'subscription') return 0;

    // Missing and zero are different answers, and Number() collapses them:
    // Number(null) is 0, so a null column would have read as "this provider
    // pays nothing" rather than "nobody has said". A deliberate 0 is a real
    // rate — the owner sets one for an in-house business — so it has to
    // survive, and only a genuinely absent value falls back.
    const raw = provider.commission_rate;
    if (raw === null || raw === undefined || raw === '') return DEFAULT_SERVICE_COMMISSION;

    const rate = Number(raw);
    return rate >= 0 ? rate : DEFAULT_SERVICE_COMMISSION;
}

// What a provider is told they will pay, in one place so the sign-up, the
// admin card and the approval email cannot say three different things.
//
// Said in the present tense and without a date, because at the point the
// sign-up shows this there is no approval yet and therefore no clock. The
// email is where the date appears, because the email is sent at the moment
// the clock actually starts.
export function planTerms(trade: string): string {
    return planForTrade(trade) === 'subscription'
        ? 'Nothing to pay for your first ' + TRIAL_DAYS + ' days once you are approved, '
            + 'then £' + SUBSCRIPTION_MONTHLY + ' a month. We take no commission — you quote '
            + 'and get paid direct.'
        : 'Nothing to pay to be listed. We take 10% of a job when you accept one through '
            + 'the site, and nothing at all when you do not.';
}

// Whether the free period is still running, for a page that wants to say so.
export function trialActive(provider: any, now?: Date): boolean {
    if (!provider || !provider.trial_ends_at) return false;
    if (String(provider.plan || '') !== 'subscription') return false;

    const ends = new Date(String(provider.trial_ends_at)).getTime();
    if (!(ends > 0)) return false;

    return ends > (now || new Date()).getTime();
}


// What a re-check is actually for.
//
// The line: re-check what somebody chooses them on, not what they need to keep
// accurate. These five are the shop window, and they are the route by which a
// business approved as one thing could become another.
//
// Contact details and coverage are deliberately absent. A stale phone number
// costs the provider work and there is nothing to judge; coverage is their own
// knowledge, changes legitimately and often, and friction there makes people
// under-declare it, which makes matching worse rather than safer.
// `does_gas` and `does_oil` are in here because turning one on after approval
// is a new claim about work the law restricts, and it should come back round
// rather than appear quietly. The registration numbers themselves are not:
// they live in their own table, and they have a stronger check of their own —
// changing a number un-verifies it in the same statement.
export const REVIEWABLE_FIELDS = [
    'business_name',
    'trade',
    'description',
    'audience',
    'photos',
    'logo',
    'does_gas',
    'does_oil',
] as const;

// A fingerprint of the reviewable fields, stable across key order and across
// the order photos happen to come back in.
//
// This is the trustworthy half of the gate. A provider writes their own row
// from the browser, so anything the browser stamps is something they could
// decline to stamp — but the digest is written only by the admin decision
// route, so a mismatch is a fact they cannot suppress.
export function reviewDigest(provider: any): string {
    const parts = REVIEWABLE_FIELDS.map((field) => {
        const value = provider ? provider[field] : null;

        if (field === 'photos') {
            const photos = Array.isArray(value) ? value.slice().sort() : [];
            return field + '=' + photos.join(',');
        }

        // Trimmed, because trailing whitespace is not a change anybody needs
        // to look at.
        return field + '=' + String(value === null || value === undefined ? '' : value).trim();
    });

    return parts.join('|');
}

// Whether a live provider has edited something that has not been looked at.
//
// A null digest means nothing outstanding: anything approved before the digest
// existed is trusted until its next approval fills it in.
export function hasUnreviewedChanges(provider: any): boolean {
    if (!provider || provider.status !== 'approved') return false;
    if (!provider.approved_digest) return false;

    // Field by field, not string against string. Comparing whole digests meant
    // that adding a field to REVIEWABLE_FIELDS put every approved provider in
    // the queue at once, because their stored digest could not carry a field
    // that did not exist when they were approved. changedFields already treats
    // a field the old digest never held as a new field rather than an edit.
    return changedFields(provider).length > 0;
}

// Which of the reviewable fields differ from what was last approved.
//
// The digest is field-tagged for exactly this: it can be taken apart again, so
// the alert can say "they changed the description" rather than "something
// changed", which is the difference between triaging from a phone and having
// to open the site.
export function changedFields(provider: any): string[] {
    if (!provider || !provider.approved_digest) return [];

    const before: Record<string, string> = {};
    for (const part of String(provider.approved_digest).split('|')) {
        const at = part.indexOf('=');
        if (at > 0) before[part.slice(0, at)] = part.slice(at + 1);
    }

    const now = reviewDigest(provider);
    const changed: string[] = [];

    for (const part of now.split('|')) {
        const at = part.indexOf('=');
        if (at <= 0) continue;
        const field = part.slice(0, at);
        // A field the old digest never carried is a new field, not an edit.
        if (!(field in before)) continue;
        if (before[field] !== part.slice(at + 1)) changed.push(field);
    }

    return changed;
}

// The same field names, said the way a person would say them.
export function fieldLabel(field: string): string {
    if (field === 'business_name') return 'business name';
    if (field === 'trade') return 'category';
    if (field === 'description') return 'description';
    if (field === 'audience') return 'who they sell to';
    if (field === 'photos') return 'photos';
    if (field === 'logo') return 'logo';
    if (field === 'does_gas') return 'whether they do gas work';
    if (field === 'does_oil') return 'whether they do oil work';
    return field;
}

// What a save does to the status fields, given where the provider already is.
//
// Extracted from the sign-up page on purpose. The rule it encodes — a live
// provider is never knocked back into the queue by their own edit — is the
// whole point of the changes model, and while it sat inside a client component
// nothing could test it: a mutation that put the old destructive behaviour
// back was caught by no test at all.
export function submitStatusPatch(
    currentStatus: string,
    now: Date
): Record<string, any> {
    // Already live. Their edits are live too, and the queue works out from the
    // digest whether any of them want looking at.
    if (currentStatus === 'approved') return {};

    return {
        status: 'pending_review',
        submitted_at: now.toISOString(),
        review_note: null,
    };
}

// ---------------------------------------------------------------------------
// What a provider charges.
//
// Three shapes, chosen by the trade rather than by the provider, so that two
// cleaners are always comparable and a host is never asked to compare a price
// with a rate.
//
//   bands           a price per size band, bands defined here so they are the
//                   same for everybody. Most host trades are this.
//   callout_hourly  a fixed call-out fee then an hourly rate. Maintenance
//                   only: you cannot band a repair.
//   quoted          priced per job when asked. Everything guest-facing, where
//                   what is wanted varies more than the property does.
// ---------------------------------------------------------------------------

export type PricingModel = 'bands' | 'callout_hourly' | 'quoted';

// Bedrooms as the axis, because it is already on the listing — the host enters
// nothing and cannot shade it to land in a cheaper band.
export const BEDROOM_BANDS = [
    { key: 'beds_1_2', label: '1–2 bedrooms' },
    { key: 'beds_3_4', label: '3–4 bedrooms' },
    { key: 'beds_5_plus', label: '5 or more bedrooms' },
] as const;

// Bedrooms tell you nothing about a garden — a two-bed cottage can sit in an
// acre. Physical anchors rather than adjectives, so that two hosts reading
// "medium" do not mean different things.
// What the building is, for the trades where access decides the job.
//
// NOT listings.property_type — that column holds the marketing categories a
// place is sold under (Cottages, Coastal Stays, Luxury Stays) and answers a
// different question. A cottage can be a bungalow or two storeys.
export const BUILDING_TYPES = [
    { key: 'bungalow', label: 'Bungalow' },
    { key: 'semi_detached', label: 'Semi-detached' },
    { key: 'detached', label: 'Detached' },
    { key: 'flat', label: 'Flat or apartment' },
] as const;

export function buildingTypeLabel(key: string): string {
    const found = BUILDING_TYPES.filter((b) => b.key === key)[0];
    return found ? found.label : '';
}

export const STOREY_BANDS = [
    { key: 'storeys_one', label: 'All on one floor — nothing above head height' },
    { key: 'storeys_two', label: 'Two floors — upstairs windows need a ladder' },
    { key: 'storeys_three_plus', label: 'Three floors or more, or windows in attic rooms' },
] as const;

export function storeyLabel(key: string): string {
    const found = STOREY_BANDS.filter((b) => b.key === key)[0];
    return found ? found.label : '';
}

export function bandForStoreys(storeyBand: string | null | undefined): string | null {
    const key = String(storeyBand || '');
    return STOREY_BANDS.some((b) => b.key === key) ? key : null;
}

export const PLOT_BANDS = [
    { key: 'plot_yard', label: 'Courtyard or yard, no lawn' },
    { key: 'plot_garden', label: 'Garden up to about the size of a tennis court' },
    { key: 'plot_grounds', label: 'Larger than that, or paddock and orchard' },
] as const;

// No maintenance trade can be priced off the size of the property the way a
// changeover clean can — a leak is a leak whether the cottage has two bedrooms
// or five. But they do not all price the same way either.
//
//   callout_hourly  turn up, diagnose, charge for the time. A dead boiler, a
//                   tripped supply, a list of small jobs.
//   quoted          look at it, then say what the job costs. A re-slate, a
//                   kitchen, a house to paint.
//
// The three quoted trades were callout_hourly, which made an hourly rate
// compulsory before they could apply. No roofer prices a re-slate by the hour,
// so that number was going to be invented to get past the form — which is
// worse than not asking, because an invented number is one a host can hold
// them to.
const TRADE_PRICING: Record<string, PricingModel> = {
    sponge: 'bands',
    bin: 'bands',
    trees: 'bands',
    droplet: 'bands',
    electrician: 'callout_hourly',
    plumber: 'callout_hourly',
    handyman: 'callout_hourly',
    roofer: 'quoted',
    joiner: 'quoted',
    painter: 'quoted',
};

const TRADE_BANDS: Record<string, 'bedrooms' | 'plot'> = {
    sponge: 'bedrooms',
    bin: 'bedrooms',
    trees: 'plot',
    droplet: 'bedrooms',
};

export function pricingModelFor(trade: string): PricingModel {
    return TRADE_PRICING[trade] || 'quoted';
}

export function bandsFor(trade: string): Array<{ key: string; label: string }> {
    const which = TRADE_BANDS[trade];
    if (which === 'bedrooms') return BEDROOM_BANDS.map((b) => ({ key: b.key, label: b.label }));
    if (which === 'plot') return PLOT_BANDS.map((b) => ({ key: b.key, label: b.label }));
    return [];
}

export function bandLabel(key: string): string {
    const all = [...BEDROOM_BANDS, ...PLOT_BANDS];
    const found = all.filter((b) => b.key === key)[0];
    return found ? found.label : key;
}

// Which band a property falls in, from what the listing already knows. This is
// the whole claim that a host enters nothing, so it is worth having in one
// place rather than inline in a query.
export function bandForBedrooms(bedrooms: number | null | undefined): string | null {
    const n = Number(bedrooms);
    if (!n || n < 1) return null;
    if (n <= 2) return 'beds_1_2';
    if (n <= 4) return 'beds_3_4';
    return 'beds_5_plus';
}

// Plot has no equivalent on the listing yet, so it is stored rather than
// derived. Null means the host has not said, which is a prompt, not a refusal.
export function bandForPlot(plotBand: string | null | undefined): string | null {
    const key = String(plotBand || '');
    return PLOT_BANDS.some((b) => b.key === key) ? key : null;
}

// Maintenance is priced as a call-out plus an hourly rate, so the total only
// exists once the job is done — and nothing yet confirms that a job is done.
// Providers can sign up; they cannot be requested until it does.
// Whether a band price offers the optional "usually takes" guide.
//
// It earns its place on a changeover or a garden visit, where an hour either
// way is worth knowing. Window cleaning is quick work by the nature of it, and
// the guide is noise on every band.
export function showsTimeGuide(trade: string): boolean {
    return trade !== 'droplet';
}

// Whether a host can ask for this through the site, rather than being given
// somebody to ring.
//
// This used to read `pricingModelFor(trade) !== 'callout_hourly'`, which was a
// proxy for the real rule and stopped being true the moment the roofer, the
// joiner and the painter moved to `quoted` — they would have become
// requestable, with no price, no total and no completion step behind them, and
// every test would still have passed because they all named the plumber.
//
// The rule is about maintenance, not about how it is priced. So it asks that
// instead: nothing in the maintenance group can be requested until quoting and
// completion exist, however that trade happens to charge.
export function canBeRequested(trade: string): boolean {
    return groupForTrade(trade) === null;
}

export interface PricingDraft {
    trade?: string | null;
    prices?: Record<string, { price?: any; typical_hours?: any }> | null;
    callout_fee?: any;
    hourly_rate?: any;
    extras?: Record<string, { offered?: boolean; price?: any; notes?: any }> | null;
}

// A price has to be a positive number. Blank is a real answer — it means "I do
// not cover that size" — so it is never a problem on its own, only when every
// band is blank and the provider would reach nobody.
export function pricingProblems(draft: PricingDraft): Problem[] {
    const problems: Problem[] = [];
    const model = pricingModelFor(String(draft.trade || ''));

    // The hourly rate is the one that is load-bearing: for a trade that bills
    // by the hour it IS the price, and a listing without it tells a host
    // nothing.
    //
    // The call-out fee is optional, and used to be compulsory. Plenty of
    // handymen charge an hourly rate with no call-out at all, or a day rate —
    // so requiring it made them invent a number to get past the form, which is
    // the same fault as asking a roofer to price a re-slate by the hour. An
    // invented number is worse than a missing one, because a host can hold
    // them to it.
    if (model === 'callout_hourly') {
        const hourly = Number(draft.hourly_rate);

        if (!(hourly > 0)) {
            problems.push({ field: 'hourly_rate', message: 'Add your hourly rate.' });
        }
        return problems;
    }

    if (model !== 'bands') return problems;

    const bands = bandsFor(String(draft.trade || ''));
    const prices = draft.prices || {};
    let priced = 0;

    for (const band of bands) {
        const entry = prices[band.key] || {};
        const raw = entry.price;

        if (raw === undefined || raw === null || String(raw).trim() === '') continue;

        const price = Number(raw);
        if (!(price > 0)) {
            problems.push({ field: 'price_' + band.key, message: 'That is not a price. Leave it blank if you do not cover it.' });
            continue;
        }
        priced++;

        const hoursRaw = entry.typical_hours;
        if (hoursRaw !== undefined && hoursRaw !== null && String(hoursRaw).trim() !== '') {
            const hours = Number(hoursRaw);
            if (!(hours > 0)) {
                problems.push({ field: 'hours_' + band.key, message: 'Hours have to be a number, or left blank.' });
            }
        }
    }

    if (priced === 0) {
        problems.push({
            field: 'prices',
            message: 'Price at least one size — a provider who prices nothing reaches nobody.',
        });
    }

    return problems;
}

// What a provider shows of themselves.
//
// Per trade, like the pricing model and the bands, but the default comes from
// the audience because that is what the question really turns on: an owner
// hiring a contractor wants to see a business, and a guest buying a cake wants
// to see the cake.
//
// Host trades therefore take a logo and guest trades take work photos. A clean
// kitchen tells an owner nothing. Kept as a per-trade function rather than a
// per-audience one so that gardening — the one host trade where before-and-
// after shots would genuinely sell — is a single entry in TRADE_IMAGERY later
// rather than a reshape.
export type Imagery = 'logo' | 'photos';

const TRADE_IMAGERY: Record<string, Imagery> = {};

export function imageryFor(trade: string): Imagery {
    if (TRADE_IMAGERY[trade]) return TRADE_IMAGERY[trade];
    return audienceForTrade(trade) === 'guest' ? 'photos' : 'logo';
}

// A stand-in when there is no logo, the same shape the account avatars use.
// Plenty of small firms have no logo and it must not look broken.
export function initialsFor(name: string | null | undefined): string {
    const words = String(name || '')
        .split(/[^A-Za-z0-9]+/)
        .filter((w) => w.length > 0);

    if (words.length === 0) return '';
    if (words.length === 1) return words[0].charAt(0).toUpperCase();

    return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

// ---------------------------------------------------------------------------
// Extras.
//
// Three types, because they behave differently where it matters — money:
//
//   toggle      a yes/no. Matching and comparison, never a line on a bill.
//   priced      the provider sets the rate, and it is part of the ceiling the
//               10% comes off. Flat, or per unit where the host counts them.
//   reimbursed  the provider spends the host's money and is paid back directly
//               with a receipt. Off Stripe entirely: no number exists at quote
//               time, nothing passes through us, and it is not revenue for
//               either of us. It must never reach a ceiling or a commission.
//
// Keyed by trade and kept here rather than in columns, so gardening's hedge
// cutting and green waste are an entry in this list and not a migration. The
// key list is validated here too — deliberately not a database check
// constraint, because that would be a migration every time one is added.
// ---------------------------------------------------------------------------

export type ExtraType = 'toggle' | 'priced' | 'reimbursed';

// Where a set of extras renders, and whether it sits behind a question.
//
// A gate is presentation, not data. "Do you offer a laundry service?" is
// answerable from the prices — yes exactly when one of them is filled in — so
// storing it would be a second source of truth able to disagree with the rates
// it describes. It is held in the form while they are filling it in and never
// written down.
export const EXTRA_GROUPS = [
    { key: 'about', label: '' },
    { key: 'laundry', label: 'Laundry', gate: 'Do you offer a laundry service?' },
    { key: 'hot_tub', label: 'Hot tubs', gate: 'Do you service hot tubs?' },
    // Each of the extra services a window cleaner turns up to do gets its own
    // question, then one price — the same shape as the laundry gate.
    { key: 'svc_pressure', label: 'Pressure washing', gate: 'Do you do pressure washing?' },
    { key: 'svc_gutter', label: 'Gutter cleaning', gate: 'Do you clean gutters?' },
    { key: 'svc_fascias', label: 'Fascias and soffits', gate: 'Do you clean fascias and soffits?' },
    { key: 'svc_solar', label: 'Solar panels', gate: 'Do you clean solar panels?' },
    // Pricing structures. Rendered with the prices rather than with the
    // extras, so they are not offered under "what else do you offer".
    { key: 'pane_flat', label: 'Per pane' },
    { key: 'pane_storey', label: 'Per pane, by storey' },
    { key: 'priced', label: 'Charged on top' },
    { key: 'reimbursed', label: 'Bought for the owner and paid back' },
    // The maintenance trades, which answer three different questions rather
    // than one.
    //
    // A host with a blocked toilet and guests still in the cottage is not
    // reading a list of capabilities — they are looking for the person who
    // deals with that, tonight. A host thinking about next month's gas
    // certificate is doing something else entirely, and mixing the two put
    // the urgent half in grey subtitles underneath headings like "I take
    // emergency call-outs", where nobody searching for a leak would find it.
    //
    // So: what has gone wrong, what you can do, and how fast you turn out.
    { key: 'faults', label: 'Something has gone wrong' },
    { key: 'planned', label: 'Work booked in advance' },
    { key: 'availability', label: 'When you turn out' },
] as const;

export function groupGate(group: string): string | null {
    const found = EXTRA_GROUPS.filter((g) => g.key === group)[0] as any;
    return (found && found.gate) || null;
}

export interface ServiceExtra {
    key: string;
    trade: string;
    type: ExtraType;
    // Where it renders. `receipts_provided` is a toggle that belongs with the
    // reimbursed ones, so how it is stored and where it is shown are separate.
    group: 'about' | 'laundry' | 'hot_tub' | 'priced' | 'reimbursed'
        | 'svc_pressure' | 'svc_gutter' | 'svc_fascias' | 'svc_solar'
        | 'pane_flat' | 'pane_storey'
        | 'faults' | 'planned' | 'availability';
    label: string;
    hint?: string;
    // Priced only. 'each' means the host says how many when they ask; absent
    // means a flat fee.
    unit?: 'each';
    quantityLabel?: string;
}

export const SERVICE_EXTRAS: ServiceExtra[] = [
    // --- cleaning ----------------------------------------------------------
    {
        key: 'equipment_provided', trade: 'sponge', type: 'toggle', group: 'about',
        label: 'I bring my own equipment and materials',
    },
    {
        key: 'damage_photos', trade: 'sponge', type: 'toggle', group: 'about',
        label: 'I report damage with photos',
    },
    // Three rates behind one question. No tick of their own — a price is
    // already a yes, and a blank is already a no, which is how the bands work.
    {
        key: 'bedding_single', trade: 'sponge', type: 'priced', group: 'laundry',
        unit: 'each', quantityLabel: 'single beds',
        label: 'Single',
    },
    {
        key: 'bedding_double', trade: 'sponge', type: 'priced', group: 'laundry',
        unit: 'each', quantityLabel: 'double beds',
        label: 'Double',
    },
    {
        key: 'bedding_king', trade: 'sponge', type: 'priced', group: 'laundry',
        unit: 'each', quantityLabel: 'king beds',
        label: 'King',
    },
    {
        key: 'hot_tub_service', trade: 'sponge', type: 'priced', group: 'hot_tub',
        label: 'Hot tub servicing',
        hint: 'A flat fee on top of the clean.',
    },
    // --- window cleaning ---------------------------------------------------
    //
    // No "do you go upstairs" toggle: they use long poles, so it is not a real
    // distinction.
    //
    // And no flat storey surcharge either. It was a fifth way of pricing the
    // same thing, sitting beside the four the trade is being asked to choose
    // between — height is already the whole point of the per-pane-by-storey
    // shape below. One more option muddies the question.
    // Each one asked, then priced. No price is a real answer while the trade
    // is still telling us how they want to charge.
    {
        key: 'pressure_washing', trade: 'droplet', type: 'priced', group: 'svc_pressure',
        label: 'Pressure washing',
    },
    {
        key: 'gutter_cleaning', trade: 'droplet', type: 'priced', group: 'svc_gutter',
        label: 'Gutter cleaning',
    },
    {
        key: 'fascias_soffits', trade: 'droplet', type: 'priced', group: 'svc_fascias',
        label: 'Fascias and soffits cleaning',
    },
    {
        key: 'solar_panels', trade: 'droplet', type: 'priced', group: 'svc_solar',
        label: 'Solar panel cleaning',
    },

    // The three shapes a window cleaner might use, all on the page at once.
    // Nothing computes from them yet: they are here so real window cleaners
    // can say which one they actually use before one is chosen for them.
    {
        key: 'callout_base', trade: 'droplet', type: 'priced', group: 'pane_flat',
        label: 'Call-out',
    },
    {
        key: 'pane_rate', trade: 'droplet', type: 'priced', group: 'pane_flat',
        unit: 'each', quantityLabel: 'panes',
        label: 'Per pane',
    },
    {
        key: 'pane_ground', trade: 'droplet', type: 'priced', group: 'pane_storey',
        unit: 'each', quantityLabel: 'panes',
        label: 'Ground floor',
    },
    {
        key: 'pane_first', trade: 'droplet', type: 'priced', group: 'pane_storey',
        unit: 'each', quantityLabel: 'panes',
        label: 'First floor',
    },
    {
        key: 'pane_second_plus', trade: 'droplet', type: 'priced', group: 'pane_storey',
        unit: 'each', quantityLabel: 'panes',
        label: 'Second floor or higher',
    },
    {
        key: 'consumables', trade: 'sponge', type: 'reimbursed', group: 'reimbursed',
        label: 'Consumables on request',
        hint: 'Loo roll, bin bags, dishwasher tablets.',
    },
    {
        key: 'welcome_gifts', trade: 'sponge', type: 'reimbursed', group: 'reimbursed',
        label: 'Welcome gifts on request',
    },
    {
        key: 'receipts_provided', trade: 'sponge', type: 'toggle', group: 'reimbursed',
        label: 'I provide receipts for anything I buy',
    },

    // --- electrician -------------------------------------------------------
    //
    // Three lists, not one, and the order matters: what has gone wrong first,
    // because that is the search somebody makes with a problem in front of
    // them. See the note on EXTRA_GROUPS.
    {
        key: 'elec_no_power', trade: 'electrician', type: 'toggle', group: 'faults',
        label: 'No power at all',
    },
    {
        key: 'elec_tripping', trade: 'electrician', type: 'toggle', group: 'faults',
        label: 'Something keeps tripping',
    },
    {
        key: 'elec_burning', trade: 'electrician', type: 'toggle', group: 'faults',
        label: 'Burning smell or a scorched socket',
    },
    {
        key: 'elec_dead_circuit', trade: 'electrician', type: 'toggle', group: 'faults',
        label: 'Lights or sockets not working',
    },
    {
        key: 'elec_immersion', trade: 'electrician', type: 'toggle', group: 'faults',
        label: 'Immersion heater not heating',
    },
    {
        key: 'elec_shower', trade: 'electrician', type: 'toggle', group: 'faults',
        label: 'Electric shower not working',
    },

    {
        key: 'elec_eicr', trade: 'electrician', type: 'toggle', group: 'planned',
        label: 'EICR inspections and certificates',
        hint: 'A short-term let licence needs one every five years.',
    },
    {
        key: 'elec_pat', trade: 'electrician', type: 'toggle', group: 'planned',
        label: 'PAT testing',
        hint: 'How most owners show the appliances in a let are safe.',
    },
    {
        key: 'elec_alarms', trade: 'electrician', type: 'toggle', group: 'planned',
        label: 'Interlinked smoke and heat alarms',
        hint: 'A licence condition, and the standard for every Scottish home since 2022.',
    },
    {
        key: 'elec_hot_tub', trade: 'electrician', type: 'toggle', group: 'planned',
        label: 'Hot tub supply',
    },
    {
        key: 'elec_ev', trade: 'electrician', type: 'toggle', group: 'planned',
        label: 'EV chargers',
    },
    {
        key: 'elec_extra_points', trade: 'electrician', type: 'toggle', group: 'planned',
        label: 'Extra sockets and lighting',
    },
    {
        key: 'elec_eicr_fee', trade: 'electrician', type: 'priced', group: 'priced',
        label: 'EICR for a typical cottage',
        hint: 'Leave blank if it depends too much to say.',
    },

    {
        key: 'elec_same_day', trade: 'electrician', type: 'toggle', group: 'availability',
        label: 'I turn out same day',
    },
    {
        key: 'elec_out_of_hours', trade: 'electrician', type: 'toggle', group: 'availability',
        label: 'I answer out of hours and at weekends',
    },
    // An empty cottage is the one that gets hurt by this. A tripped supply in
    // January means no heating tonight and frozen pipes by morning, and there
    // is nobody there to notice — which is why this sits with the plumber and
    // the roofer rather than being an electrician's afterthought.
    {
        key: 'elec_winter', trade: 'electrician', type: 'toggle', group: 'availability',
        label: 'I turn out in winter for empty properties',
    },

    // --- joiner ------------------------------------------------------------
    {
        key: 'joiner_wont_shut', trade: 'joiner', type: 'toggle', group: 'faults',
        label: "Door or window won't shut",
    },
    {
        key: 'joiner_lock_broken', trade: 'joiner', type: 'toggle', group: 'faults',
        label: 'Lock broken or key snapped',
    },
    {
        key: 'joiner_locked_out', trade: 'joiner', type: 'toggle', group: 'faults',
        label: 'Guest locked out',
    },
    {
        key: 'joiner_broken_furniture', trade: 'joiner', type: 'toggle', group: 'faults',
        label: 'Broken bed, drawer or furniture',
    },
    {
        key: 'joiner_floorboards', trade: 'joiner', type: 'toggle', group: 'faults',
        label: 'Damaged floorboards',
    },
    {
        key: 'joiner_broken_window', trade: 'joiner', type: 'toggle', group: 'faults',
        label: 'Broken or cracked window',
    },

    {
        key: 'joiner_doors_windows', trade: 'joiner', type: 'toggle', group: 'planned',
        label: 'Doors and windows',
    },
    // Locks are on both lists on purpose. A snapped key on changeover day and
    // a planned re-key between seasons are the same tradesman and completely
    // different jobs.
    {
        key: 'joiner_locks', trade: 'joiner', type: 'toggle', group: 'planned',
        label: 'Lock changes and door furniture',
    },
    {
        key: 'joiner_kitchens', trade: 'joiner', type: 'toggle', group: 'planned',
        label: 'Kitchen fitting',
    },
    {
        key: 'joiner_flooring', trade: 'joiner', type: 'toggle', group: 'planned',
        label: 'Floor laying and repairs',
    },
    {
        key: 'joiner_decking', trade: 'joiner', type: 'toggle', group: 'planned',
        label: 'Decking, steps and outdoor timber',
    },
    {
        key: 'joiner_bespoke', trade: 'joiner', type: 'toggle', group: 'planned',
        label: 'Built-in storage and bespoke pieces',
    },
    // Steep and loose stairs are both common in an old cottage and a safety
    // matter in a let, so this is a job owners ring about rather than one they
    // plan.
    {
        key: 'joiner_stairs', trade: 'joiner', type: 'toggle', group: 'planned',
        label: 'Staircases and bannisters',
    },
    {
        key: 'joiner_workshop', trade: 'joiner', type: 'toggle', group: 'planned',
        label: 'I have a workshop for off-site work',
    },

    {
        key: 'joiner_same_day', trade: 'joiner', type: 'toggle', group: 'availability',
        label: 'I turn out same day',
    },
    {
        key: 'joiner_out_of_hours', trade: 'joiner', type: 'toggle', group: 'availability',
        label: 'I answer out of hours and at weekends',
    },

    // --- plumber -----------------------------------------------------------
    //
    // Gas and oil are NOT here. They are columns on the listing, because they
    // decide whether it can be approved at all and an owner needs to see the
    // answer before they ring rather than after.
    {
        key: 'plumb_leak', trade: 'plumber', type: 'toggle', group: 'faults',
        label: 'Leaks',
    },
    // Rural Galloway runs on private supplies, boreholes and pumps as much as
    // on the mains, so "nothing is coming out of the tap" is its own fault
    // rather than a symptom of a leak — and with guests in the cottage it is
    // the most urgent one on the list.
    {
        key: 'plumb_no_water', trade: 'plumber', type: 'toggle', group: 'faults',
        label: 'No water at all',
    },
    {
        key: 'plumb_no_hot_water', trade: 'plumber', type: 'toggle', group: 'faults',
        label: 'No hot water',
    },
    {
        key: 'plumb_no_heating', trade: 'plumber', type: 'toggle', group: 'faults',
        label: 'No heating',
    },
    {
        key: 'plumb_boiler_fault', trade: 'plumber', type: 'toggle', group: 'faults',
        label: 'Boiler not firing',
    },
    {
        key: 'plumb_burst_frozen', trade: 'plumber', type: 'toggle', group: 'faults',
        label: 'Burst or frozen pipes',
    },
    // Kept apart from the outside drains below, which is the whole point of
    // splitting this list up. A blocked gully is a job for next week. A
    // blocked toilet is a job for tonight, because the guests who blocked it
    // are still in the cottage.
    {
        key: 'plumb_blocked_toilet', trade: 'plumber', type: 'toggle', group: 'faults',
        label: 'Blocked toilet or shower',
    },
    {
        key: 'plumb_drains', trade: 'plumber', type: 'toggle', group: 'faults',
        label: 'Blocked outside drains and gullies',
    },

    {
        key: 'plumb_gas_certificate', trade: 'plumber', type: 'toggle', group: 'planned',
        label: 'Annual gas safety certificates',
        hint: 'The yearly check a let with gas has to have.',
    },
    {
        key: 'plumb_legionella', trade: 'plumber', type: 'toggle', group: 'planned',
        label: 'Legionella risk assessments',
        hint: 'Asked for as part of short-term let licensing.',
    },
    {
        key: 'plumb_boiler_service', trade: 'plumber', type: 'toggle', group: 'planned',
        label: 'Boiler servicing',
    },
    {
        key: 'plumb_bathrooms', trade: 'plumber', type: 'toggle', group: 'planned',
        label: 'Full bathroom installations',
    },
    {
        key: 'plumb_unvented', trade: 'plumber', type: 'toggle', group: 'planned',
        label: 'Unvented hot water cylinders',
    },
    {
        key: 'plumb_hot_tub', trade: 'plumber', type: 'toggle', group: 'planned',
        label: 'Hot tub plumbing and filtration',
    },

    {
        key: 'plumb_same_day', trade: 'plumber', type: 'toggle', group: 'availability',
        label: 'I turn out same day',
    },
    {
        key: 'plumb_out_of_hours', trade: 'plumber', type: 'toggle', group: 'availability',
        label: 'I answer out of hours and at weekends',
    },
    {
        key: 'plumb_winter', trade: 'plumber', type: 'toggle', group: 'availability',
        label: 'I turn out in winter for empty properties',
    },

    // --- roofer ------------------------------------------------------------
    {
        key: 'roof_ceiling_leak', trade: 'roofer', type: 'toggle', group: 'faults',
        label: 'Water coming through a ceiling',
    },
    {
        key: 'roof_storm', trade: 'roofer', type: 'toggle', group: 'faults',
        label: 'Storm damage',
    },
    {
        key: 'roof_slates_off', trade: 'roofer', type: 'toggle', group: 'faults',
        label: 'Slates or tiles off',
    },
    {
        key: 'roof_gutter_fault', trade: 'roofer', type: 'toggle', group: 'faults',
        label: 'Gutter overflowing or come down',
    },
    {
        key: 'roof_chimney_leak', trade: 'roofer', type: 'toggle', group: 'faults',
        label: 'Chimney or flashing leaking',
    },
    // A rural job that nothing else on the list covered, and one a host hears
    // about from the guests rather than from looking.
    {
        key: 'roof_loft_intruder', trade: 'roofer', type: 'toggle', group: 'faults',
        label: 'Something has got into the loft',
    },

    {
        key: 'roof_slate', trade: 'roofer', type: 'toggle', group: 'planned',
        label: 'Slate and tile repairs',
    },
    {
        key: 'roof_flat', trade: 'roofer', type: 'toggle', group: 'planned',
        label: 'Flat roofs and felting',
    },
    {
        key: 'roof_gutters', trade: 'roofer', type: 'toggle', group: 'planned',
        label: 'Gutters, fascias and soffits',
    },
    {
        key: 'roof_chimney', trade: 'roofer', type: 'toggle', group: 'planned',
        label: 'Chimneys and lead work',
    },
    {
        key: 'roof_moss', trade: 'roofer', type: 'toggle', group: 'planned',
        label: 'Moss removal and roof cleaning',
    },
    {
        key: 'roof_scaffold', trade: 'roofer', type: 'toggle', group: 'planned',
        label: 'I arrange my own scaffolding or tower',
        hint: 'Worth saying — otherwise the owner assumes it is on top of the bill.',
    },
    {
        key: 'roof_survey', trade: 'roofer', type: 'priced', group: 'priced',
        label: 'Roof survey with photographs',
    },

    {
        key: 'roof_same_day', trade: 'roofer', type: 'toggle', group: 'availability',
        label: 'I turn out same day',
    },
    {
        key: 'roof_out_of_hours', trade: 'roofer', type: 'toggle', group: 'availability',
        label: 'I answer out of hours and at weekends',
    },
    {
        key: 'roof_winter', trade: 'roofer', type: 'toggle', group: 'availability',
        label: 'I turn out in winter for empty properties',
    },

    // --- painter and decorator ---------------------------------------------
    //
    // One list, deliberately. Painting is almost never a fault, and splitting
    // it would have meant inventing urgent-sounding entries to fill a column —
    // a scuffed wall is not a leak. What varies between painters is how fast
    // they can get in and out, which is what the availability toggles say.
    {
        key: 'paint_interior', trade: 'painter', type: 'toggle', group: 'planned',
        label: 'Interior decorating',
    },
    {
        key: 'paint_exterior', trade: 'painter', type: 'toggle', group: 'planned',
        label: 'Exterior painting and masonry',
    },
    {
        key: 'paint_changeover', trade: 'painter', type: 'toggle', group: 'planned',
        label: 'Touch-ups between changeovers',
        hint: 'A day between guests, scuffs and chips seen to.',
    },
    {
        key: 'paint_damp_stain', trade: 'painter', type: 'toggle', group: 'planned',
        label: 'Sealing and covering damp patches and stains',
    },
    // Filed under `planned`, like every other maintenance trade, rather than
    // under `about`. These eight were written before the three-axis split and
    // stayed where they were: `about` renders with no heading, so a painter's
    // work sat in an unlabelled block while the other five trades had theirs
    // under "Work booked in advance". Nothing looked broken, because the
    // section heading above adapts when there is no faults list — it was the
    // host-facing shop that would have shown the painter differently from
    // everybody else. tests/service-extras.test.ts derives the maintenance
    // trades from TRADE_GROUPS now, so this cannot drift back unnoticed.
    //
    // The job that follows the plumber out of the door. Nobody thinks to look
    // for it until a repair has left a room worse than it found it.
    {
        key: 'paint_making_good', trade: 'painter', type: 'toggle', group: 'planned',
        label: 'Making good after a leak or a repair',
    },
    {
        key: 'paint_wallpaper', trade: 'painter', type: 'toggle', group: 'planned',
        label: 'Wallpapering',
    },
    {
        key: 'paint_windows', trade: 'painter', type: 'toggle', group: 'planned',
        label: 'Sash windows and outside woodwork',
    },
    {
        key: 'paint_out_of_season', trade: 'painter', type: 'toggle', group: 'planned',
        label: 'I can work out of season, when the cottage is empty',
    },

    {
        key: 'paint_same_day', trade: 'painter', type: 'toggle', group: 'availability',
        label: 'I can get in at short notice between bookings',
    },

    // --- handyman ----------------------------------------------------------
    {
        key: 'handy_guest_reported', trade: 'handyman', type: 'toggle', group: 'faults',
        label: 'Something a guest has reported broken',
    },
    {
        key: 'handy_wont_close', trade: 'handyman', type: 'toggle', group: 'faults',
        label: 'Door, window or gate not closing',
    },
    {
        key: 'handy_small_breakages', trade: 'handyman', type: 'toggle', group: 'faults',
        label: 'Small breakages mid-stay',
        hint: 'Toilet seat, shower head, curtain pole.',
    },
    {
        key: 'handy_appliance_dead', trade: 'handyman', type: 'toggle', group: 'faults',
        label: 'Appliance stopped working',
    },

    {
        key: 'handy_snag_list', trade: 'handyman', type: 'toggle', group: 'planned',
        label: 'I will work through a list in one visit',
        hint: 'The thing most owners actually want and cannot find.',
    },
    {
        key: 'handy_fixings', trade: 'handyman', type: 'toggle', group: 'planned',
        label: 'Shelves, curtain poles, blinds and TV brackets',
    },
    {
        key: 'handy_flatpack', trade: 'handyman', type: 'toggle', group: 'planned',
        label: 'Flat-pack assembly',
    },
    {
        key: 'handy_appliances', trade: 'handyman', type: 'toggle', group: 'planned',
        label: 'Swapping over appliances',
    },
    {
        key: 'handy_outdoor', trade: 'handyman', type: 'toggle', group: 'planned',
        label: 'Fence panels, gates and sheds',
    },
    {
        key: 'handy_keysafe', trade: 'handyman', type: 'toggle', group: 'planned',
        label: 'I can fit key safes and house numbers',
    },

    {
        key: 'handy_same_day', trade: 'handyman', type: 'toggle', group: 'availability',
        label: 'I turn out same day',
    },
    {
        key: 'handy_out_of_hours', trade: 'handyman', type: 'toggle', group: 'availability',
        label: 'I answer out of hours and at weekends',
    },
];

export const PRICING_GROUPS = ['pane_flat', 'pane_storey'] as const;

export function isPricingGroup(group: string): boolean {
    return (PRICING_GROUPS as readonly string[]).indexOf(group) !== -1;
}

export function extrasFor(trade: string): ServiceExtra[] {
    return SERVICE_EXTRAS.filter((e) => e.trade === trade);
}

// What belongs under "what else do you offer" — everything except the pricing
// structures, which render beside the prices.
export function offeringsFor(trade: string): ServiceExtra[] {
    return extrasFor(trade).filter((e) => !isPricingGroup(e.group));
}

export function extraByKey(key: string): ServiceExtra | null {
    return SERVICE_EXTRAS.filter((e) => e.key === key)[0] || null;
}

export interface ExtrasDraft {
    trade?: string | null;
    extras?: Record<string, { offered?: boolean; price?: any; notes?: any }> | null;
}

// Everything here is optional. A priced extra has no tick of its own: the
// price is the yes and a blank is the no, exactly as the size bands work. So
// the only thing that can be wrong is something typed into the box that is not
// a price.
export function extrasProblems(draft: ExtrasDraft): Problem[] {
    const problems: Problem[] = [];
    const extras = draft.extras || {};

    for (const extra of extrasFor(String(draft.trade || ''))) {
        if (extra.type !== 'priced') continue;

        const entry = extras[extra.key];
        if (!entry) continue;

        const raw = entry.price;
        if (raw === undefined || raw === null || String(raw).trim() === '') continue;

        if (!(Number(raw) > 0)) {
            problems.push({
                field: 'extra_price_' + extra.key,
                message: 'That is not a price. Leave it blank if you do not offer it.',
            });
        }
    }

    return problems;
}

// Whether a gated group has anything in it. This is what the yes/no would have
// stored, worked out from the prices instead.
export function groupIsOffered(
    group: string,
    trade: string,
    extras: Record<string, { price?: any }> | null | undefined
): boolean {
    const chosen = extras || {};
    return extrasFor(trade)
        .filter((e) => e.group === group && e.type === 'priced')
        .some((e) => {
            const entry = chosen[e.key];
            return !!entry && String(entry.price || '').trim() !== '' && Number(entry.price) > 0;
        });
}

// ---------------------------------------------------------------------------
// REGISTRATION
// ---------------------------------------------------------------------------
//
// Three kinds of work are restricted by law rather than by skill: gas, oil and
// electrics. The trade alone does not decide it — most plumbers do gas, plenty
// also do oil, and in Dumfries & Galloway, where most of the region is off the
// gas grid, both at once is ordinary. So gas and oil are questions inside the
// plumber's application rather than trades of their own.
//
// Part P is a section of the Building Regulations, not a register. An
// electrician does not have "a Part P number" — they have membership of a
// competent person scheme, and the scheme has to be named or the number cannot
// be checked against anything.
export const REGISTRATION_SCHEMES = [
    {
        key: 'gas_safe',
        label: 'Gas Safe',
        body: 'Gas Safe Register',
        numberLabel: 'Gas Safe registration number',
        // Publicly searchable by design, which is why the number goes on the
        // listing rather than being hidden — an owner can check it themselves.
        publicRegister: true,
    },
    {
        key: 'oftec',
        label: 'OFTEC',
        body: 'OFTEC',
        numberLabel: 'OFTEC registration number',
        publicRegister: true,
    },
    {
        key: 'part_p_niceic',
        label: 'NICEIC',
        body: 'NICEIC',
        numberLabel: 'NICEIC enrolment number',
        publicRegister: true,
    },
    {
        key: 'part_p_napit',
        label: 'NAPIT',
        body: 'NAPIT',
        numberLabel: 'NAPIT membership number',
        publicRegister: true,
    },
    {
        key: 'part_p_elecsa',
        label: 'ELECSA',
        body: 'ELECSA',
        numberLabel: 'ELECSA enrolment number',
        publicRegister: true,
    },
    {
        key: 'part_p_stroma',
        label: 'STROMA',
        body: 'STROMA Certification',
        numberLabel: 'STROMA membership number',
        publicRegister: true,
    },
] as const;

export const PART_P_SCHEMES = ['part_p_niceic', 'part_p_napit', 'part_p_elecsa', 'part_p_stroma'] as const;

export function schemeLabel(key: string): string {
    const found = REGISTRATION_SCHEMES.filter((s) => s.key === key)[0];
    return found ? found.label : key;
}

export function schemeNumberLabel(key: string): string {
    const found = REGISTRATION_SCHEMES.filter((s) => s.key === key)[0];
    return found ? found.numberLabel : 'Registration number';
}

export function isPartP(key: string): boolean {
    return (PART_P_SCHEMES as readonly string[]).indexOf(key) !== -1;
}

// Whether the trade asks the gas and oil questions at all. Only the plumber
// does: a roofer ticking "I do gas work" is a question nobody should be shown.
export function asksAboutFuel(trade: string): boolean {
    return trade === 'plumber';
}

// Whether the trade is asked for free-text skills.
//
// Only the handyman, and the reason is what the tags are for rather than who
// might have something to say. A roofer's work is a roof; a joiner's is
// joinery; both are already described by their trade and their offerings, so
// a tag box is a blank field to fill in for no gain.
//
// A handyman is the case where the trade name genuinely does not say what he
// does — bricklaying, fencing, dyking — and where a host would otherwise have
// no way to know without asking.
//
// This was briefly on all six. It was friction on five of them.
export function asksAboutSkills(trade: string): boolean {
    return trade === 'handyman';
}

export interface RegistrationDraft {
    trade?: string | null;
    does_gas?: boolean | null;
    does_oil?: boolean | null;
}

// Which registrations this listing must produce before it can go live.
//
// Returned as a list, not one value, because a rural plumber doing gas in the
// towns and oil off-grid holds two at once and both have to be checked.
export function requiredSchemes(draft: RegistrationDraft): string[] {
    const trade = String(draft.trade || '');
    const needed: string[] = [];

    // An electrician always needs one, and which body it is with is theirs to
    // say — so the requirement is "one of the four", not a named scheme.
    if (trade === 'electrician') needed.push('part_p');

    if (asksAboutFuel(trade)) {
        if (draft.does_gas) needed.push('gas_safe');
        if (draft.does_oil) needed.push('oftec');
    }

    return needed;
}

// Which schemes this listing may offer at all. A handyman claiming NICEIC
// membership is not something to capture and check, it is something not to ask.
export function offerableSchemes(draft: RegistrationDraft): string[] {
    const trade = String(draft.trade || '');
    const allowed: string[] = [];

    if (trade === 'electrician') for (const key of PART_P_SCHEMES) allowed.push(key);
    if (asksAboutFuel(trade)) {
        if (draft.does_gas) allowed.push('gas_safe');
        if (draft.does_oil) allowed.push('oftec');
    }

    return allowed;
}

export interface RegistrationRow {
    scheme?: string | null;
    number?: string | null;
    verified_at?: string | null;
    verified_number?: string | null;
    expires_at?: string | null;
}

// The whole gate, in one function.
//
// Never `!!row.verified_at`. The number as it was checked has to still be the
// number on the row, so a provider who was checked in March and edits their
// number in June is not verified in June — no cron job, no trigger, nothing to
// remember to clear. The columns behind it cannot be written from a browser at
// all; see the grants in 20260826_trade_registration.sql.
export function registrationVerified(row: RegistrationRow | null | undefined): boolean {
    if (!row || !row.verified_at) return false;

    const checked = String(row.verified_number || '').trim();
    if (!checked) return false;

    return checked === String(row.number || '').trim();
}

// Expired is not the same as unverified, and they read differently in the
// queue: one was never checked, the other was checked and has run out.
export function registrationExpired(row: RegistrationRow | null | undefined, today?: Date): boolean {
    if (!row || !row.expires_at) return false;

    const when = new Date(String(row.expires_at) + 'T00:00:00Z');
    if (isNaN(when.getTime())) return false;

    const now = today || new Date();
    return when.getTime() < now.getTime();
}

// What stops a listing being approved: a required registration missing
// altogether, or one nobody has checked, or one that has run out.
//
// This is what the admin queue shows and what the decision route refuses on.
// It takes the rows rather than reading them, so it can be tested without a
// database anywhere near it.
export function registrationBlockers(
    draft: RegistrationDraft,
    rows: RegistrationRow[] | null | undefined,
    today?: Date
): string[] {
    const have = (rows || []).filter((r) => String(r.number || '').trim() !== '');
    const blockers: string[] = [];

    for (const required of requiredSchemes(draft)) {
        const matching = required === 'part_p'
            ? have.filter((r) => isPartP(String(r.scheme || '')))
            : have.filter((r) => String(r.scheme || '') === required);

        if (matching.length === 0) {
            blockers.push(
                required === 'part_p'
                    ? 'No competent person scheme given for the electrical work.'
                    : 'No ' + schemeLabel(required) + ' number given.'
            );
            continue;
        }

        for (const row of matching) {
            if (!registrationVerified(row)) {
                blockers.push(schemeLabel(String(row.scheme || '')) + ' number has not been checked yet.');
            } else if (registrationExpired(row, today)) {
                blockers.push(schemeLabel(String(row.scheme || '')) + ' registration has expired.');
            }
        }
    }

    return blockers;
}

// What the provider is told while filling the form in. Deliberately narrower
// than the blockers above: they can see that a number is missing, they cannot
// see and must not be able to change whether it has been checked.
export function registrationProblems(
    draft: RegistrationDraft,
    rows: RegistrationRow[] | null | undefined
): Problem[] {
    const problems: Problem[] = [];
    const have = (rows || []).filter((r) => String(r.number || '').trim() !== '');

    for (const required of requiredSchemes(draft)) {
        const matching = required === 'part_p'
            ? have.filter((r) => isPartP(String(r.scheme || '')))
            : have.filter((r) => String(r.scheme || '') === required);

        if (matching.length > 0) continue;

        problems.push(
            required === 'part_p'
                ? {
                    field: 'registration_part_p',
                    message: 'Electrical work has to be notified under Part P. Choose your scheme and add your number.',
                }
                : {
                    field: 'registration_' + required,
                    message: 'Add your ' + schemeLabel(required) + ' number — we check it before you go live.',
                }
        );
    }

    return problems;
}

// What a host reads about the call-out fee, in one place so the admin card and
// the directory cannot word it differently.
//
// The waiver is the provider's own offer, not a platform rule — plenty of
// trades do it and it is a real advantage to the one offering it, so it is
// said in the same breath as the fee rather than buried as a footnote.
//
// Null when there is no fee, because "no call-out fee" and "they have not said"
// are different things and only one of them is ours to announce.
export function calloutLine(
    fee: number | string | null | undefined,
    waived?: boolean | null
): string | null {
    const raw = String(fee === null || fee === undefined ? '' : fee).trim();
    if (raw === '') return null;

    const amount = Number(raw);
    if (!(amount > 0)) return null;

    // Whole pounds where it is whole pounds. "£40.00 call-out" reads like a
    // system wrote it.
    const shown = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);

    return waived
        ? '£' + shown + ' call-out, waived if you go ahead'
        : '£' + shown + ' call-out';
}

// ---------------------------------------------------------------------------
// WHY A LISTING IS IN THE QUEUE
// ---------------------------------------------------------------------------
//
// One function, because the admin page used to be three independent filters —
// `status === 'pending_review'`, `hasUnreviewedChanges`, and a registration
// blocker check — and adding a fourth reason a listing needs looking at broke
// nothing and showed nothing. The row simply never appeared, and the first
// anybody heard of it was a provider asking why their tag never went live.
//
// Same shape as canBeRequested reading "not priced by the hour" instead of
// "not maintenance": the page asserted the list of reasons that existed rather
// than the rule, which is "show me anything waiting on me".
//
// So the reasons live here, together, and there is a test that loops all of
// them. A fifth reason added to this list without being handled fails it.
export type AttentionReason = 'application' | 'changes' | 'registration' | 'skills';

export const ATTENTION_REASONS: AttentionReason[] = [
    'application',
    'changes',
    'registration',
    'skills',
];

export function needsAttention(
    provider: any,
    registrations?: RegistrationRow[] | null,
    skills?: SkillRow[] | null,
    today?: Date
): AttentionReason[] {
    const reasons: AttentionReason[] = [];
    if (!provider) return reasons;

    // Waiting on a decision.
    if (provider.status === 'pending_review') reasons.push('application');

    // Live, and has changed something worth re-reading.
    if (hasUnreviewedChanges(provider)) reasons.push('changes');

    // A number to look up on somebody else's register.
    if (registrationBlockers(provider, registrations, today).length > 0) {
        reasons.push('registration');
    }

    // A tag claiming restricted work without a verified registration behind
    // it. Not an accusation — most of these are somebody who does the work and
    // has not given us their number yet.
    const verified = (registrations || []).map((r) => ({
        scheme: r.scheme,
        verified: registrationVerified(r),
    }));

    if (blockedSkills(skills, verified).length > 0) reasons.push('skills');

    return reasons;
}

export function attentionLabel(reason: AttentionReason): string {
    if (reason === 'application') return 'waiting for a decision';
    if (reason === 'changes') return 'live with changes to look at';
    if (reason === 'registration') return 'a registration to check';
    return 'a skill needing proof';
}

export const REVIEW_WITHIN_HOURS = 48;

export interface ProviderDraft {
    business_name?: string | null;
    trade?: string | null;
    description?: string | null;
    contact_email?: string | null;
    audience?: string | null;
    photos?: string[] | null;
    areaCount?: number;
    prices?: Record<string, { price?: any; typical_hours?: any }> | null;
    callout_fee?: any;
    hourly_rate?: any;
    callout_waived?: boolean | null;
    extras?: Record<string, { offered?: boolean; price?: any; notes?: any }> | null;
    does_gas?: boolean | null;
    does_oil?: boolean | null;
    registrations?: RegistrationRow[] | null;
}

export interface Problem {
    field: string;
    message: string;
}

export const MIN_DESCRIPTION = 40;

// What has to be true before it can be sent for review. Deliberately not
// enforced while a draft is being filled in — a half-finished form should save,
// not argue.
export function submitProblems(draft: ProviderDraft): Problem[] {
    const problems: Problem[] = [];
    const name = (draft.business_name || '').trim();
    const description = (draft.description || '').trim();
    const email = (draft.contact_email || '').trim();

    if (name.length < 2) {
        problems.push({ field: 'business_name', message: 'Add the name of your business.' });
    }

    if (!draft.trade) {
        problems.push({ field: 'trade', message: 'Choose the trade that fits best.' });
    }

    if (description.length < MIN_DESCRIPTION) {
        problems.push({
            field: 'description',
            message: 'Say a bit more about what you do — at least a sentence or two.',
        });
    }

    if (!email || email.indexOf('@') === -1) {
        problems.push({
            field: 'contact_email',
            message: 'Add an email address we can reach you on about jobs.',
        });
    }

    if (!draft.audience) {
        problems.push({ field: 'audience', message: 'Choose who you sell to.' });
    }

    if (!draft.areaCount) {
        problems.push({
            field: 'areas',
            message: 'Add at least one area you cover, so we know who to show you to.',
        });
    }

    for (const problem of pricingProblems(draft)) problems.push(problem);
    for (const problem of extrasProblems(draft)) problems.push(problem);

    // Restricted work needs its number before it can be sent, not before it
    // goes live — otherwise the first time somebody hears they need one is
    // after a decline, which is a slower way of saying the same thing.
    for (const problem of registrationProblems(draft, draft.registrations)) problems.push(problem);

    return problems;
}

export function canSubmit(draft: ProviderDraft): boolean {
    return submitProblems(draft).length === 0;
}

// Distance between two points on the earth, in miles. Used to decide whether a
// provider covers a property — listings already carry latitude and longitude
// for the map, so there is nothing to geocode.
export function milesBetween(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
): number {
    const EARTH_MILES = 3958.8;
    const toRad = (d: number) => (d * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

    return EARTH_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Coverage is picked from the towns the site already uses in its search,
// with a radius, rather than a map pin. A tradesperson knows they cover
// "Kirkcudbright and fifteen miles"; they do not know their own latitude.
// Coordinates are the town centres.
export const COVERAGE_TOWNS = [
    { key: 'kirkcudbright', label: 'Kirkcudbright', lat: 54.8362, lng: -4.0530 },
    { key: 'castle-douglas', label: 'Castle Douglas', lat: 54.9375, lng: -3.9319 },
    { key: 'gatehouse-of-fleet', label: 'Gatehouse of Fleet', lat: 54.8797, lng: -4.1836 },
    { key: 'dumfries', label: 'Dumfries', lat: 55.0709, lng: -3.6033 },
    { key: 'dalbeattie', label: 'Dalbeattie', lat: 54.9350, lng: -3.8200 },
    { key: 'newton-stewart', label: 'Newton Stewart', lat: 54.9575, lng: -4.4900 },
    { key: 'moffat', label: 'Moffat', lat: 55.3339, lng: -3.4400 },
    { key: 'stranraer', label: 'Stranraer', lat: 54.9021, lng: -5.0269 },
    { key: 'wigtown', label: 'Wigtown', lat: 54.8686, lng: -4.4425 },
] as const;

export function townByKey(key: string) {
    return COVERAGE_TOWNS.filter((t) => t.key === key)[0] || null;
}

export interface Area {
    centre_lat: number;
    centre_lng: number;
    radius_miles: number;
}

export function coversPoint(areas: Area[], lat: number, lng: number): boolean {
    return (areas || []).some(
        (a) => milesBetween(a.centre_lat, a.centre_lng, lat, lng) <= Number(a.radius_miles)
    );
}

// What the provider is told their status means. The words a person reads, kept
// next to the values they come from so the two cannot drift.
export function statusSummary(status: string): { label: string; detail: string } {
    if (status === 'draft') {
        return {
            label: 'Not sent yet',
            detail: 'Fill this in and send it to us when you are ready. Nothing is visible to anyone else.',
        };
    }
    if (status === 'pending_review') {
        return {
            label: 'With us for review',
            detail:
                'We check every business before it appears, usually within '
                + REVIEW_WITHIN_HOURS
                + ' hours. We will email you either way.',
        };
    }
    if (status === 'approved') {
        return { label: 'Live', detail: 'People can find you and request work.' };
    }
    if (status === 'declined') {
        return {
            label: 'Not approved',
            detail: 'We have emailed you why. You can change it and send it again.',
        };
    }
    return { label: 'Hidden', detail: 'Not currently shown on the site.' };
}
