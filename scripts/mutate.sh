#!/bin/zsh
#
# Mutation testing: break a behaviour on purpose, run the suite, and see
# whether anything notices.
#
# A passing test suite says nothing about whether the tests would catch a
# regression. Three times in one session tests here were found to be asserting
# something other than what their name claimed — each time a default quietly
# standing in for the case under test, each time passing for years. This is how
# you tell the difference: change the code so the behaviour is wrong, and watch
# what fails. Nothing failing means nothing was testing it.
#
#   ./scripts/mutate.sh <file> <from> <to> <label>
#
# Examples that earned their keep:
#
#   ./scripts/mutate.sh app/api/cron/host-payouts/route.ts \
#       "'payout-' + booking.id" "'payout-' + booking.id + Math.random()" \
#       "payout idempotency key made non-deterministic"
#
#   ./scripts/mutate.sh lib/stayWindow.ts \
#       "const DEFAULT_CHECK_OUT_HOUR = 11;" "const DEFAULT_CHECK_OUT_HOUR = 0;" \
#       "checkout default back to midnight"
#
# Both survived. Both were the only thing standing between a mistake and real
# money or a launch blocker, and neither had a test.
#
# NOTE ON THE GUARD BELOW. This reverts with `git checkout --`, which discards
# uncommitted work. It ate the same fix twice in one evening — both times the
# fix was still uncommitted, both times it was noticed only by grepping for it
# afterwards rather than by anything failing. Hence: it refuses on a dirty
# file. Commit first; the revert then restores the committed state, which is
# what you wanted anyway.

set -u

ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$ROOT" ]; then echo "not in a git repository"; exit 1; fi
cd "$ROOT" || exit 1

# node is not on the PATH a tool session starts with — see CLAUDE.md.
if ! command -v npm >/dev/null 2>&1; then
    export PATH="$HOME/.local/node/bin:$PATH"
fi

FILE="${1:-}"; FROM="${2:-}"; TO="${3:-}"; LABEL="${4:-$1}"

if [ -z "$FILE" ] || [ -z "$FROM" ] || [ -z "$TO" ]; then
    echo "usage: ./scripts/mutate.sh <file> <from> <to> [label]"
    exit 2
fi

if [ ! -f "$FILE" ]; then echo "no such file: $FILE"; exit 2; fi

# --- the guard -------------------------------------------------------------
# Staged and unstaged both count. `git checkout -- <file>` restores from the
# index, so a staged change survives and an unstaged one does not — and having
# to remember which is which is exactly how this went wrong.
if ! git diff --quiet -- "$FILE" || ! git diff --cached --quiet -- "$FILE"; then
    echo "REFUSING: $FILE has uncommitted changes."
    echo "  This reverts with 'git checkout --', which would throw them away."
    echo "  Commit first, then mutate."
    git --no-pager diff --stat -- "$FILE"
    exit 3
fi

if [ -n "$(git status --porcelain -- "$FILE")" ]; then
    echo "REFUSING: $FILE is untracked or otherwise not clean."
    exit 3
fi
# ---------------------------------------------------------------------------

python3 - "$FILE" "$FROM" "$TO" <<'PY'
import sys
path, before, after = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path).read()
if before not in text:
    sys.exit(9)
open(path, 'w').write(text.replace(before, after, 1))
PY

if [ $? -eq 9 ]; then
    echo "PATTERN NOT FOUND — nothing was changed: $LABEL"
    exit 4
fi

OUT=$(npm test 2>&1 | grep -E "^# (pass|fail)" | tr '\n' ' ')
FAILED=$(echo "$OUT" | grep -oE "fail [0-9]+" | grep -oE "[0-9]+")

git checkout -q -- "$FILE"

# Check the revert actually happened rather than assuming it did. The failure
# that started all this was not the revert going wrong — it was the revert
# working perfectly and restoring the wrong thing.
if [ -n "$(git status --porcelain -- "$FILE")" ]; then
    echo "!! $FILE is still dirty after the revert — check it by hand"
    exit 5
fi

if [ "$FAILED" = "0" ]; then
    echo "SURVIVED — nothing tests this: $LABEL   ($OUT)"
    exit 1
else
    echo "caught by $FAILED: $LABEL"
fi
