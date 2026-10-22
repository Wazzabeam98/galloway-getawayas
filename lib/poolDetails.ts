// The pool on a holiday let — whether it is the guests' own or shared with
// other people, and whether it is indoors or out. Airbnb asks both once "Pool"
// is ticked and shows the answer as one line ("Private outdoor pool"); we do
// the same. "Pool" itself stays an AMENITY (the badge, the Pool chip and the
// filter read it, exactly like Hot tub and Sauna); these two answers are
// columns (listings.pool_access, listings.pool_setting), null until the host
// says. One set of rules for the wizard, the editor and the save route.
// Framework-free and relative imports only (unit-tested).

export const POOL_AMENITY = 'Pool';

export type PoolAccess = 'private' | 'shared';
export type PoolSetting = 'indoor' | 'outdoor';

export const POOL_ACCESS_OPTIONS: { value: PoolAccess; label: string; hint: string }[] = [
    { value: 'private', label: 'Private', hint: 'Only your guests use it' },
    { value: 'shared', label: 'Shared', hint: 'Other people use it too' },
];

export const POOL_SETTING_OPTIONS: { value: PoolSetting; label: string }[] = [
    { value: 'indoor', label: 'Indoor' },
    { value: 'outdoor', label: 'Outdoor' },
];

export function hasPool(amenities: string[] | null | undefined): boolean {
    return Array.isArray(amenities) && amenities.indexOf(POOL_AMENITY) !== -1;
}

export function cleanPoolAccess(v: unknown): PoolAccess | null {
    return v === 'private' || v === 'shared' ? v : null;
}

export function cleanPoolSetting(v: unknown): PoolSetting | null {
    return v === 'indoor' || v === 'outdoor' ? v : null;
}

/**
 * The two answers as they may be stored: anything unrecognised becomes null,
 * and both are cleared when the listing no longer has a pool — so an old answer
 * never resurfaces if the host ticks Pool again later on a different place.
 */
export function cleanPoolDetails(
    amenities: string[] | null | undefined,
    access: unknown,
    setting: unknown,
): { pool_access: PoolAccess | null; pool_setting: PoolSetting | null } {
    if (!hasPool(amenities)) return { pool_access: null, pool_setting: null };
    return { pool_access: cleanPoolAccess(access), pool_setting: cleanPoolSetting(setting) };
}

/**
 * Airbnb's one line: "Private outdoor pool", "Shared indoor pool", "Private
 * pool", "Outdoor pool" — or just "Pool" when the host has not said.
 */
export function poolLabel(access: unknown, setting: unknown): string {
    const a = cleanPoolAccess(access);
    const s = cleanPoolSetting(setting);
    const words = [a, s].filter(Boolean) as string[];
    if (!words.length) return 'Pool';
    const line = words.join(' ') + ' pool';
    return line.charAt(0).toUpperCase() + line.slice(1);
}

/** The listing page's highlight line under the pool's title. */
export function poolBlurb(access: unknown, setting: unknown): string {
    const a = cleanPoolAccess(access);
    const s = cleanPoolSetting(setting);
    if (a === 'private') return 'A pool just for your group.';
    if (a === 'shared') return 'A pool shared with other guests.';
    if (s === 'indoor') return 'Swim whatever the weather.';
    return 'Cool off in the pool after a day out.';
}
