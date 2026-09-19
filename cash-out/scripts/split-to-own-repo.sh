#!/usr/bin/env bash
# Moves Cash Out out of TuTak-Platform into its own repository, keeping every
# commit that touched cash-out/ and rewriting paths so that cash-out/ becomes
# the repository root.
#
# It never deletes anything. It builds a new branch from the history, pushes
# it to a repository you have already created, and then *verifies* the push by
# cloning it back and comparing trees. Deleting the copy inside TuTak-Platform
# is a separate, deliberate step, taken only after that verification passes.
#
# Usage, from the TuTak-Platform checkout:
#   scripts/split-to-own-repo.sh git@github.com:<owner>/cash-out.git
#
# Prerequisites:
#   - the target repository exists and is EMPTY (no README, no initial commit);
#   - you can push to it;
#   - git >= 2.30.
set -euo pipefail

TARGET_URL="${1:-}"
if [ -z "$TARGET_URL" ]; then
  echo "usage: $0 <git url of the new, empty cash-out repository>" >&2
  exit 2
fi

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
if [ ! -d cash-out ]; then
  echo "run this from the TuTak-Platform checkout that contains cash-out/" >&2
  exit 2
fi
if [ -n "$(git status --porcelain -- cash-out)" ]; then
  echo "cash-out/ has uncommitted changes; commit or stash them first" >&2
  exit 2
fi

SPLIT_BRANCH="cash-out-split-$(date +%Y%m%d%H%M%S)"
echo "==> Splitting cash-out/ history into branch $SPLIT_BRANCH"
git subtree split --prefix=cash-out -b "$SPLIT_BRANCH"
SPLIT_SHA="$(git rev-parse "$SPLIT_BRANCH")"
echo "    $SPLIT_SHA ($(git rev-list --count "$SPLIT_BRANCH") commits)"

echo "==> Pushing to $TARGET_URL as main"
git push "$TARGET_URL" "$SPLIT_BRANCH:refs/heads/main"

echo "==> Verifying: cloning back and comparing trees"
VERIFY_DIR="$(mktemp -d)"
git clone --quiet "$TARGET_URL" "$VERIFY_DIR/clone"
REMOTE_TREE="$(git -C "$VERIFY_DIR/clone" rev-parse HEAD^{tree})"
LOCAL_TREE="$(git rev-parse "$SPLIT_BRANCH^{tree}")"
SOURCE_TREE="$(git rev-parse "HEAD:cash-out")"
if [ "$REMOTE_TREE" != "$LOCAL_TREE" ] || [ "$LOCAL_TREE" != "$SOURCE_TREE" ]; then
  echo "TREE MISMATCH — do not delete anything:" >&2
  echo "  source  (HEAD:cash-out) $SOURCE_TREE" >&2
  echo "  split   ($SPLIT_BRANCH) $LOCAL_TREE" >&2
  echo "  remote  (main)          $REMOTE_TREE" >&2
  exit 1
fi
rm -rf "$VERIFY_DIR"

cat <<EOF

Verified: the new repository's main is byte-for-byte the current cash-out/ tree,
with $(git rev-list --count "$SPLIT_BRANCH") commits of history.

Next, by hand and in this order:
  1. In the new repository, run the CI once (it is .github/workflows/ci.yml
     there) and confirm it is green.
  2. Point any deploy or session at the new repository.
  3. Only then remove the copy here:
       git rm -r cash-out && git commit -m "Cash Out moved to its own repository"
     and delete .github/workflows/cash-out-ci.yml and the 'cash-out/**' ESLint
     ignore in eslint.config.mjs.
  4. git branch -D $SPLIT_BRANCH
EOF
