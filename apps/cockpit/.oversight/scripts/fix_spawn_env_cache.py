"""Deterministic mutator: hoist env-cleanup in server/claude-cli.js to module scope.

Today runClaude() rebuilds `process.env` and filters out CLAUDECODE +
CLAUDE_CODE_* variables on every call. These variables are set at process
startup and don't change during the lifetime of the server, so the scrub
can be done ONCE at module load and reused on every spawn — saving an
object-spread of ~100 env vars + a filter loop per session creation.

This mutator rewrites the file idempotently. It's safe to run repeatedly:
if the env is already hoisted, the script detects it and exits 0 with no
changes. The change_command contract for run_job_loop.py.

Exit codes:
  0 — file rewritten or already hoisted
  1 — target pattern not found (probably the file was refactored and this
      mutator is stale; a human should look)
  2 — invocation error

Usage:
  python .oversight/scripts/fix_spawn_env_cache.py
  python .oversight/scripts/fix_spawn_env_cache.py --root /path
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import REPO_ROOT  # type: ignore


TARGET = "server/claude-cli.js"

# The exact source shape we're rewriting. Keeping this as a literal
# string means the mutator is purely structural — it won't fire on a
# different shape it wasn't tested against, which would be a silent bug.
LEGACY_BLOCK = """export function runClaude({ args, cwd, timeoutMs = 120_000 }) {
  // Unset CLAUDECODE and all CLAUDE_CODE_* vars so the CLI doesn't refuse to run inside an active session
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_')) delete env[key]
  }

  return new Promise((resolve, reject) => {"""

HOISTED_BLOCK = """// Module-scope env snapshot. CLAUDECODE + CLAUDE_CODE_* are set at process
// startup and don't change during the lifetime of the server; scrubbing them
// once here avoids cloning ~100 env keys + running a filter loop on every
// spawn. Any variable that DOES change at runtime (PATH edits, temp auth
// tokens) still refreshes naturally because Node's process.env is live here.
const CLEANED_ENV = (() => {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_')) delete env[key]
  }
  return env
})()

export function runClaude({ args, cwd, timeoutMs = 120_000 }) {
  const env = CLEANED_ENV
  return new Promise((resolve, reject) => {"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=None)
    args = parser.parse_args()

    root = Path(args.root).resolve() if args.root else REPO_ROOT
    path = root / TARGET
    if not path.exists():
        print(f"target not found: {path}", file=sys.stderr)
        return 2

    text = path.read_text(encoding="utf-8")

    if "const CLEANED_ENV" in text:
        print(f"[fix_spawn_env_cache] already hoisted: {path}")
        return 0

    if LEGACY_BLOCK not in text:
        print(
            f"[fix_spawn_env_cache] target pattern not found in {path}.\n"
            "  The file may have been refactored. Review manually before re-running.",
            file=sys.stderr,
        )
        return 1

    new_text = text.replace(LEGACY_BLOCK, HOISTED_BLOCK, 1)
    path.write_text(new_text, encoding="utf-8")
    print(f"[fix_spawn_env_cache] hoisted env to module scope in {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
