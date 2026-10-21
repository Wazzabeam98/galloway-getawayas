// Fanning out search-map pins that share a spot (components/PriceMap).
//
// The map is fed the ~110m-rounded approx coords, never the exact pair, so two
// or three listings at one place (Hazel's three in Wanlockhead) land on
// identical or near-identical points and stack into what looks like a single
// pin. We give each pin a fixed PIXEL offset — not a geographic nudge — so the
// fan stays the same size on screen at every zoom, which is the whole point:
// the pins must still read as separate when the map is zoomed right out.

// How far apart (metres) two pins count as "the same spot".
const THRESHOLD_M = 150;

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
        // A ring, first pin at the top. The radius grows a little with the count
        // but stays small, so every pin is still clearly near its true location.
        const r = Math.min(44, 26 + (n - 1) * 7);
        c.members.forEach((id, i) => {
            const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
            out[id] = [Math.round(r * Math.cos(angle)), Math.round(r * Math.sin(angle))];
        });
    }
    return out;
}
