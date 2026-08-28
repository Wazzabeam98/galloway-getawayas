// Bring the long-lived e2e preview branch up to master, and wait for it.
//
// WHY THERE IS A BRANCH AT ALL. The e2e suite signs people up, so it must not
// run against production — and on this project master has no non-production
// deployment to use instead: Vercel lists the git-master alias among the
// PRODUCTION aliases, so master's branch URL and the live site are the same
// deployment. There is therefore no preview of master to point at unless one is
// made deliberately. `e2e-preview` is that deployment, and nothing else.
//
// WHY IT NEEDS SYNCING. A branch off master is only master's code on the day it
// is cut. Left alone it rots, which is precisely how the suite ended up green
// against an eight-commit-old build of a merged feature branch. The guard in
// e2e/global-setup.ts makes that rot loud instead of silent; this script is the
// one-command answer to it, so the loud failure has somewhere to go.
//
// It never touches your working tree or your current branch: a commit object is
// built from master's tree with plumbing and pushed straight at the remote
// branch.
//
// WHY NOT JUST PUSH master's COMMIT AT THE BRANCH. Because Vercel will not
// build it. A commit SHA it has already deployed once — and every master commit
// has been deployed to production — produces no new deployment when it appears
// on another branch. Verified the hard way: the branch was created at master's
// SHA and Vercel built nothing at all for ten minutes.
//
// So the branch carries its own commit, with master's tree and master as its
// parent. Different SHA, so it builds; identical tree, so the code deployed is
// byte-for-byte master. The guard compares TREES for exactly this reason.
//
// Usage:
//   node scripts/e2e-sync.mjs            sync, then wait for the build
//   node scripts/e2e-sync.mjs --no-wait  sync and return immediately

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './seed-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const E2E_BRANCH = 'e2e-preview';

const env = loadEnv();
const TOKEN = env.VERCEL_TOKEN || process.env.VERCEL_TOKEN;
const link = JSON.parse(fs.readFileSync(path.join(ROOT, '.vercel', 'project.json'), 'utf8'));

const wait = !process.argv.includes('--no-wait');

function git(cmd, quiet = false) {
    return execSync(`git ${cmd}`, {
        cwd: ROOT,
        stdio: quiet ? ['ignore', 'pipe', 'ignore'] : ['ignore', 'pipe', 'inherit'],
    }).toString().trim();
}

async function vercel(pathname) {
    const sep = pathname.includes('?') ? '&' : '?';
    const res = await fetch(`https://api.vercel.com${pathname}${sep}teamId=${link.orgId}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error?.message || `vercel responded ${res.status}`);
    return body;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

git('fetch origin master --quiet', true);
const master = git('rev-parse origin/master', true);
const tree = git('rev-parse origin/master^{tree}', true);
console.log(`origin/master is ${master.slice(0, 7)} (tree ${tree.slice(0, 7)})`);

// Absent the first time, which is not an error: the branch is created below.
let head = null;
try {
    git(`fetch origin ${E2E_BRANCH} --quiet`, true);
    head = git(`rev-parse origin/${E2E_BRANCH}`, true);
} catch {
    head = null;
}

const currentTree = head ? git(`rev-parse ${head}^{tree}`, true) : null;
let target = head;

if (currentTree === tree) {
    console.log(`${E2E_BRANCH} already carries master's tree`);
} else {
    // master's tree, master as parent, its own SHA so that Vercel builds it.
    target = git(`commit-tree ${tree} -p ${master} -m "e2e-preview: master ${master.slice(0, 7)}"`, true);
    console.log(`pushing ${target.slice(0, 7)} — master's tree on ${E2E_BRANCH}...`);
    git(`push origin ${target}:refs/heads/${E2E_BRANCH} --force`);
}

if (!wait) process.exit(0);
if (!TOKEN) {
    console.log('VERCEL_TOKEN not set — pushed, but not waiting for the build.');
    process.exit(0);
}

console.log('waiting for the preview to build...');
const deadline = Date.now() + 10 * 60 * 1000;

while (Date.now() < deadline) {
    const list = (await vercel(`/v6/deployments?projectId=${link.projectId}&limit=40`)).deployments || [];
    const mine = list.filter(
        (d) => d.meta?.githubCommitRef === E2E_BRANCH && d.meta?.githubCommitSha === target
    );

    if (mine.length) {
        const state = mine[0].readyState || mine[0].state;
        if (state === 'READY') {
            console.log(`\nREADY — ${E2E_BRANCH} carries master ${master.slice(0, 7)}`);
            console.log(`  https://${mine[0].url}`);
            console.log('\nThe suite can run:  npm run test:e2e');
            process.exit(0);
        }
        if (state === 'ERROR' || state === 'CANCELED') {
            console.error(`\n${state} — the preview did not build. ${mine[0].inspectorUrl || ''}`);
            process.exit(1);
        }
        process.stdout.write(`  ${state}\r`);
    } else {
        process.stdout.write('  waiting for Vercel to pick up the push\r');
    }
    await sleep(5000);
}

console.error('\ntimed out after 10 minutes');
process.exit(1);
