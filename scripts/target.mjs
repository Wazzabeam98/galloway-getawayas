// The only place in this repo that decides what a runner is pointed at.
//
// WHY THIS EXISTS, AND WHY IT IS A MODULE RATHER THAN A PARAGRAPH IN ONE FILE.
//
// On 28 August 2026 the Playwright suite was given a guard: ask the deployment
// what it is, and refuse to run against production, against the production
// database, or against a build behind master. It was written because the suite
// had been green for days against code eight commits old.
//
// The guard went onto that one suite. `scripts/journeys.mjs` sat in the same
// folder doing the same dangerous thing — creating accounts, writing rows —
// with its target hardcoded to a feature-branch preview that had since been
// merged. Its 27 checks were passing against a build FIFTEEN commits behind
// master, on a deployment so old it did not even have the /api/health route
// the guard reads. Same fault, same week, one folder apart.
//
// So the fix is not "add the guard to journeys.mjs too". It is to make a
// target something you cannot obtain without being checked. Every runner asks
// this module, this module is the only file allowed to contain a site URL, and
// `tests/runner-targets.test.ts` fails the build if either rule is broken.
//
// The three refusals, and why they are the three:
//
//   PRODUCTION   these runners create auth accounts and lodge applications.
//                Against the live site that is invented tradesmen in the real
//                review queue. No override, at any time, for any reason.
//   WRONG DB     a preview whose environment points at the production Supabase
//                project. Looks like a preview, writes like production. This
//                is the check a URL can never make, and this project has
//                already shipped an env var scoped to the wrong target once.
//   STALE        a build behind master. This is the failure that actually
//                happened, twice.
//
// The first two are absolute. Staleness takes ALLOW_STALE=1, per run, because
// there are honest reasons to test an older build — but it is never the
// default and it says so loudly on the way past.

import { execSync } from 'node:child_process';
import { TEST_PROJECT_REF } from './seed-lib.mjs';

export { TEST_PROJECT_REF };

// ---------------------------------------------------------------------------
// The only site URLs in the repo. Everything else asks for them by name.
// ---------------------------------------------------------------------------

/**
 * The long-lived preview branch that exists only to be deployed, kept at
 * master by `npm run e2e:sync`. It is backed by the test Supabase project,
 * which is where invented tradesmen belong.
 *
 * It is deliberately NOT master's own branch URL: Vercel lists
 * galloway-getawayas-git-master-… among the PRODUCTION aliases, so master's
 * branch URL and the live site are one deployment. There is no preview of
 * master to point at.
 */
export const PREVIEW_URL =
    'https://galloway-getawayas-git-e2e-preview-wazzabeam98s-projects.vercel.app';

/** A local `npm run dev`. Still health-checked — a dev server can be pointed at production. */
export const LOCAL_URL = 'http://localhost:3000';

const RULE = '='.repeat(74);

function git(cmd) {
    try {
        return execSync(`git ${cmd}`, {
            cwd: new URL('..', import.meta.url).pathname,
            stdio: ['ignore', 'pipe', 'ignore'],
        }).toString().trim();
    } catch {
        return null;
    }
}

/** Thrown rather than exited, so Playwright's globalSetup reports it properly. */
export class RefusedError extends Error {}

function refuse(title, lines) {
    throw new RefusedError(
        ['', RULE, `REFUSING TO RUN — ${title}`, RULE, ...lines, RULE, ''].join('\n')
    );
}

function warn(lines) {
    console.warn(['', RULE, ...lines, RULE, ''].join('\n'));
}

// ---------------------------------------------------------------------------
// Picking a target
// ---------------------------------------------------------------------------

/**
 * Where a runner should point, before it is checked.
 *
 * Order: an explicit `--host` on the command line, then any of the named
 * environment variables, then the fallback the runner asked for.
 *
 * Runners must not read SITE_URL / BASE_URL / HOST themselves — the
 * enforcement test fails them for it. Name the variable here instead.
 */
export function chooseTarget({ argv = process.argv, env = process.env, envNames = [], fallback = LOCAL_URL } = {}) {
    const args = argv.slice(2);
    const i = args.indexOf('--host');
    if (i >= 0 && args[i + 1]) return args[i + 1].replace(/\/+$/, '');

    for (const name of envNames) {
        if (env[name]) return String(env[name]).replace(/\/+$/, '');
    }

    return fallback;
}

// ---------------------------------------------------------------------------
// Checking it
// ---------------------------------------------------------------------------

/**
 * Ask the deployment what it is, and refuse if it is the wrong thing.
 *
 * Returns the health payload on success so a caller can print it. Throws
 * RefusedError otherwise — nothing here exits the process, because a runner
 * and Playwright want to report a refusal differently.
 */
