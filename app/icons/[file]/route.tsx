// The app's PNG icons, drawn on request from the goose in app/icon.svg.
//
// No raster image is committed to this repo (CLAUDE.md), and phones need PNGs
// for the Home Screen, the install sheet and the notification badge — so they
// are rendered here from the one SVG the favicon already uses, and the CDN
// keeps them. Change the goose in app/icon.svg and every icon follows.
//
//   icon-192.png, icon-512.png   the favicon as it is, rounded square
//   maskable-512.png             full-bleed, goose inside Android's safe circle
//   apple-touch-icon.png         180px, full-bleed (iOS rounds the corners)
//   badge-96.png                 white goose on transparent, for the status bar

import { ImageResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export const runtime = 'nodejs';

const BG = '#022c22';

type Variant = { size: number; svg: (source: string, goose: string) => string };

function full(scale: number) {
    return (_source: string, goose: string) =>
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
        + '<rect width="512" height="512" fill="' + BG + '"/>'
        + '<g transform="translate(256 256) scale(' + scale + ') translate(-256 -256)">' + goose + '</g>'
        + '</svg>';
}

const VARIANTS: Record<string, Variant> = {
    'icon-192.png': { size: 192, svg: (source) => source },
    'icon-512.png': { size: 512, svg: (source) => source },
    'maskable-512.png': { size: 512, svg: full(0.78) },
    'apple-touch-icon.png': { size: 180, svg: full(0.9) },
    'badge-96.png': {
        size: 96,
        svg: (_source, goose) =>
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
            + '<g transform="translate(256 256) scale(1.15) translate(-256 -256)">'
            + goose.replace(/fill="[^"]*"/g, 'fill="#ffffff"')
            + '</g></svg>',
    },
};

let cached: { source: string; goose: string } | null = null;

function goose() {
    if (cached) return cached;
    const source = readFileSync(join(process.cwd(), 'app', 'icon.svg'), 'utf8');
    const match = source.match(/<g[\s\S]*<\/g>/);
    if (!match) throw new Error('app/icon.svg has no <g> holding the goose');
    cached = { source, goose: match[0] };
    return cached;
}

export async function GET(_request: Request, { params }: { params: { file: string } }) {
    const variant = VARIANTS[params.file];
    if (!variant) return new Response('Not found', { status: 404 });

    const { source, goose: g } = goose();
    const svg = variant.svg(source, g);
    const src = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');

    const image = new ImageResponse(
        (
            // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
            <img src={src} width={variant.size} height={variant.size} />
        ),
        { width: variant.size, height: variant.size },
    );

    const body = await image.arrayBuffer();
    return new Response(body, {
        headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400',
        },
    });
}
