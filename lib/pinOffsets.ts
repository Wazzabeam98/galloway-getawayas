// Fanning out search-map pins that share a spot (components/PriceMap).
//
// The map is fed the ~110m-rounded approx coords, never the exact pair, so two
// or three listings at one place (Hazel's three in Wanlockhead) land on
// identical or near-identical points and stack into what looks like a single
// pin. We give each pin a fixed PIXEL offset — not a geographic nudge — so the
// fan stays the same size on screen at every zoom.
//
// The look is a small fan of cards: each extra pin sits just above and beside
// the one before (~11px), so they still overlap but you can see there is more
// than one. The whole fan is centred on the true location, so a group never
// drifts off far enough to look like it is outside the town.

// How far apart (metres) two pins count as "the same spot".
const THRESHOLD_M = 150;

// Per-step shift of the card fan: a little to the right and a little up, ~11px
// apart. Small on purpose — the pins overlap like a hand of cards and stay
// close to their true point.
const STEP_X = 8;
const STEP_Y = -8;

function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const R = 6371000;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const midLat = (((a.lat + b.lat) / 2) * Math.PI) / 180;
    const x = dLng * Math.cos(midLat);
    return Math.sqrt(dLat * dLat + x * x) * R;
}

// A pin-id → [dx, dy] pixel-offset map. A pin that overlaps no one gets [0,0]
// and sits exactly on its point. Clustering compares each pin to a cluster's
// first member only (no transitive chaining), so a dense town can't collapse
// into one runaway fan.
export function computePinOffsets(
    pts: { id: string; lat: number; lng: number }[],
): Record<string, [number, number]> {
    const clusters: { rep: { lat: number; lng: number }; members: string[] }[] = [];
    for (const p of pts) {
        let placed = false;
        for (const c of clusters) {
            if (metresBetween(c.rep, p) <= THRESHOLD_M) {
                c.members.push(p.id);
                placed = true;
                break;
            }
        }
        if (!placed) clusters.push({ rep: { lat: p.lat, lng: p.lng }, members: [p.id] });
    }
    const out: Record<string, [number, number]> = {};
    for (const c of clusters) {
        const n = c.members.length;
        if (n === 1) {
            out[c.members[0]] = [0, 0];
            continue;
        }
        // A centred diagonal cascade. k runs symmetrically about 0 so the middle
        // of the stack sits on the true point; each step is one small shift up
        // and to the side. The last member lands top-right and is added to the
        // map last, so it is the card on top of the fan by default.
        c.members.forEach((id, i) => {
            const k = i - (n - 1) / 2;
            // `+ 0` normalises a -0 (from k === 0) to 0.
            out[id] = [Math.round(k * STEP_X) + 0, Math.round(k * STEP_Y) + 0];
        });
    }
    return out;
}
