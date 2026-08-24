// The vocabulary and the rules for a service provider, in one place, so the
// sign-up form, the admin screen and anything later all agree.
//
// Same shape as lib/listingRules.ts: pure functions and constants, no queries,
// so it can be used on the server and in the browser and tested without a
// database anywhere near it.

export const TRADES = [
    { key: 'sponge', label: 'Cleaning' },
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

// Which of the two shops it appears in.
export const AUDIENCES = [
    { key: 'guest', label: 'Guests staying nearby', hint: 'Cakes, chefs, hampers — bought by someone on holiday.' },
    { key: 'host', label: 'Property owners', hint: 'Changeover cleans, gardening, repairs — bought by a host.' },
    { key: 'both', label: 'Both', hint: 'Sold to guests and to owners.' },
] as const;

// How long a new provider gets before anything is charged. Nothing is charged
// during the trial at all — this only decides what the summary email says is
// coming.
export const TRIAL_DAYS = 90;

export function trialEndsAt(from: Date): string {
    const end = new Date(from.getTime());
    end.setDate(end.getDate() + TRIAL_DAYS);
    return end.toISOString();
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
