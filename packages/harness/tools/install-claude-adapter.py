#!/usr/bin/env python3
"""Install Claude Code adapter (.claude/ + CLAUDE.md) into the project root.

Cross-platform. On Windows, uses Git Bash for chmod +x on hook scripts.

Usage:
  python tools/install-claude-adapter.py [--root PATH] [--check]
  harness install claude
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def find_git_bash_windows() -> Path | None:
    """Return Git Bash on Windows; ignore WSL stub at System32."""
    import os

    program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
    program_files_x86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
    candidates = [
        Path(program_files) / "Git" / "bin" / "bash.exe",
        Path(program_files_x86) / "Git" / "bin" / "bash.exe",
    ]
    which_bash = shutil.which("bash")
    if which_bash:
        p = Path(which_bash)
        if p.exists() and "system32" not in str(p).lower() and "windowsapps" not in str(p).lower():
            candidates.insert(0, p)

    for path in candidates:
        if path.is_file():
            return path
    return None


def patch_claude_settings_for_windows(settings_path: Path, git_bash: Path) -> None:
    """Wrap .sh hook commands with explicit Git Bash (avoids WSL stub on PATH)."""
    import json

    data = json.loads(settings_path.read_text(encoding="utf-8"))
    bash = str(git_bash).replace("\\", "\\\\")

    def walk(node) -> None:
        if isinstance(node, dict):
            cmd = node.get("command")
            if isinstance(cmd, str) and cmd.endswith(".sh") and "bash.exe" not in cmd.lower():
                node["command"] = f'"{bash}" "{cmd}"'
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(data)
    settings_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _log(msg: str, *, quiet: bool, file=None) -> None:
    if not quiet:
        print(msg, file=file)


def _chmod_hooks_unix(hooks_dir: Path) -> None:
    for hook in hooks_dir.glob("*.sh"):
        hook.chmod(hook.stat().st_mode | 0o111)


def _chmod_hooks_git_bash(bash_exe: Path, hooks_dir: Path) -> None:
    # Git Bash path: /c/Users/... style
    hooks_posix = hooks_dir.as_posix()
    if len(hooks_posix) > 1 and hooks_posix[1] == ":":
        hooks_posix = "/" + hooks_posix[0].lower() + hooks_posix[2:]
    subprocess.run(
        [str(bash_exe), "-lc", f"chmod +x {hooks_posix}/*.sh"],
        check=False,
    )


def install_claude_adapter(root: Path, *, run_check: bool = True, quiet: bool = False) -> int:
    root = root.resolve()
    adapter_root = root / "adapters" / "claude-code"
    src_claude = adapter_root / ".claude"
    src_claude_md = adapter_root / "CLAUDE.md"
    dest_claude = root / ".claude"
    dest_claude_md = root / "CLAUDE.md"

    if not src_claude.is_dir() or not src_claude_md.is_file():
        _log(f"error: adapter missing under {adapter_root}", quiet=quiet, file=sys.stderr)
        return 2

    is_windows = sys.platform == "win32"
    git_bash = find_git_bash_windows() if is_windows else None

    _log("Installing Claude Code adapter...", quiet=quiet)
    if dest_claude.exists():
        shutil.rmtree(dest_claude)
    shutil.copytree(src_claude, dest_claude)
    shutil.copy2(src_claude_md, dest_claude_md)
    _log(f"  -> {dest_claude.relative_to(root)}/", quiet=quiet)
    _log(f"  -> {dest_claude_md.name}", quiet=quiet)

    hooks_dir = dest_claude / "hooks"
    if is_windows:
        if git_bash is None:
            _log(
                "warning: Git for Windows not found — hooks copied but may not be executable.\n"
                "  Install: https://git-scm.com/download/win\n"
                "  Then re-run: harness install claude",
                quiet=quiet,
                file=sys.stderr,
            )
        else:
            _log(f"Making hooks executable via Git Bash ({git_bash})", quiet=quiet)
            _chmod_hooks_git_bash(git_bash, hooks_dir)
            settings_path = dest_claude / "settings.json"
            if settings_path.is_file():
                patch_claude_settings_for_windows(settings_path, git_bash)
                _log("  -> settings.json wired to Git Bash (WSL-safe on Windows)", quiet=quiet)
    else:
        _chmod_hooks_unix(hooks_dir)

    jq = shutil.which("jq")
    if jq:
        _log(f"jq found: {jq}", quiet=quiet)
    else:
        _log(
            "warning: jq not in PATH — hooks fail-open (weaker enforcement).\n"
            "  Install jq, then add it to PATH before launching Claude Code.",
            quiet=quiet,
            file=sys.stderr,
        )

    if is_windows:
        _log("", quiet=quiet)
        _log("Windows — Claude Code hooks need bash (Git Bash), not PowerShell alone.", quiet=quiet)
        _log("  1. Install Git for Windows if you have not already.", quiet=quiet)
        _log("  2. Add Git\\bin to the top of your user PATH (before WSL if installed).", quiet=quiet)
        _log("     Typical: C:\\Program Files\\Git\\bin", quiet=quiet)
        _log("     install claude also wraps hooks with Git Bash when WSL is present.", quiet=quiet)
        _log("  3. Add jq to PATH too if you installed it via winget.", quiet=quiet)
        _log("  4. Restart Claude Code, open this project, run /hooks to verify.", quiet=quiet)
    else:
        _log("Restart Claude Code and run /hooks to verify wiring.", quiet=quiet)

    if run_check:
        _log("", quiet=quiet)
        _log("Running harness check...", quiet=quiet)
        check_code = subprocess.run(
            [sys.executable, str(root / "tools" / "harness"), "check"],
            cwd=str(root),
        ).returncode
        if check_code != 0:
            _log(
                f"note: harness check exited {check_code} "
                "(functional tests may fail on Windows until jq is on Git Bash PATH)",
                quiet=quiet,
                file=sys.stderr,
            )

    _log("", quiet=quiet)
    _log("Done.", quiet=quiet)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Install Claude Code adapter (.claude/ + CLAUDE.md) at project root.",
    )
    parser.add_argument("--root", type=Path, default=None, help="Harness project root")
    parser.add_argument(
        "--no-check",
        action="store_true",
        help="Skip post-install harness check",
    )
    args = parser.parse_args()
    root = args.root if args.root is not None else repo_root()
    return install_claude_adapter(root, run_check=not args.no_check, quiet=False)


if __name__ == "__main__":
    raise SystemExit(main())
