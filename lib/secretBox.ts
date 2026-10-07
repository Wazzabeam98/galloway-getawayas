// The most sensitive things a host gives us — the door, lockbox, smart lock and
// keypad codes, and the wifi password — are encrypted in the app before they
// are stored, so a copy of the database (a backup, an export, someone with the
// service key reading rows) shows only ciphertext. They are decrypted only on
// the server, at the moment they are shown to the host in the editor or to a
// guest inside their arrival window, by the same routes that showed them
// before.
//
// AES-256-GCM. The key is LISTING_SECRETS_KEY (32 random bytes, base64), set
// only in Vercel's environment variables — never in the database, never
// NEXT_PUBLIC, so no browser can hold it. Production and the TEST database
// have different keys.
//
// Each value is sealed to its place: the table, column and row id go in as
// associated data, so a ciphertext copied onto another listing or booking will
// not open there.
//
// Stored form: "v1:" + base64url(iv 12 bytes | tag 16 bytes | ciphertext).
// A value without the prefix is a plain one written before encryption existed;
// it reads as itself until the hourly /api/cron/seal-listing-secrets (which
// runs inside Vercel, where the key is) seals it. LISTING_SECRETS_KEY_PREVIOUS, if set, is tried on open so a
// key can be rotated without a moment where old values won't read.
//
// Imports only node's crypto: a lib run by a unit test must not use '@/'.

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const PREFIX = 'v1:';

export type SecretPlace =
    | { table: 'listing_access_codes'; id: string }
    | { table: 'booking_access_codes'; id: string }
    | { table: 'listing_arrival'; id: string };

const COLUMN: Record<SecretPlace['table'], string> = {
    listing_access_codes: 'code',
    booking_access_codes: 'code',
    listing_arrival: 'wifi_password',
};

function aad(place: SecretPlace): Buffer {
    if (!place.id) throw new Error('secretBox: a sealed value needs its row id');
    return Buffer.from(`${place.table}.${COLUMN[place.table]}:${place.id}`, 'utf8');
}

function keyFrom(raw: string | undefined, name: string): Buffer | null {
    if (!raw) return null;
    const key = Buffer.from(raw.trim(), 'base64');
    if (key.length !== 32) throw new Error(`${name} must be 32 bytes, base64 encoded (openssl rand -base64 32)`);
    return key;
}

function currentKey(): Buffer {
    const key = keyFrom(process.env.LISTING_SECRETS_KEY, 'LISTING_SECRETS_KEY');
    if (!key) throw new Error('LISTING_SECRETS_KEY is not set, so codes and wifi passwords cannot be saved');
    return key;
}

export function isSealed(stored: string | null | undefined): boolean {
    return typeof stored === 'string' && stored.startsWith(PREFIX);
}

// Plain text in, the stored form out. Empty stays empty (the callers store
// "no code" as no row, and "no password" as null).
export function sealSecret(plain: string, place: SecretPlace): string {
    if (!plain) return plain;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', currentKey(), iv);
    cipher.setAAD(aad(place));
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url');
}

function openWith(key: Buffer, body: Buffer, place: SecretPlace): string {
    const decipher = createDecipheriv('aes-256-gcm', key, body.subarray(0, 12));
    decipher.setAAD(aad(place));
    decipher.setAuthTag(body.subarray(12, 28));
    return Buffer.concat([decipher.update(body.subarray(28)), decipher.final()]).toString('utf8');
}

// The stored form in, plain text out. A legacy plain value reads as itself.
// A sealed value that won't open (wrong key, wrong row, tampered) throws —
// never shown as gibberish, never silently treated as "no code".
export function openSecret(stored: string | null | undefined, place: SecretPlace): string | null {
    if (stored === null || stored === undefined) return null;
    if (!isSealed(stored)) return stored;
    const body = Buffer.from(stored.slice(PREFIX.length), 'base64url');
    if (body.length < 29) throw new Error('secretBox: sealed value is too short');
    const keys = [currentKey(), keyFrom(process.env.LISTING_SECRETS_KEY_PREVIOUS, 'LISTING_SECRETS_KEY_PREVIOUS')].filter(Boolean) as Buffer[];
    let last: unknown;
    for (const key of keys) {
        try { return openWith(key, body, place); } catch (err) { last = err; }
    }
    throw new Error('secretBox: could not open a sealed value (' + ((last as Error)?.message || 'unknown') + ')');
}
