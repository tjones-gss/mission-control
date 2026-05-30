# Tests

Lightweight validation for the v5.1 harness. Two suites, both zero-dependency
beyond what the harness itself requires.

## What's here

```
tests/
├── check_hooks.sh      # bash + jq — syntax + behavioral tests for the 4 hooks
├── test_cli.py         # python3 + PyYAML — exit-code & behavior tests for tools/harness
├── fixtures/           # tiny project state + sample mission used by both suites
└── README.md           # this file
```

## Requirements

| Suite          | Needs                                |
| -------------- | ------------------------------------ |
| `check_hooks.sh` | `bash` 4+, `jq` (for behavioral pass) |
| `test_cli.py`    | `python3` 3.10+, `pyyaml`           |

If `jq` is missing, `check_hooks.sh --syntax` still runs the syntax pass.

## Run

From the repo root:

```bash
# Hook tests (syntax + behavior). Exits non-zero on any failure.
./tests/check_hooks.sh

# Syntax-only (no jq required)
./tests/check_hooks.sh --syntax

# CLI tests
python3 tests/test_cli.py

# Or via unittest discovery
python3 -m unittest discover tests -v
```

Expected output on a clean tree:

```
16 passed, 0 failed.
Ran 8 tests in <1s
OK
```

## What's covered

### `check_hooks.sh`

- **Syntax**: `bash -n` against every hook in `adapters/claude-code/.claude/hooks/`.
- **block-danger.sh**: rejects `rm -rf`, rejects `DROP TABLE` case-insensitively,
  rejects `rm   -rf` with collapsed whitespace, allows `ls -la`.
- **require-mission.sh**: denies Forbidden Files, allows Allowed Files, denies
  app code outside scope, asks on harness-owned paths when a mission is set,
  allows harness-owned paths under bootstrap modes (idea-to-mvp /
  existing-repo-retrofit).
- **stop-session-note-reminder.sh**: advisory mode exits 0; enforce mode exits 2
  on missing note; enforce mode exits 0 when a matching note exists.

### `test_cli.py`

- `harness check` exits 0 on a healthy fixture.
- `harness check --strict` escalates warnings to a non-zero exit.
- `no_outputs_reason` / `no_gate_reason` escape hatches are accepted by phase
  schema validation.
- Unresolved agent references are flagged.
- `current.mission` pointing to a missing index entry is a hard failure.
- `harness init` rejects unknown modes and writes the expected `mode:` field.
- `harness status --json` returns parseable JSON with the expected keys.

## Wiring into CI

Two example commands suitable for a GitHub Action or pre-commit hook:

```bash
./tests/check_hooks.sh
python3 tests/test_cli.py
```

Both exit non-zero on any failure, so they can sit directly in a job's `run:`
block. No extra reporters needed.

## Adding a test

- **Hook behavior**: add a new `run_hook ... && ok / bad` block in
  `tests/check_hooks.sh`. Keep each test to two lines: one to invoke, one to
  assert.
- **CLI behavior**: add a new `unittest.TestCase` method in `test_cli.py`. Use
  `make_minimal_project(tmpdir)` to scaffold a throwaway fixture, then run the
  CLI via the `run_cli` helper.
- **Fixtures**: drop new YAML/markdown files into `tests/fixtures/` and
  reference them from the test. Keep them small — the point is to be readable
  at a glance.

## Why no pytest

The CLI tests use only `unittest` from the stdlib so the suite runs in any
environment that has Python + PyYAML (which the CLI already requires). One
fewer dev dependency to drift on.
