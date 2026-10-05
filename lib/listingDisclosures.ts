// Airbnb's guest-safety disclosures and checkout instructions — the two
// "pick what applies, add a note" lists on a listing. Stored as jsonb arrays of
// { key, note } on listings.safety_disclosures and
// listings.checkout_instructions (20261005160000).
//
// Framework-free on purpose: the editor (client), /api/listings/save (server)
// and the listing page all import it, so the one list of keys and the one set
// of rules are shared — the editor's check and the server's check are the same
// function (cleanItems + itemProblems), never two copies that can drift.

export type ListingItem = { key: string; note: string };

export type ItemDef = {
    key: string;
    label: string;
    hint?: string;
    // A note the host must write before the item can be saved. Airbnb insists
    // on it for cameras (where they are, what they cover) — a guest is owed
    // that, not just "there are cameras".
    noteRequired?: string;
};

// Smoke and carbon-monoxide alarms are not here: they stay in `amenities`,
// where the search filters and the listing page already read them. The editor
// shows them in the same Guest safety section as these.
export const SAFETY_DISCLOSURES: ItemDef[] = [
    {
        key: 'security_cameras',
        label: 'Exterior security cameras',
        hint: 'Cameras that cover outdoor areas. Cameras inside the home are not allowed.',
        noteRequired: 'Say where the security cameras are and what they cover.',
    },
    {
        key: 'noise_monitor',
        label: 'Noise decibel monitor',
        hint: 'A device that measures how loud it is without recording sound.',
    },
    {
        key: 'nearby_water',
        label: 'Nearby lake, river or other water',
        hint: 'The sea, a river, a burn or a pond guests could reach on foot.',
    },
    {
        key: 'heights',
        label: 'Heights without rails or protection',
        hint: 'A steep stair, a mezzanine, a balcony or a drop with no rail.',
    },
    {
        key: 'dangerous_animals',
        label: 'Potentially dangerous animals on the property',
        hint: 'Livestock, a working dog, bulls in the next field.',
    },
    {
        key: 'pool_no_gate',
        label: 'Pool or hot tub without a gate or lock',
    },
    {
        key: 'climbing_structure',
        label: 'Climbing or play structure',
    },
];

export const CHECKOUT_INSTRUCTIONS: ItemDef[] = [
    { key: 'towels', label: 'Gather used towels' },
    { key: 'rubbish', label: 'Throw rubbish away' },
    { key: 'turn_off', label: 'Turn things off' },
    { key: 'lock_up', label: 'Lock up' },
    { key: 'return_keys', label: 'Return keys' },
    {
        key: 'other',
        label: 'Additional requests',
        noteRequired: 'Write what else you need guests to do before they leave.',
    },
];

export const NOTE_MAX = 300;

export function labelFor(defs: ItemDef[], key: string): string {
    const found = defs.filter((d) => d.key === key)[0];
    return found ? found.label : '';
}

// jsonb comes back as `any`, and a request body can say anything. This is the
// one gate that turns either into a clean list: known keys only, each once, in
// the catalogue's order, notes trimmed and capped. Never throws.
export function cleanItems(raw: any, defs: ItemDef[]): ListingItem[] {
    if (!Array.isArray(raw)) return [];
    const byKey: Record<string, string> = {};
    for (const r of raw) {
        if (!r || typeof r !== 'object' || typeof r.key !== 'string') continue;
        if (!defs.some((d) => d.key === r.key)) continue;
        if (r.key in byKey) continue;
        byKey[r.key] = typeof r.note === 'string' ? r.note.trim().slice(0, NOTE_MAX) : '';
    }
    return defs.filter((d) => d.key in byKey).map((d) => ({ key: d.key, note: byKey[d.key] }));
}

// What would stop this list being saved — today, only a required note left
// blank. Checked by the editor before it sends and by the save route after.
export function itemProblems(items: ListingItem[], defs: ItemDef[]): string[] {
    const out: string[] = [];
    for (const item of items) {
        const def = defs.filter((d) => d.key === item.key)[0];
        if (def && def.noteRequired && !item.note.trim()) out.push(def.noteRequired);
    }
    return out;
}
