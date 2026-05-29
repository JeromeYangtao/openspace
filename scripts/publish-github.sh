#!/usr/bin/env bash
set -euo pipefail

GITHUB_REMOTE_NAME="${GITHUB_REMOTE_NAME:-github}"
GITHUB_REMOTE_URL="${GITHUB_REMOTE_URL:-git@github.com:JeromeYangtao/openspace.git}"
SOURCE_BRANCH="${SOURCE_BRANCH:-main}"
PUBLIC_BRANCH="${PUBLIC_BRANCH:-public-main}"
GITHUB_BRANCH="${GITHUB_BRANCH:-main}"
COMMIT_MESSAGE="${COMMIT_MESSAGE:-release: publish open source snapshot $(date +%Y-%m-%d)}"
DRY_RUN="${DRY_RUN:-0}"
SKIP_CONFIRM="${SKIP_CONFIRM:-0}"

info() {
  printf '\033[1;34m==>\033[0m %s\n' "$1"
}

warn() {
  printf '\033[1;33mWARN:\033[0m %s\n' "$1"
}

fail() {
  printf '\033[1;31mERROR:\033[0m %s\n' "$1" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required but was not found in PATH."
}

confirm() {
  if [ "$SKIP_CONFIRM" = "1" ]; then
    return 0
  fi

  printf '%s [y/N] ' "$1"
  read -r answer
  case "$answer" in
    y | Y | yes | YES) ;;
    *) fail "Aborted." ;;
  esac
}

run() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '[dry-run] %q' "$1"
    shift
    for arg in "$@"; do
      printf ' %q' "$arg"
    done
    printf '\n'
  else
    "$@"
  fi
}

need_cmd git

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if [ -n "$(git status --porcelain)" ]; then
  fail "Working tree is not clean. Commit or stash changes before publishing."
fi

if ! git rev-parse --verify "$SOURCE_BRANCH" >/dev/null 2>&1; then
  fail "Source branch '$SOURCE_BRANCH' does not exist."
fi

if git remote get-url "$GITHUB_REMOTE_NAME" >/dev/null 2>&1; then
  current_url="$(git remote get-url "$GITHUB_REMOTE_NAME")"
  if [ "$current_url" != "$GITHUB_REMOTE_URL" ]; then
    fail "Remote '$GITHUB_REMOTE_NAME' points to '$current_url', expected '$GITHUB_REMOTE_URL'."
  fi
else
  info "Adding GitHub remote: $GITHUB_REMOTE_URL"
  run git remote add "$GITHUB_REMOTE_NAME" "$GITHUB_REMOTE_URL"
fi

info "Publishing source '$SOURCE_BRANCH' to '$GITHUB_REMOTE_NAME/$GITHUB_BRANCH' via local '$PUBLIC_BRANCH'"
warn "This creates a squashed public snapshot. GitHub will not receive internal commit history."
confirm "Continue?"

current_branch="$(git branch --show-current)"

cleanup() {
  if [ "$DRY_RUN" != "1" ] && [ -n "${current_branch:-}" ]; then
    git checkout "$current_branch" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if git rev-parse --verify "$PUBLIC_BRANCH" >/dev/null 2>&1; then
  info "Checking out existing public branch: $PUBLIC_BRANCH"
  run git checkout "$PUBLIC_BRANCH"
  info "Copying source tree without internal history: $SOURCE_BRANCH"
  run git read-tree --reset -u "$SOURCE_BRANCH"
else
  info "Creating orphan public branch: $PUBLIC_BRANCH"
  run git checkout --orphan "$PUBLIC_BRANCH"
  run git reset --hard
  run git checkout "$SOURCE_BRANCH" -- .
fi

info "Creating public release commit"
run git add -A

if git diff --cached --quiet; then
  warn "No changes to publish."
else
  run git commit -m "$COMMIT_MESSAGE"
fi

info "Pushing to GitHub"
run git push "$GITHUB_REMOTE_NAME" "$PUBLIC_BRANCH:$GITHUB_BRANCH"

cat <<EOF

Published OpenSpace to GitHub.

GitHub:
  https://github.com/JeromeYangtao/openspace

Local public branch:
  $PUBLIC_BRANCH

Source branch:
  $SOURCE_BRANCH

EOF
