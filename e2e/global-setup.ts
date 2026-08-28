// Refusing to run against the wrong thing.
//
// This suite is not read-only. It creates auth accounts and lodges
// applications, so where it points is a safety question, and until now the
// answer was a URL in a config file with nothing checking it. That went wrong
// quietly: the URL named a feature branch, the branch was merged, and the
// branch alias went on resolving to the last build it ever had. The suite
// stayed green for days against code that was eight commits behind master.
//
// A test that passes against the wrong build is worse than one that fails,
// because it is evidence of something that was never checked. So the three
// ways this can be pointed at the wrong thing are checked before the browser
// opens, and every one of them stops the run:
//
//   PRODUCTION   invented tradesmen in the real queue, real rows in the real
//                database. No override, at any time, for any reason.
//   WRONG DB     a preview whose environment points at the production Supabase
//                project. Looks like a preview, writes like production.
//   STALE        a build that is behind master, which is the failure that
//                actually happened.
//
// The first two are absolute. Staleness can be overridden with
// PLAYWRIGHT_ALLOW_STALE=1, deliberately and per run, because there are honest
// reasons to test an older build — but it is never the default and it says so
// on the way past.

import type { FullConfig } from '@playwright/test';
import { execSync } from 'node:child_process';
import { TEST_PROJECT_REF } from './helpers';

function git(cmd: string): string | null {
    try {
        return execSync(`git ${cmd}`, {
            cwd: __dirname + '/..',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).toString().trim();
    } catch {
        return null;
    }
}

const RULE = '='.repeat(74);

function refuse(title: string, lines: string[]): never {
    throw new Error(
        ['', RULE, `REFUSING TO RUN — ${title}`, RULE, ...lines, RULE, ''].join('\n')
    );
}

function warn(lines: string[]) {
    console.warn(['', RULE, ...lines, RULE, ''].join('\n'));
}

export default async function globalSetup(config: FullConfig) {
    const baseURL =
        (config.projects[0]?.use as any)?.baseURL || process.env.PLAYWRIGHT_BASE_URL;

    if (!baseURL) {
        refuse('no baseURL', ['Nothing to test against. Set PLAYWRIGHT_BASE_URL.']);
    }

    console.log(`\n  checking what ${baseURL} actually is before typing into it...`);

    // ---------------------------------------------------------------------
    // Ask the deployment what it is.
    // ---------------------------------------------------------------------
    let health: any;
    let res: Response;
    try {
        res = await fetch(`${baseURL}/api/health`, { cache: 'no-store' } as any);
    } catch (err: any) {
        refuse('the target is unreachable', [
            `${baseURL}/api/health could not be fetched.`,
            `  ${err && err.message}`,
            '',
            'If the branch preview was deleted, recreate it:  npm run e2e:sync',
        ]);
    }

    if (res!.status === 404) {
        // Not a missing feature — a dated build. The route ships alongside this
        // guard, so a deployment without it is necessarily older than both.
        refuse('the target predates this guard', [
            `${baseURL} has no /api/health.`,
            '',
            'That route ships with this guard, so a build without it is older',
            'than the guard itself and cannot be checked. It is stale by',
            'definition.',
            '',
            'Bring the preview up to date:  npm run e2e:sync',
        ]);
    }

    if (!res!.ok) {
        refuse('the target answered badly', [
            `${baseURL}/api/health responded ${res!.status}.`,
        ]);
    }

    try {
        health = await res!.json();
    } catch {
        refuse('the target answered badly', [
            `${baseURL}/api/health did not return JSON.`,
            'A Vercel login wall will do this — check the deployment is public.',
        ]);
    }

    // ---------------------------------------------------------------------
    // 1. Never production. No override.
    // ---------------------------------------------------------------------
    if (health.env === 'production') {
        refuse('that is PRODUCTION', [
            `${baseURL} is the live site.`,
            '',
            'This suite creates accounts and lodges applications. Against',
            'production that means invented tradesmen in the real review queue',
            'and real rows in the real database.',
            '',
            'There is no flag to allow this. Point it at the preview branch:',
            '  npm run e2e:sync     (bring the preview up to date and deploy it)',
        ]);
    }

    // ---------------------------------------------------------------------
    // 2. Never the production database, whatever the deployment calls itself.
    //
    // This is the check the URL could never make. A preview is only safe
    // because its environment points somewhere safe, and an environment
    // variable scoped to the wrong target has already happened on this project.
    // ---------------------------------------------------------------------
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
            'A preview pointed at the production database is production for',
            'every purpose this suite cares about. Fix the Preview environment',
            'variables in Vercel before running this again.',
        ]);
    }

    // ---------------------------------------------------------------------
    // 3. Not behind master.
    // ---------------------------------------------------------------------
    const deployed = health.commit || null;
    if (!deployed) {
        warn([
            'NOTE: the target reports no commit, so staleness cannot be checked.',
            'This is normal for a local dev server and suspicious for anything else.',
        ]);
    } else {
        // Best effort: offline, or no remote, falls through to whatever the
        // last fetch left behind, which is still better than nothing.
        git('fetch origin master --quiet');

        const master = git('rev-parse origin/master');
        const head = git('rev-parse HEAD');
        const known = git(`cat-file -e ${deployed}^{commit} && echo ok`) !== null;
        const allowStale = process.env.PLAYWRIGHT_ALLOW_STALE === '1';

        const current = deployed === master || deployed === head;

        if (!current) {
            const behind = known && master ? git(`rev-list --count ${deployed}..${master}`) : null;
            const detail = !known
                ? [`The deployed commit ${deployed.slice(0, 7)} is not in this checkout.`,
                   'Run `git fetch` and try again.']
                : behind && behind !== '0'
                  ? [`The deployed build is ${behind} commit(s) BEHIND origin/master.`,
                     `  deployed  ${deployed.slice(0, 7)}  (${health.branch || 'unknown branch'})`,
                     `  master    ${(master || '').slice(0, 7)}`]
                  : [`The deployed commit ${deployed.slice(0, 7)} is neither origin/master`,
                     `nor your HEAD ${(head || '').slice(0, 7)}.`];

            if (allowStale) {
                warn(['RUNNING AGAINST A STALE BUILD — because PLAYWRIGHT_ALLOW_STALE=1.',
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
                    'Or, deliberately, for this run only:  PLAYWRIGHT_ALLOW_STALE=1 npm run test:e2e',
                ]);
            }
        }
    }

    console.log(
        `  ok: env=${health.env} branch=${health.branch || '-'} ` +
        `commit=${(deployed || '-').slice(0, 7)} db=${health.supabase}\n`
    );
}
