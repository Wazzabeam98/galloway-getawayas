// The scripts' copy of lib/secretBox.ts (seeds and proofs write door codes and
// wifi passwords straight to TEST, so they must seal them the same way). Same
// format, same associated data; tests/secret-box.test.ts proves each opens the
// other's output, so the two cannot drift apart.
const { createCipheriv, createDecipheriv, randomBytes } = require('crypto');

const PREFIX = 'v1:';
const COLUMN = { listing_access_codes: 'code', booking_access_codes: 'code', listing_arrival: 'wifi_password' };

function key(env) {
    const raw = (env || process.env).LISTING_SECRETS_KEY;
    const k = raw ? Buffer.from(String(raw).trim(), 'base64') : null;
    if (!k || k.length !== 32) throw new Error('LISTING_SECRETS_KEY (32 bytes, base64) is needed to seal a code or wifi password');
    return k;
}
const aad = (table, id) => Buffer.from(`${table}.${COLUMN[table]}:${id}`, 'utf8');

function sealSecret(plain, table, id, env) {
    if (!plain) return plain;
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', key(env), iv);
    c.setAAD(aad(table, id));
    const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
    return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}

function openSecret(stored, table, id, env) {
    if (stored == null || !String(stored).startsWith(PREFIX)) return stored;
    const b = Buffer.from(String(stored).slice(PREFIX.length), 'base64url');
    const d = createDecipheriv('aes-256-gcm', key(env), b.subarray(0, 12));
    d.setAAD(aad(table, id));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

module.exports = { sealSecret, openSecret };
