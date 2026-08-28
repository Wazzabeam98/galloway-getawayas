// What is actually live on Vercel, and whether it is what you are looking at.
//
// Read-only. It issues GETs and nothing else: it cannot deploy, promote,
// roll back or delete. Safe to run at any point, including mid-deploy.
//
// The question this exists to answer is "am I looking at the newest build?",
// which is really three questions, and the guessing happens because they get
// run together:
//
//   WHAT IS LIVE      which commit is the production alias serving right now
//   WHAT IS BUILT     has the commit I just pushed finished, failed, or is it
//                     still going
//   WHAT AM I SEEING  the tab that is open may be a preview, a stale branch
//                     alias, or a deployment that has since been superseded
//
// A green Vercel dashboard answers the second and is routinely mistaken for the
// first. A page that looks wrong is usually the third.
//
// Usage:
//   node scripts/check-deploy.mjs                  production vs your working copy
//   node scripts/check-deploy.mjs --url <host>     what is THAT tab serving
//   node scripts/check-deploy.mjs --branch <name>  latest build of a branch
//   node scripts/check-deploy.mjs --list           recent deployments
//   node scripts/check-deploy.mjs --watch          re-check every 10s
//
// VERCEL_TOKEN comes from .env.local. Without it the script says so and stops,
// rather than half-answering.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './seed-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = loadEnv();

const TOKEN = env.VERCEL_TOKEN || process.env.VERCEL_TOKEN;
if (!TOKEN) {
    console.error('VERCEL_TOKEN is not set in .env.local — see scripts/README.md');
    process.exit(1);
}

// Project and team come from .vercel/project.json, which the CLI wrote when the
// project was linked. Reading it rather than hardcoding means this keeps
// working if the project is ever relinked.
const link = JSON.parse(fs.readFileSync(path.join(ROOT, '.vercel', 'project.json'), 'utf8'));
const { projectId, orgId } = link;

const args = process.argv.slice(2);
const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
};
const watch = args.includes('--watch');

async function api(pathname) {
    const sep = pathname.includes('?') ? '&' : '?';
    const res = await fetch(`https://api.vercel.com${pathname}${sep}teamId=${orgId}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const body = await res.json();
    if (!res.ok) {
        throw new Error(body?.error?.message || `vercel responded ${res.status}`);
    }
    return body;
}

function ago(ms) {
    if (!ms) return 'unknown';
    const secs = Math.round((Date.now() - ms) / 1000);
    if (secs < 60) return `${secs}s ago`;
    if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
    return `${Math.round(secs / 86400)}d ago`;
}

// Vercel's readyState in the terms somebody actually asks in. BUILDING and
// QUEUED matter most: they are the states where the alias is still serving the
// PREVIOUS build, which is the single commonest reason a change "did not go
// out" when it in fact had not gone out yet.
const STATE = {
    READY: 'READY — this is what visitors get',
    BUILDING: 'BUILDING — not live yet, the alias still serves the previous build',
    QUEUED: 'QUEUED — has not started building; the previous build is still live',
    INITIALIZING: 'INITIALIZING — not live yet',
    ERROR: 'FAILED — it did not build, so the previous build is still live',
    CANCELED: 'CANCELLED — never finished, the previous build is still live',
};
const say = (s) => STATE[s] || s;

const shortSha = (s) => (s || '').slice(0, 7) || '-';
const firstLine = (s) => String(s || '').split('\n')[0];

function git(cmd) {
    try {
        return execSync(`git ${cmd}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
            .toString().trim();
    } catch {
        return null;
    }
}

/** Print one deployment in the same shape everywhere it appears. */
function describe(d, indent = '  ') {
    const m = d.meta || {};
    const created = d.created || d.createdAt;
    console.log(`${indent}${say(d.readyState || d.state)}`);
    console.log(`${indent}    ${shortSha(m.githubCommitSha)} ${m.githubCommitRef || '-'}  "${firstLine(m.githubCommitMessage)}"`);
    console.log(`${indent}    ${d.target || 'preview'}  |  built ${ago(created)}  |  ${d.url}`);
    if (d.inspectorUrl) console.log(`${indent}    ${d.inspectorUrl}`);
}

/**
 * How your working copy stands against a deployed commit.
 *
 * This is the part that turns "the dashboard is green" into "the green thing is
 * mine". A build can be READY and still not contain what you are testing,
 * because it was made from an earlier commit — or because what you are testing
 * was never committed at all, which no amount of looking at Vercel will reveal.
 */