export async function assertSafeTarget(baseURL, { runner = 'this runner', env = process.env, quiet = false } = {}) {
    if (!baseURL) {
        refuse('no target', [`${runner} was given nothing to point at.`]);
    }

    if (!quiet) {
        console.log(`\n  checking what ${baseURL} actually is before writing to it...`);
    }

    let res;
    try {
        res = await fetch(`${baseURL}/api/health`, { cache: 'no-store' });
    } catch (err) {
        refuse('the target is unreachable', [
            `${baseURL}/api/health could not be fetched.`,
            `  ${err && err.message}`,
            '',
            'A local run needs `npm run dev` up.',
            'If the branch preview was deleted, recreate it:  npm run e2e:sync',
        ]);
    }

    if (res.status === 404) {
        // Not a missing feature — a dated build. The route ships alongside this
        // guard, so a deployment without it is necessarily older than both.
        refuse('the target predates this guard', [
            `${baseURL} has no /api/health.`,
            '',
            'That route ships with this guard, so a build without it is older',
            'than the guard itself and cannot be checked. It is stale by',
            'definition — this is exactly how journeys.mjs came to be green',
            'against a build fifteen commits old.',
            '',
            'Bring the preview up to date:  npm run e2e:sync',
        ]);
    }

    if (!res.ok) {
        refuse('the target answered badly', [`${baseURL}/api/health responded ${res.status}.`]);
    }

    let health;
    try {
        health = await res.json();
    } catch {
        refuse('the target answered badly', [
            `${baseURL}/api/health did not return JSON.`,
            'A Vercel login wall will do this — check the deployment is public.',
        ]);
    }

    // 1. Never production. No override.
    if (health.env === 'production') {
        refuse('that is PRODUCTION', [
            `${baseURL} is the live site.`,
            '',
            `${runner} creates accounts and writes rows. Against production that`,
            'means invented people in the real queue and real rows in the real',
            'database.',
            '',
            'There is no flag to allow this. Point it at the preview branch:',
            '  npm run e2e:sync     (bring the preview up to date and deploy it)',
        ]);
    }

    // 2. Never the production database, whatever the deployment calls itself.
    if (!health.supabase) {
        refuse('the target would not say which database it uses', [
            `${baseURL} returned no Supabase project.`,
            'Refusing rather than assuming: a guard that cannot read the answer',
            'must not pass the check.',
        ]);
    }

    if (health.supabase !== TEST_PROJECT_REF) {
        refuse('that is the WRONG DATABASE', [
            `${baseURL} says env=${health.env}, but it is writing to Supabase`,
            `project "${health.supabase}".`,
            '',
            `Expected the test project "${TEST_PROJECT_REF}".`,
            '',
            'A deployment pointed at the production database is production for',
            'every purpose these runners care about. Fix the environment',
            'variables before running this again.',
        ]);
    }

    // 3. Not behind master.
    const deployed = health.commit || null;
    if (!deployed) {
        warn([
            'NOTE: the target reports no commit, so staleness cannot be checked.',
            'This is normal for a local dev server and suspicious for anything else.',
        ]);
    } else {
        git('fetch origin master --quiet');
        if (health.branch) git(`fetch origin ${health.branch} --quiet`);

        // TREES, not commit SHAs. The e2e preview cannot carry master's own
        // commit — Vercel will not build a SHA it has already deployed, and
        // every master commit has been deployed to production — so
        // scripts/e2e-sync.mjs gives the branch its own commit holding
        // master's tree. Comparing trees is also the better question: "is the
        // deployed code the same code as master" stays true however the branch
        // was built.
        const masterTree = git("rev-parse 'origin/master^{tree}'");
        const headTree = git("rev-parse 'HEAD^{tree}'");
        const known = git(`cat-file -e '${deployed}^{commit}' && echo ok`) !== null;
        const deployedTree = known ? git(`rev-parse '${deployed}^{tree}'`) : null;
        const allowStale = env.ALLOW_STALE === '1' || env.PLAYWRIGHT_ALLOW_STALE === '1';

        const current = !!deployedTree
            && (deployedTree === masterTree || deployedTree === headTree);

        if (!current) {
            const behind = known ? git(`rev-list --count ${deployed}..origin/master`) : null;
            const detail = !known
                ? [`The deployed commit ${deployed.slice(0, 7)} is not in this checkout.`,
                   'Run `git fetch` and try again.']
                : behind && behind !== '0'
                  ? [`The deployed build is ${behind} commit(s) BEHIND origin/master.`,
                     `  deployed  ${deployed.slice(0, 7)}  (${health.branch || 'unknown branch'})`,
                     `  tree      ${(deployedTree || '?').slice(0, 7)}`,
                     `  master    ${(masterTree || '?').slice(0, 7)}`]
                  : ['The deployed build carries a different tree from both',
                     'origin/master and your working copy.',
                     `  deployed  ${(deployedTree || '?').slice(0, 7)}`,
                     `  master    ${(masterTree || '?').slice(0, 7)}`];

            if (allowStale) {
                warn(['RUNNING AGAINST A STALE BUILD — because ALLOW_STALE=1.',
                      ...detail,
                      'A pass here is evidence about that build, not about master.']);
            } else {
                refuse('the target is STALE', [
                    ...detail,
                    '',
                    'This is the exact failure the guard exists for: a green run',
                    'against code that is not the code you think you are testing.',
                    '',
                    'Bring the preview up to date:  npm run e2e:sync',
                    'Or, deliberately, for this run only:  ALLOW_STALE=1 <command>',
                ]);
            }
        }
    }

    if (!quiet) {
        console.log(
            `  ok: env=${health.env} branch=${health.branch || '-'} ` +
            `commit=${(deployed || '-').slice(0, 7)} db=${health.supabase}\n`
        );
    }

    return health;
}

/**
 * Choose a target and check it, in one call. What a runner should use.
 *
 * A refusal here exits non-zero with the explanation, because that is what a
 * command-line runner wants; Playwright calls chooseTarget/assertSafeTarget
 * directly so it can throw instead.
 */
export async function resolveTarget(options = {}) {
    const baseURL = chooseTarget(options);
    try {
        await assertSafeTarget(baseURL, options);
    } catch (err) {
        if (err instanceof RefusedError) {
            console.error(err.message);
            process.exit(1);
        }
        throw err;
    }
    return baseURL;
}
