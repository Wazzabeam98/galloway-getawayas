// The company's legal details live in config/company.ts and nowhere else.
//
// Every place that shows them — email footers, site footers, /terms, /privacy,
// /contact, the provider terms — reads that file. This guard fails the moment
// somebody pastes the number or the registered office in by hand, because a
// pasted copy is the one that gets missed when the details change.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { installAliases, stubModule } from './helpers/stub';

installAliases();

const ROOT = path.resolve(__dirname, '..', '..');
const SCANNED = ['app', 'components', 'lib', 'config'];
const HOME = path.join('config', 'company.ts');

function files(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...files(rel));
        else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel);
    }
    return out;
}

test('the company number and registered office are written only in config/company.ts', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { COMPANY } = require('../config/company');
    const needles = [COMPANY.number, COMPANY.registeredOffice[0]];
    const offenders: string[] = [];
    for (const dir of SCANNED) {
        for (const rel of files(dir)) {
            if (rel === HOME) continue;
            const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
            for (const n of needles) if (text.includes(n)) offenders.push(`${rel}: "${n}"`);
        }
    }
    assert.deepEqual(offenders, [], 'import from config/company instead:\n' + offenders.join('\n'));
});

test('every email footer carries the name, number and registered office', () => {
    stubModule('@/lib/logError', { logError: async () => {} });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { emailLayout } = require('../lib/email');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { COMPANY, REGISTERED_OFFICE } = require('../config/company');
    const html: string = emailLayout('<p>Hello</p>', 'footnote');
    assert.ok(html.includes(COMPANY.name));
    assert.ok(html.includes('Company number ' + COMPANY.number));
    assert.ok(html.includes(REGISTERED_OFFICE));
    assert.doesNotMatch(html, /to be confirmed/i);
});
