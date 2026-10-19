// The Android maskable icon: the same goose and colours as app/icon.svg, the
// goose at 64% of the tile's width and centred, drawn from the SVG at request
// time. The favicon and the iPhone icon are left exactly as they were.

import { test } from 'node:test';
import assert from 'node:assert/strict';

/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const { maskableSvg, pathBox, gooseParts, MASKABLE_GOOSE_WIDTH } = require('../lib/maskableIcon');

const ICON = fs.readFileSync(path.join(ROOT, 'app/icon.svg'), 'utf8');

test('the goose fills 64% of the tile’s width and sits dead centre', () => {
    const { scale, tx, ty, box } = maskableSvg(ICON);
    const left = tx + scale * box.minX, right = tx + scale * box.maxX;
    const top = ty + scale * box.minY, bottom = ty + scale * box.maxY;
    assert.equal(MASKABLE_GOOSE_WIDTH, 0.64);
    assert.ok(Math.abs((right - left) - 0.64 * 512) < 0.01, 'width ' + (right - left));
    assert.ok(Math.abs((left + right) / 2 - 256) < 0.01, 'centred across');
    assert.ok(Math.abs((top + bottom) / 2 - 256) < 0.01, 'centred down');
    assert.ok(top > 0 && bottom < 512, 'all of it on the tile');
});

test('the measured outline is the curve’s, not its control points’', () => {
    // Sample every curve densely and compare.
    for (const d of gooseParts(ICON).paths) {
        const nums = (d.match(/-?\d*\.?\d+/g) || []).map(Number);
        const box = pathBox(d);
        let x = nums[0], y = nums[1];
        let minX = x, maxX = x, minY = y, maxY = y;
        for (let i = 2; i + 3 < nums.length; i += 4) {
            const [cx, cy, ex, ey] = nums.slice(i, i + 4);
            for (let t = 0; t <= 1; t += 0.001) {
                const px = (1 - t) ** 2 * x + 2 * (1 - t) * t * cx + t * t * ex;
                const py = (1 - t) ** 2 * y + 2 * (1 - t) * t * cy + t * t * ey;
                minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
            }
            x = ex; y = ey;
        }
        for (const [a, b] of [[box.minX, minX], [box.maxX, maxX], [box.minY, minY], [box.maxY, maxY]]) {
            assert.ok(Math.abs(a - b) < 0.05, a + ' vs ' + b);
        }
    }
});

test('same goose, same colours, as the favicon', () => {
    const { svg } = maskableSvg(ICON);
    assert.match(svg, /fill="#022c22"/, 'the favicon’s dark green, full bleed');
    assert.match(svg, /fill="#34d399"/, 'the goose’s green');
    for (const d of gooseParts(ICON).paths) assert.ok(svg.includes(d), 'the goose’s own path, unchanged');
    assert.doesNotMatch(svg, /rx=/, 'square: Android does the cropping');
});

test('only the manifest’s maskable entry uses it; the favicon and iPhone icon are as they were', () => {
    const manifest = fs.readFileSync(path.join(ROOT, 'app/manifest.ts'), 'utf8');
    assert.match(manifest, /src: '\/icons\/maskable-512\.png'[^}]*purpose: 'maskable'/);
    assert.equal((manifest.match(/maskable-512/g) || []).length, 1);
    const route = fs.readFileSync(path.join(ROOT, 'app/icons/[file]/route.tsx'), 'utf8');
    assert.match(route, /'apple-touch-icon\.png': \{ size: 180, svg: full\(0\.9\) \}/, 'iPhone icon unchanged');
    assert.match(route, /'icon-512\.png': \{ size: 512, svg: \(source\) => source \}/, 'the "any" icons are the favicon itself');
    const layout = fs.readFileSync(path.join(ROOT, 'app/layout.tsx'), 'utf8');
    assert.doesNotMatch(layout, /maskable/, 'never offered to iOS');
});

test('no icon PNG is committed: every app icon is drawn from the SVG', () => {
    const { execSync } = require('child_process');
    const pngs = execSync('git ls-files "*.png" "*.PNG"', { cwd: ROOT }).toString().trim().split('\n')
        .filter((f: string) => /icon|maskable|apple-touch|badge/i.test(f));
    assert.deepEqual(pngs, []);
});