function compareWorkingCopy(deployedSha) {
    const branch = git('rev-parse --abbrev-ref HEAD');
    const head = git('rev-parse HEAD');
    const dirty = git('status --porcelain');

    console.log('\n=== YOUR WORKING COPY ===');
    if (!head) {
        console.log('  not a git checkout — nothing to compare');
        return;
    }
    console.log(`  ${branch} @ ${shortSha(head)}`);

    if (!deployedSha) {
        console.log('  the live build carries no commit — cannot compare');
    } else if (head === deployedSha) {
        console.log('  MATCHES the live build — the deployed code is your commit');
    } else {
        // rev-list needs both commits present locally. After a fetch they will
        // be; on a fresh clone or an unfetched branch they may not, and saying
        // "cannot tell" is better than implying a direction.
        const known = git(`cat-file -e ${deployedSha}^{commit} && echo ok`) !== null;
        if (!known) {
            console.log(`  DIFFERENT from the live build (${shortSha(deployedSha)}), which is not in this checkout`);
            console.log('  run `git fetch` to compare them');
        } else {
            const ahead = git(`rev-list --count ${deployedSha}..HEAD`);
            const behind = git(`rev-list --count HEAD..${deployedSha}`);
            console.log(`  DIFFERENT from the live build (${shortSha(deployedSha)})`);
            if (ahead && ahead !== '0') console.log(`    you are ${ahead} commit(s) AHEAD — that work is not deployed`);
            if (behind && behind !== '0') console.log(`    you are ${behind} commit(s) BEHIND — the live build has work you do not`);
        }
    }

    if (dirty) {
        const n = dirty.split('\n').filter(Boolean).length;
        console.log(`  ${n} uncommitted file(s) — on no server anywhere, deployed or not`);
    }
}

async function production() {
    const project = await api(`/v9/projects/${projectId}`);
    const live = project.targets?.production;
    const aliases = live?.alias || project.alias || [];

    console.log('=== PRODUCTION ===');
    if (!live) {
        console.log('  no production deployment');
        return null;
    }
    describe(live);
    if (aliases.length) {
        console.log('  reached at:');
        for (const a of aliases) console.log(`      https://${a}`);
    }

    // A build can be READY while an OLDER one is still the one the alias
    // serves, because promotion is a separate step from building. Worth saying
    // out loud rather than leaving the reader to assume newest == live.
    const recent = (await api(`/v6/deployments?projectId=${projectId}&target=production&limit=5`)).deployments || [];
    const newer = recent.filter((d) => (d.created || 0) > (live.createdAt || live.created || 0));
    if (newer.length) {
        console.log(`\n  NOTE: ${newer.length} newer production build(s) exist but are not the live one:`);
        for (const d of newer) describe(d, '    ');
    }

    return live.meta?.githubCommitSha || null;
}

async function byUrl(host) {
    const clean = host.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    console.log(`=== ${clean} ===`);
    let d;
    try {
        d = await api(`/v13/deployments/${encodeURIComponent(clean)}`);
    } catch (err) {
        console.log(`  could not resolve: ${err.message}`);
        console.log('  (an alias for a deleted branch keeps resolving in DNS but has no deployment)');
        return;
    }
    describe(d);

    // The point of this mode: not "does it work" but "is it current". A branch
    // alias keeps serving the last build of that branch forever, including
    // after the branch is merged and deleted — so it can be green, correct for
    // what it is, and months behind master.
    const sha = d.meta?.githubCommitSha;
    const master = git('rev-parse origin/master') || git('rev-parse master');
    if (sha && master) {
        if (sha === master) {
            console.log('\n  this IS the tip of master');
        } else if (git(`cat-file -e ${sha}^{commit} && echo ok`) !== null) {
            const behind = git(`rev-list --count ${sha}..${master}`);
            if (behind && behind !== '0') {
                console.log(`\n  STALE: ${behind} commit(s) behind master. What you are looking at is not the newest code.`);
            } else {
                console.log('\n  not master, but not behind it either');
            }
        }
    }
}

async function branch(name) {
    const list = (await api(`/v6/deployments?projectId=${projectId}&limit=100`)).deployments || [];
    const mine = list.filter((d) => d.meta?.githubCommitRef === name);
    console.log(`=== BRANCH ${name} ===`);
    if (!mine.length) {
        console.log('  no deployments for that branch in the last 100');
        return;
    }
    describe(mine[0]);
    if (mine.length > 1) console.log(`\n  (${mine.length - 1} older build(s) of this branch)`);
}

async function list() {
    const d = (await api(`/v6/deployments?projectId=${projectId}&limit=15`)).deployments || [];
    console.log('=== RECENT DEPLOYMENTS ===');
    for (const x of d) {
        const m = x.meta || {};
        const state = (x.readyState || x.state || '').padEnd(9);
        const target = (x.target || 'preview').padEnd(10);
        console.log(`  ${state} ${target} ${shortSha(m.githubCommitSha)} ${(m.githubCommitRef || '-').padEnd(22)} ${ago(x.created)}`);
    }
}

async function report() {
    const url = flag('--url');
    const br = flag('--branch');
    if (url) return byUrl(url);
    if (br) return branch(br);
    if (args.includes('--list')) return list();
    const sha = await production();
    compareWorkingCopy(sha);
}

await report().catch((e) => { console.error(e.message); process.exit(1); });
if (watch) {
    setInterval(() => {
        console.log('\n--- recheck ---');
        report().catch((e) => console.error(e.message));
    }, 10_000);
}
