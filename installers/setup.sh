#!/usr/bin/env sh
# Mission Control — POSIX wrapper. Thin: it finds node and execs setup.mjs.
# The real installer is setup.mjs (cross-platform). All args are forwarded.
#
#   ./installers/setup.sh            # preflight + install, print next steps
#   ./installers/setup.sh --launch   # also launch the cockpit
#   ./installers/setup.sh --check    # preflight only (CI)

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "error: Node.js was not found on your PATH." >&2
  echo "  The Mission Control cockpit requires Node 18+ (npm ships with it)." >&2
  echo "  Install from https://nodejs.org/ then re-run: ./installers/setup.sh" >&2
  exit 1
fi

exec node "$SCRIPT_DIR/setup.mjs" "$@"
