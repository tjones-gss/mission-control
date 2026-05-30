#!/usr/bin/env python3
"""Install Cursor adapter hooks + SDK packages (cross-platform).

Detects the OS at runtime:
  - Windows: copies hooks and writes hooks.json with Git Bash paths
  - macOS/Linux: copies hooks and uses portable ``bash .cursor/hooks/...`` commands

Usage:
  python tools/install-cursor-adapter.py [--root PATH] [--hooks-only]
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def find_git_bash_windows() -> Path | None:
    """Return Git Bash on Windows; ignore WSL stub at System32."""
    program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
    program_files_x86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
    candidates = [
        Path(program_files) / "Git" / "bin" / "bash.exe",
        Path(program_files_x86) / "Git" / "bin" / "bash.exe",
    ]
    which_bash = shutil.which("bash")
    if which_bash:
        p = Path(which_bash)
        if p.exists() and "system32" not in str(p).lower():
            candidates.insert(0, p)

    for path in candidates:
        if path.is_file():
            return path
    return None


def hook_command(script_rel: str, bash_exe: str | None) -> str:
    if bash_exe and bash_exe != "bash":
        return f'"{bash_exe}" {script_rel}'
    return f"bash {script_rel}"


def write_hooks_json(dest: Path, bash_exe: str | None) -> None:
    hooks = {
        "version": 1,
        "hooks": {
            "sessionStart": [
                {"command": hook_command(".cursor/hooks/session-start-load-state.sh", bash_exe)}
            ],
            "beforeShellExecution": [
                {
                    "command": hook_command(".cursor/hooks/block-danger.sh", bash_exe),
                    "failClosed": True,
                }
            ],
            "preToolUse": [
                {
                    "command": hook_command(".cursor/hooks/require-mission.sh", bash_exe),
                    "matcher": "Write|Edit|MultiEdit|NotebookEdit",
                    "failClosed": False,
                }
            ],
            "stop": [
                {"command": hook_command(".cursor/hooks/stop-session-note-reminder.sh", bash_exe)}
            ],
        },
    }
    dest.write_text(json.dumps(hooks, indent=2) + "\n", encoding="utf-8")


def _log(msg: str, *, quiet: bool, file=None) -> None:
    if not quiet:
        print(msg, file=file)


def _run(cmd: list[str], *, cwd: Path, check: bool = True, quiet: bool = False) -> int:
    _log(f"+ {' '.join(cmd)}", quiet=quiet)
    result = subprocess.run(cmd, cwd=str(cwd))
    if check and result.returncode != 0:
        raise SystemExit(result.returncode)
    return result.returncode


def install_cursor_adapter(root: Path, *, hooks_only: bool = False, quiet: bool = False) -> int:
    """Copy Cursor adapter hooks into ``root/.cursor`` and optionally install pip packages."""
    root = root.resolve()
    adapter_src = root / "adapters" / "cursor" / ".cursor"
    adapter_dest = root / ".cursor"

    if not adapter_src.is_dir():
        _log(f"error: adapter missing: {adapter_src}", quiet=quiet, file=sys.stderr)
        return 2

    is_windows = sys.platform == "win32"
    bash_exe: str | None = None

    if is_windows:
        git_bash = find_git_bash_windows()
        if git_bash is None:
            _log(
                "warning: Git for Windows not found — skipping Cursor hook install.\n"
                "  Install from https://git-scm.com/download/win\n"
                "  Hooks require Git Bash to execute .sh scripts on Windows.",
                quiet=quiet,
                file=sys.stderr,
            )
            return 0
        bash_exe = str(git_bash)
        _log(f"Detected Windows - using Git Bash: {bash_exe}", quiet=quiet)
    else:
        if shutil.which("bash") is None:
            _log(
                "warning: bash not in PATH - hooks.json will still reference bash",
                quiet=quiet,
                file=sys.stderr,
            )
        _log("Detected Unix - using bash from PATH", quiet=quiet)

    _log("Installing Cursor adapter to .cursor/", quiet=quiet)
    if adapter_dest.exists():
        shutil.rmtree(adapter_dest)
    shutil.copytree(adapter_src, adapter_dest)

    hooks_json = adapter_dest / "hooks.json"
    _log(f"Writing {hooks_json.relative_to(root)}", quiet=quiet)
    write_hooks_json(hooks_json, bash_exe)

    if not is_windows:
        hooks_dir = adapter_dest / "hooks"
        for hook in hooks_dir.glob("*.sh"):
            hook.chmod(hook.stat().st_mode | 0o111)

    if hooks_only:
        _log("Hooks-only mode — skipping pip packages.", quiet=quiet)
        return 0

    _log("Installing Python packages...", quiet=quiet)
    _run([sys.executable, "-m", "pip", "install", "-e", "harness_core"], cwd=root, quiet=quiet)
    _run([sys.executable, "-m", "pip", "install", "-e", "sdk/python[cursor,dev]"], cwd=root, quiet=quiet)

    _log("Running harness check --strict...", quiet=quiet)
    check_code = _run(
        [sys.executable, str(root / "tools" / "harness"), "check", "--strict"],
        cwd=root,
        check=False,
        quiet=quiet,
    )
    if check_code != 0:
        _log(f"warning: harness check --strict exited {check_code}", quiet=quiet, file=sys.stderr)

    hook_test = root / "tests" / "check_hooks.sh"
    if hook_test.is_file():
        _log("Running hook smoke tests...", quiet=quiet)
        if is_windows and bash_exe:
            smoke_code = _run([bash_exe, str(hook_test)], cwd=root, check=False, quiet=quiet)
        elif shutil.which("bash"):
            smoke_code = _run(["bash", str(hook_test)], cwd=root, check=False, quiet=quiet)
        else:
            smoke_code = 0
            _log("skipped hook smoke tests - bash not available", quiet=quiet)
        if smoke_code != 0:
            _log(f"warning: hook smoke tests exited {smoke_code}", quiet=quiet, file=sys.stderr)

    _log("", quiet=quiet)
    _log("Done. Restart Cursor IDE to load hooks.", quiet=quiet)
    if is_windows:
        _log("Trust this workspace in Cursor (disable Restricted Mode).", quiet=quiet)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Install Cursor adapter hooks and optional SDK packages.")
    parser.add_argument(
        "--root",
        type=Path,
        default=None,
        help="Harness project root (default: directory containing this script's parent)",
    )
    parser.add_argument(
        "--hooks-only",
        action="store_true",
        help="Install hooks only; skip pip packages and post-install checks",
    )
    args = parser.parse_args()
    root = args.root if args.root is not None else repo_root()
    return install_cursor_adapter(root, hooks_only=args.hooks_only, quiet=False)


if __name__ == "__main__":
    raise SystemExit(main())
