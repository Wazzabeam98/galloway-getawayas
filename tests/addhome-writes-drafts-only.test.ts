// The approval gate, browser half: the listing wizard may create a DRAFT and
// may never write any other status. The database refuses it anyway (trigger
// listings_status_authority, 20260829020000); this keeps the wizard from ever
// trying — autosave included — so a host never sees that refusal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(path.resolve(__dirname, '..', '..', 'app', 'addhome', 'page.tsx'), 'utf8');

test('the wizard writes no status but draft', () => {
    const statuses = Array.from(SRC.matchAll(/status:\s*'([a-z_]+)'/g)).map((m) => m[1]);
    assert.ok(statuses.length > 0, 'the draft insert names its status');
    assert.deepEqual(Array.from(new Set(statuses)), ['draft']);
});

test('submitting goes through the server', () => {
    assert.match(SRC, /\/api\/listings\/publish/);
});
