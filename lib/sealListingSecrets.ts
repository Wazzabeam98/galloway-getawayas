import { isSealed, openSecret, sealSecret, type SecretPlace } from './secretBox';

// Seals every door code and wifi password still stored as plain text, and
// checks that every sealed one opens with this environment's key. Run by
// /api/cron/seal-listing-secrets, so it runs inside Vercel, where the key is —
// the production key exists nowhere else. Idempotent: a second run finds
// nothing to seal. Reports counts only; never a value.

type Tally = { rows: number; sealedNow: number; alreadySealed: number; wontOpen: number; changedUnderUs: number };
const blank = (): Tally => ({ rows: 0, sealedNow: 0, alreadySealed: 0, wontOpen: 0, changedUnderUs: 0 });

async function allRows(admin: any, table: string, cols: string, key: string): Promise<any[]> {
    const out: any[] = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await admin.from(table).select(cols).order(key).range(from, from + 999);
        if (error) throw new Error(`${table}: ${error.message}`);
        out.push(...(data || []));
        if (!data || data.length < 1000) return out;
    }
}

async function sealColumn(admin: any, table: SecretPlace['table'], key: string, column: string): Promise<Tally> {
    const t = blank();
    const rows = await allRows(admin, table, `${key}, ${column}`, key);
    for (const r of rows) {
        const value = r[column];
        if (value === null || value === undefined) continue;
        t.rows++;
        const place = { table, id: r[key] } as SecretPlace;
        if (isSealed(value)) {
            try { openSecret(value, place); t.alreadySealed++; } catch { t.wontOpen++; }
            continue;
        }
        // An empty wifi password means none: stored as null, like the editor does.
        const next = value === '' ? null : sealSecret(value, place);
        // Only if it is still the value we read — never overwrite a code a host
        // changed between our read and this write.
        const { data, error } = await admin.from(table).update({ [column]: next }).eq(key, r[key]).eq(column, value).select(key);
        if (error) throw new Error(`${table}: ${error.message}`);
        if (data && data.length) t.sealedNow++; else t.changedUnderUs++;
    }
    return t;
}

export async function sealListingSecrets(admin: any) {
    return {
        listingCodes: await sealColumn(admin, 'listing_access_codes', 'listing_id', 'code'),
        bookingCodes: await sealColumn(admin, 'booking_access_codes', 'booking_id', 'code'),
        wifiPasswords: await sealColumn(admin, 'listing_arrival', 'listing_id', 'wifi_password'),
    };
}
