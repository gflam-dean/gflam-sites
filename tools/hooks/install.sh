#!/bin/bash
# Put the pre-push gate in place. Run once per clone.
#
# git rev-parse, not ".git/hooks": in a worktree .git is a FILE pointing at the
# real directory, so the obvious path does not exist and cp fails. The first
# version of this script printed "Installed" anyway, because it never looked at
# whether the copy worked, which is the exact kind of thing this gate exists to
# stop. So: check, and say plainly if it did not.
set -e
ROOT="$(git rev-parse --show-toplevel)"
HOOKS="$(git rev-parse --git-common-dir)/hooks"

mkdir -p "$HOOKS"
cp "$ROOT/tools/hooks/pre-push" "$HOOKS/pre-push"
chmod +x "$HOOKS/pre-push"

if [ ! -x "$HOOKS/pre-push" ]; then
  echo "FAILED: the hook is not in place at $HOOKS/pre-push" >&2
  exit 1
fi
echo "Installed at $HOOKS/pre-push"
echo "Every push now runs tools/release-check.py --local first, and is refused if"
echo "anything fails. 'git push --no-verify' skips it."
