from __future__ import annotations

import json
import logging
import shutil
import subprocess

from harness_orchestrator.cursor_driver import DriverConfig, DriverResult, MockAgent

logger = logging.getLogger(__name__)

# Claude runtime driver: drives Claude Code via the `claude` CLI (-p / --resume),
# mirroring how the cockpit already shells out to `claude`. Auth is ambient (the
# user's Claude subscription) — no API key required, unlike the Cursor driver.
#
# This makes the mission-loop's model tiers map onto real Claude models: a tier
# alias (heavy/standard/light) resolves to a concrete model string in
# .harness/model-tiers.yml (e.g. opus/sonnet/haiku for Claude), which is passed
# straight through as `claude --model <model>`.


def _claude_bin() -> str | None:
    return shutil.which("claude")


def _parse_output(stdout: str) -> tuple[str | None, str]:
    """Return (session_id, result_text) from `claude -p --output-format json`.

    Tolerant: falls back to (None, raw stdout) if the output isn't the expected
    JSON envelope, so a CLI format change degrades rather than crashes.
    """
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError:
        return None, stdout.strip()
    if isinstance(data, dict):
        return data.get("session_id"), str(data.get("result", "") or "")
    return None, stdout.strip()


def _run_claude(config: DriverConfig, prompt: str, *, session_id: str | None = None) -> DriverResult:
    claude = _claude_bin()
    if claude is None:
        raise RuntimeError("claude CLI not found on PATH (install Claude Code)")
    cmd = [claude, "-p", prompt, "--output-format", "json"]
    if config.model:
        cmd += ["--model", config.model]
    resume = session_id or config.resume_agent_id
    if resume:
        cmd += ["--resume", resume]

    proc = subprocess.run(cmd, cwd=config.cwd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(
            f"claude CLI exited {proc.returncode}: {(proc.stderr or proc.stdout).strip()[:300]}"
        )
    sid, text = _parse_output(proc.stdout)
    return DriverResult(
        agent_id=sid or "claude",
        run_id=sid or "claude-run",
        status="finished",
        text=text,
    )


class ClaudeAgent:
    """Persistent Claude Code session. The first send starts a session; later
    sends resume it via the captured session_id, so the implementer keeps one
    continuous context across the phase."""

    def __init__(self, config: DriverConfig):
        self.config = config
        self.agent_id: str | None = config.resume_agent_id

    def send(self, prompt: str) -> "ClaudeRun":
        return ClaudeRun(self, prompt)

    def close(self) -> None:
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


class ClaudeRun:
    def __init__(self, agent: ClaudeAgent, prompt: str):
        self.agent = agent
        self.prompt = prompt
        self.id = "claude-run"

    def wait(self) -> DriverResult:
        result = _run_claude(self.agent.config, self.prompt, session_id=self.agent.agent_id)
        # Capture the session id so subsequent sends resume the same context.
        if result.agent_id and result.agent_id != "claude":
            self.agent.agent_id = result.agent_id
        self.id = result.run_id
        return result


def create_agent(config: DriverConfig):
    if config.dry_run:
        logger.warning("Using mock agent (dry_run)")
        return MockAgent()
    return ClaudeAgent(config)


def run_prompt(config: DriverConfig, prompt: str) -> DriverResult:
    """One-shot `claude -p` wrapper."""
    if config.dry_run:
        return MockAgent().send(prompt).wait()
    return _run_claude(config, prompt)


def send_and_wait(agent, prompt: str) -> DriverResult:
    return agent.send(prompt).wait()
