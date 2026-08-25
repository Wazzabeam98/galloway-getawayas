// The vocabulary and the rules for a service provider, in one place, so the
// sign-up form, the admin screen and anything later all agree.
//
// Same shape as lib/listingRules.ts: pure functions and constants, no queries,
// so it can be used on the server and in the browser and tested without a
// database anywhere near it.

export const TRADES = [
    { key: 'sponge', label: 'Cleaning' },
    { key: 'bin', label: 'Waste removal' },
    { key: 'spanner', label: 'Maintenance & repairs' },
    { key: 'trees', label: 'Gardening & grounds' },
    { key: 'droplet', label: 'Window cleaning' },
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
export const HOST_TRADES = ['sponge', 'bin', 'trees', 'droplet', 'spanner'] as const;
export const GUEST_TRADES = ['chef', 'cake', 'basket', 'paw'] as const;

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

// How long a new provider gets before anything is charged. Nothing is charged
// during the trial at all — this only decides what the summary email says is
// coming.
export const TRIAL_DAYS = 90;

export function trialEndsAt(from: Date): string {
    const end = new Date(from.getTime());
    end.setDate(end.getDate() + TRIAL_DAYS);
    return end.toISOString();
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
export const REVIEWABLE_FIELDS = [
    'business_name',
    'trade',
    'description',
    'audience',
    'photos',
    'logo',
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
    now: Date,
    firstTimeOrDraft: boolean
): Record<string, any> {
    // Already live. Their edits are live too, and the queue works out from the
    // digest whether any of them want looking at.
    if (currentStatus === 'approved') return {};

    const patch: Record<string, any> = {
        status: 'pending_review',
        submitted_at: now.toISOString(),
        review_note: null,
    };

    // Set once, when they first apply, so the trial is measured from the day
    // they joined rather than the day we got round to them.
    if (firstTimeOrDraft) patch.trial_ends_at = trialEndsAt(now);

    return patch;
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

const TRADE_PRICING: Record<string, PricingModel> = {
    sponge: 'bands',
    bin: 'bands',
    trees: 'bands',
    droplet: 'bands',
    spanner: 'callout_hourly',
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

export function canBeRequested(trade: string): boolean {
    return pricingModelFor(trade) !== 'callout_hourly';
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

    if (model === 'callout_hourly') {
        const callout = Number(draft.callout_fee);
        const hourly = Number(draft.hourly_rate);

        if (!(callout > 0)) {
            problems.push({ field: 'callout_fee', message: 'Add your call-out fee.' });
        }
        if (!(hourly > 0)) {
            problems.push({ field: 'hourly_rate', message: 'Add your hourly rate after the call-out.' });
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
    { key: 'quote', label: 'Quote per job' },
    { key: 'priced', label: 'Charged on top' },
    { key: 'reimbursed', label: 'Bought for the owner and paid back' },
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
        | 'pane_flat' | 'pane_storey' | 'quote';
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
    // distinction. Height is priced, not offered or withheld.
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

    // The four shapes a window cleaner might use, all on the page at once.
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
        key: 'quote_per_job', trade: 'droplet', type: 'toggle', group: 'quote',
        label: 'I price each job when I am asked',
    },
    {
        key: 'upstairs_surcharge', trade: 'droplet', type: 'priced', group: 'priced',
        label: 'Extra for upstairs windows',
        hint: 'On a two-floor property. Leave blank if it is included in your price.',
    },
    {
        key: 'high_access_surcharge', trade: 'droplet', type: 'priced', group: 'priced',
        label: 'Extra for three floors or attic windows',
        hint: 'Leave blank if it is included, or if you do not go that high.',
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
];

export const PRICING_GROUPS = ['pane_flat', 'pane_storey', 'quote'] as const;

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
    extras?: Record<string, { offered?: boolean; price?: any; notes?: any }> | null;
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
