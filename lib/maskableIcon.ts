// The Android maskable icon, drawn from the goose in app/icon.svg.
//
// Android crops a maskable icon to its own shape (circle, squircle, teardrop),
// keeping only a centred safe zone, so the goose has to sit well inside the
// tile: here it is scaled to MASKABLE_GOOSE_WIDTH of the tile's width and
// centred both ways, on a full-bleed square of the favicon's own dark green.
// The size comes from measuring the goose's real outline — the curves, not just
// their control points — so it stays right if the goose in app/icon.svg is
// ever redrawn. Pure: the route (app/icons/[file]) renders the result to PNG.
//
// Used ONLY for the manifest's purpose: "maskable" entry. The favicon, the
// "any" icons and the iPhone Home Screen icon are unchanged.

export const MASKABLE_GOOSE_WIDTH = 0.64;
const TILE = 512;

type Box = { minX: number; minY: number; maxX: number; maxY: number };

/** The exact bounds of a path made of absolute M, L, Q and Z commands. */
export function pathBox(d: string): Box {
    const tokens = String(d).match(/[MLQZmlqzA-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
    const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const add = (x: number, y: number) => {
        box.minX = Math.min(box.minX, x); box.maxX = Math.max(box.maxX, x);
        box.minY = Math.min(box.minY, y); box.maxY = Math.max(box.maxY, y);
    };
    let i = 0;
    let cmd = '';
    let x = 0, y = 0, sx = 0, sy = 0;
    const num = () => Number(tokens[i++]);
    while (i < tokens.length) {
        if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
        if (cmd === 'M' || cmd === 'L') {
            x = num(); y = num(); add(x, y);
            if (cmd === 'M') { sx = x; sy = y; cmd = 'L'; }
        } else if (cmd === 'Q') {
            const cx = num(), cy = num(), ex = num(), ey = num();
            add(ex, ey);
            // Where the curve turns: t = (p0 - p1) / (p0 - 2p1 + p2) on each axis.
            for (const [p0, p1, p2, axis] of [[x, cx, ex, 0], [y, cy, ey, 1]] as const) {
                const den = p0 - 2 * p1 + p2;
                if (den === 0) continue;
                const t = (p0 - p1) / den;
                if (t > 0 && t < 1) {
                    const v = (1 - t) * (1 - t) * p0 + 2 * (1 - t) * t * p1 + t * t * p2;
                    const tx = (1 - t) * (1 - t) * x + 2 * (1 - t) * t * cx + t * t * ex;
                    const ty = (1 - t) * (1 - t) * y + 2 * (1 - t) * t * cy + t * t * ey;
                    add(axis === 0 ? v : tx, axis === 1 ? v : ty);
                }
            }
            x = ex; y = ey;
        } else if (cmd === 'Z' || cmd === 'z') {
            x = sx; y = sy;
        } else {
            throw new Error('app/icon.svg uses a path command the maskable icon can’t measure: ' + cmd);
        }
    }
    return box;
}

/** The goose's paths and colour, out of app/icon.svg. */
export function gooseParts(iconSvg: string): { fill: string; background: string; paths: string[] } {
    const g = iconSvg.match(/<g\b[^>]*>([\s\S]*?)<\/g>/);
    if (!g) throw new Error('app/icon.svg has no <g> holding the goose');
    const fill = (g[0].match(/fill="([^"]+)"/) || [])[1] || '#34d399';
    const background = (iconSvg.match(/<rect\b[^>]*fill="([^"]+)"/) || [])[1] || '#022c22';
    const paths = Array.from(g[1].matchAll(/<path\b[^>]*\bd="([^"]+)"[^>]*\/?>/g), (m) => m[1]);
    if (paths.length === 0) throw new Error('app/icon.svg has no goose paths');
    return { fill, background, paths };
}

/** The maskable tile as SVG, with the transform that places the goose. */
export function maskableSvg(iconSvg: string): { svg: string; scale: number; tx: number; ty: number; box: Box } {
    const { fill, background, paths } = gooseParts(iconSvg);
    const boxes = paths.map(pathBox);
    const box: Box = {
        minX: Math.min(...boxes.map((b) => b.minX)),
        minY: Math.min(...boxes.map((b) => b.minY)),
        maxX: Math.max(...boxes.map((b) => b.maxX)),
        maxY: Math.max(...boxes.map((b) => b.maxY)),
    };
    const w = box.maxX - box.minX;
    const h = box.maxY - box.minY;
    const scale = (TILE * MASKABLE_GOOSE_WIDTH) / w;
    const tx = TILE / 2 - scale * (box.minX + w / 2);
    const ty = TILE / 2 - scale * (box.minY + h / 2);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + TILE + ' ' + TILE + '">'
        + '<rect width="' + TILE + '" height="' + TILE + '" fill="' + background + '"/>'
        + '<g transform="translate(' + tx.toFixed(3) + ' ' + ty.toFixed(3) + ') scale(' + scale.toFixed(5) + ')" fill="' + fill + '">'
        + paths.map((d) => '<path d="' + d + '"/>').join('')
        + '</g></svg>';
    return { svg, scale, tx, ty, box };
}
