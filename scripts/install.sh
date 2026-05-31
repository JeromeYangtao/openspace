#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${OPENSPACE_REPO_URL:-https://github.com/jeromeyangtao/openspace.git}"
REF="${OPENSPACE_REF:-main}"
INSTALL_DIR="${OPENSPACE_INSTALL_DIR:-$HOME/.openspace/app}"
DATA_DIR="${OPENSPACE_HOME:-$HOME/.openspace}"
DEFAULT_WORKSPACE="${OPENSPACE_DEFAULT_WORKSPACE:-$HOME}"
HOST="${OPENSPACE_HOST:-127.0.0.1}"
PORT="${OPENSPACE_PORT_SERVER:-4179}"
PNPM_VERSION="${OPENSPACE_PNPM_VERSION:-10}"

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

need_cmd git
need_cmd node
need_cmd npm

node_major="$(node -p "Number(process.versions.node.split('.')[0])")"
if [ "$node_major" -lt 20 ]; then
  fail "Node.js >= 20 is required. Current version: $(node -v)"
fi

info "Preparing install directory: $INSTALL_DIR"
mkdir -p "$(dirname "$INSTALL_DIR")" "$DATA_DIR"

if [ -d "$INSTALL_DIR/.git" ]; then
  info "Updating existing OpenSpace checkout"
  git -C "$INSTALL_DIR" fetch origin "$REF"
  git -C "$INSTALL_DIR" checkout "$REF"
  git -C "$INSTALL_DIR" pull --ff-only origin "$REF"
elif [ -e "$INSTALL_DIR" ]; then
  fail "$INSTALL_DIR already exists but is not a git checkout. Set OPENSPACE_INSTALL_DIR to another path."
else
  info "Cloning OpenSpace"
  git clone --branch "$REF" "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

ensure_pnpm() {
  info "Installing pnpm@$PNPM_VERSION with npm"
  npm install -g --force "pnpm@$PNPM_VERSION"
  hash -r

  if ! command -v pnpm >/dev/null 2>&1; then
    fail "pnpm is still unavailable after npm install -g pnpm@$PNPM_VERSION."
  fi

  pnpm_major="$(pnpm --version 2>/dev/null | cut -d. -f1)"
  if [ "${pnpm_major:-0}" -lt 10 ]; then
    fail "pnpm >= 10 is required, but $(command -v pnpm) reports version $(pnpm --version)."
  fi
}

ensure_pnpm

info "Installing dependencies"
pnpm install --frozen-lockfile

info "Building OpenSpace"
pnpm build

if ! command -v pm2 >/dev/null 2>&1; then
  info "Installing PM2"
  npm install -g pm2
fi

info "Starting OpenSpace with PM2"
OPENSPACE_HOME="$DATA_DIR" \
OPENSPACE_DEFAULT_WORKSPACE="$DEFAULT_WORKSPACE" \
OPENSPACE_HOST="$HOST" \
OPENSPACE_PORT_SERVER="$PORT" \
  pm2 restart openspace --update-env >/dev/null 2>&1 || \
OPENSPACE_HOME="$DATA_DIR" \
OPENSPACE_DEFAULT_WORKSPACE="$DEFAULT_WORKSPACE" \
OPENSPACE_HOST="$HOST" \
OPENSPACE_PORT_SERVER="$PORT" \
  pm2 start ecosystem.config.cjs --update-env

pm2 save

if ! command -v codex >/dev/null 2>&1 && ! command -v cursor-agent >/dev/null 2>&1; then
  warn "No Codex CLI or Cursor CLI found. OpenSpace will run, but agents need at least one logged-in runtime."
fi

cat <<EOF

OpenSpace is running.

URL:
  http://$HOST:$PORT

Install directory:
  $INSTALL_DIR

Data directory:
  $DATA_DIR

Useful commands:
  pm2 logs openspace
  pm2 restart openspace --update-env
  pm2 stop openspace

EOF
