// Real people's accounts on the TEST project that no script may ever delete,
// or change the password or email of.
//
// WHY THIS EXISTS. The seeds each own a `.test` domain and clear only that (see
// "Seeds each own a separate email address domain" in CLAUDE.md). Liam's own
// account is NOT on a seed domain — it is his real address, used to walk both
// sides of the site (host of Millburn Cottage, admin, and the guest the
// experience seed places orders on). On 30 Sep 2026 it stopped signing in on
// the preview and the first question was "which seed deleted it?". None had —
// but nothing stopped one from doing so either: every reset is a loop over
// /auth/v1/admin/users with a DELETE, and the only thing between that loop and
// his account was each script's own email filter.
//
// So the rule is enforced here, once, and every path that deletes a user or
// resets a password goes through it:
//   - scripts/seed-lib.mjs `db.auth` / `db.rest` (most seeds and scenarios)
//   - the handful of runners with their own auth fetch (journeys, write-side-*,
//     experience-review-gate, e2e/helpers.ts)
// tests/protected-accounts.test.ts proves the guard refuses, and fails the build
// if a script issues its own auth-admin DELETE without calling it.
//
// CommonJS so the ESM scripts, the compiled unit tests and Playwright can all
// require it (the same reason target.cjs is CommonJS).

const PROTECTED_EMAILS = Object.freeze(['liamworrall18@hotmail.com']);

function isProtectedEmail(email) {
    return PROTECTED_EMAILS.includes(String(email || '').trim().toLowerCase());
}

function refuse(email, what) {
    throw new Error(
        'refusing to ' + what + ' ' + email + ': it is a protected real account '
        + '(scripts/protectedAccounts.cjs). Seeds clear only their own .test domain.'
    );
}

const USER_BY_ID = /^\/admin\/users\/([0-9a-f-]{36})\/?(\?.*)?$/i;

/**
 * Call BEFORE any request to the auth admin API. `endpoint` is the part after
 * /auth/v1 (e.g. "/admin/users/<id>"). Refuses a DELETE of a protected user, and
 * a PUT that changes a protected user's password or email. Anything else passes.
 *
 * `lookup(id)` returns the user ({ email }) — the caller supplies it so this
 * module needs no credentials of its own.
 */
async function guardAuthAdmin(method, endpoint, body, lookup) {
    const m = String(endpoint || '').match(USER_BY_ID);
    if (!m) return;
    const verb = String(method || 'GET').toUpperCase();
    const touchesLogin = verb === 'PUT' && body && (body.password !== undefined || body.email !== undefined);
    if (verb !== 'DELETE' && !touchesLogin) return;
    const user = await lookup(m[1]);
    if (user && isProtectedEmail(user.email)) {
        refuse(user.email, verb === 'DELETE' ? 'delete' : 'change the login of');
    }
}

/**
 * Call BEFORE a PostgREST DELETE on profiles. `rows` are the profiles the same
 * filter selects (id,email). Refuses if any is protected.
 */
function guardProfileDelete(rows) {
    for (const r of rows || []) if (isProtectedEmail(r.email)) refuse(r.email, 'delete the profile of');
}

/**
 * A ready-made guard for runners that talk to Supabase with plain fetch:
 * `await guardFetch(base, headers, method, endpoint, body)` where endpoint is
 * relative to /auth/v1 or a /rest/v1/profiles path.
 */
async function guardFetch(base, headers, method, path, body) {
    const p = String(path || '');
    const verb = String(method || 'GET').toUpperCase();
    const authPath = p.startsWith('/auth/v1') ? p.slice('/auth/v1'.length) : p;
    await guardAuthAdmin(verb, authPath, body, async (id) => {
        const res = await fetch(base + '/auth/v1/admin/users/' + id, { headers });
        return res.ok ? res.json() : null;
    });
    const profiles = p.match(/^(?:\/rest\/v1)?\/profiles(\?.*)?$/);
    if (verb === 'DELETE' && profiles) {
        const q = (profiles[1] || '?') + (profiles[1] ? '&' : '') + 'select=id,email';
        const res = await fetch(base + '/rest/v1/profiles' + q, { headers });
        guardProfileDelete(res.ok ? await res.json() : []);
    }
}

module.exports = { PROTECTED_EMAILS, isProtectedEmail, guardAuthAdmin, guardProfileDelete, guardFetch };
