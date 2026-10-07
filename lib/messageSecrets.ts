// Check-in messages are stored with the door code and wifi password as
// placeholders, never the values, so a copy of the messages table shows no
// code. They are filled in on the server only when the message is shown, to
// the people who may see the code then: the host, or the guest inside their
// arrival window — the same gate as the arrival screen.
//
// Only messages the system sent (automated = true) are ever filled in. A
// message a person typed — even one that looks like it holds a placeholder —
// is shown exactly as typed, and a code typed into a chat by hand is left as
// it is.
//
// Imports nothing: a lib run by a unit test must not use '@/'.

export const DOOR_TOKEN = '{{gg.door_code}}';
export const WIFI_TOKEN = '{{gg.wifi_password}}';

export function hasSecretTokens(body: string | null | undefined): boolean {
    const b = String(body || '');
    return b.includes(DOOR_TOKEN) || b.includes(WIFI_TOKEN);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// For a system message about to be stored (or one stored before this): every
// copy of the stay's door code(s) and wifi password becomes its placeholder —
// including one a host typed into their template's text. Only whole values
// (not inside a longer word or number) and only four characters or more, so
// a short value can't swallow part of a date or a time.
export function tokeniseSecrets(body: string, values: { codes?: (string | null | undefined)[]; wifi?: string | null }): string {
    const swaps: [string, string][] = [];
    for (const c of values.codes || []) if (c && c.trim().length >= 4) swaps.push([c.trim(), DOOR_TOKEN]);
    if (values.wifi && values.wifi.trim().length >= 4) swaps.push([values.wifi.trim(), WIFI_TOKEN]);
    // Longest first, so a value inside another is never half-replaced.
    swaps.sort((a, b) => b[0].length - a[0].length);
    let out = String(body);
    for (const [value, token] of swaps) {
        out = out.replace(new RegExp(`(?<![A-Za-z0-9])${escape(value)}(?![A-Za-z0-9])`, 'g'), token);
    }
    return out;
}

// What the viewer gets in place of each placeholder.
//   { doorCode, wifiPassword }  — they may see them now (null = none set)
//   'before' / 'after'          — a guest outside the arrival window
//   'preview'                   — the inbox list's one-line preview
export type SecretView =
    | { doorCode: string | null; wifiPassword: string | null }
    | 'before' | 'after' | 'preview';

const WORDS: Record<'before' | 'after' | 'preview', { door: string; wifi: string }> = {
    before: { door: '[shown here 3 days before you arrive]', wifi: '[shown here 3 days before you arrive]' },
    after: { door: '[no longer shown]', wifi: '[no longer shown]' },
    preview: { door: '[door code]', wifi: '[wifi password]' },
};

export function renderSecretTokens(body: string, automated: boolean | null | undefined, view: SecretView): string {
    if (!automated || !hasSecretTokens(body)) return body;
    const door = typeof view === 'string' ? WORDS[view].door : (view.doorCode || '[no door code set]');
    const wifi = typeof view === 'string' ? WORDS[view].wifi : (view.wifiPassword || '[no wifi password set]');
    return String(body).split(DOOR_TOKEN).join(door).split(WIFI_TOKEN).join(wifi);
}
