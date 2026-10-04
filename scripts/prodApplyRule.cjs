// When scripts/migrate.mjs may apply a migration to PRODUCTION.
//
// Sessions may now apply a production migration themselves (Liam, 4 October
// 2026), on three conditions that are checked here rather than trusted:
//
//   1. From the branch the migration lives on — never master. Twice a corrected
//      migration sat unmerged on a branch while master still held the
//      superseded one, and the one applied was master's because master was the
//      branch checked out. A detached HEAD is refused too: it names no branch.
//   2. The file is committed on that branch and unchanged. What reaches
//      production must be what the pull request shows, not an edit on disk.
//   3. Never --destructive. A migration that loses data on production goes to
//      Liam as commands to run himself.
//
// Applies to --apply only. A dry run, a read-only --sql, --status and --record
// execute no migration, so they are not stopped by this.
//
// Its own module, like sqlRisk.cjs, so the test suite can load the rule
// without .env.local or a database.

const TRUNK = ['master', 'main'];

function prodApplyProblem({ targetName, apply, destructiveFlag, branch, fileCommittedUnchanged }) {
    if (targetName !== 'prod' || !apply) return null;
    if (destructiveFlag) {
        return '--destructive is never used on production. Hand Liam the commands instead.';
    }
    if (!branch || branch === 'HEAD') {
        return 'no branch is checked out (detached HEAD). Switch to the branch the migration lives on.';
    }
    if (TRUNK.includes(branch)) {
        return 'production migrations are applied from the branch the migration lives on, never ' + branch + '.';
    }
    if (!fileCommittedUnchanged) {
        return 'the migration file is not committed on ' + branch + ', or has changed since. Commit it, then apply.';
    }
    return null;
}

module.exports = { prodApplyProblem };
