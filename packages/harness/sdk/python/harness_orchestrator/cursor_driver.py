from __future__ import annotations

import logging
import os
import sys
from dataclasses import dataclass
from typing import Any, Protocol

logger = logging.getLogger(__name__)


class RunResult(Protocol):
    status: str
    id: str


@dataclass
class DriverResult:
    agent_id: str
    run_id: str
    status: str
    text: str = ""


class MockAgent:
    """Offline driver for tests and dry-run."""

    agent_id = "mock-local-agent"
    _counter = 0

    def send(self, prompt: str) -> "MockRun":
        MockAgent._counter += 1
        return MockRun(f"mock-run-{MockAgent._counter}", prompt[:200])

    def close(self) -> None:
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


class MockRun:
    def __init__(self, run_id: str, preview: str):
        self.id = run_id
        self._preview = preview

    def wait(self) -> DriverResult:
        return DriverResult(
            agent_id=MockAgent.agent_id,
            run_id=self.id,
            status="finished",
            text=f"[mock] processed prompt: {self._preview}",
        )


@dataclass
class DriverConfig:
    api_key: str | None = None
    model: str = "composer-2.5"
    cwd: str = "."
    runtime: str = "local"
    repo_url: str | None = None
    branch: str | None = None
    auto_create_pr: bool = False
    skip_reviewer_request: bool = False
    resume_agent_id: str | None = None
    dry_run: bool = False
    strict_gates: bool = True
    mcp_servers: list[dict[str, Any]] | None = None


def create_agent(config: DriverConfig):
    if config.dry_run or not config.api_key:
        logger.warning("Using mock agent (dry_run or no CURSOR_API_KEY)")
        return MockAgent()

    try:
        from cursor_sdk import Agent, AgentOptions, CloudAgentOptions, LocalAgentOptions
    except ImportError as exc:
        raise RuntimeError("cursor-sdk not installed: pip install cursor-sdk") from exc

    opts_kwargs: dict[str, Any] = {
        "api_key": config.api_key,
        "model": config.model,
    }
    if config.mcp_servers:
        opts_kwargs["mcp_servers"] = config.mcp_servers

    if config.runtime == "cloud":
        if not config.repo_url:
            raise ValueError("cloud runtime requires repo_url")
        opts_kwargs["cloud"] = CloudAgentOptions(
            repos=[{"url": config.repo_url, "branch": config.branch or "main"}],
            auto_create_pr=config.auto_create_pr,
            skip_reviewer_request=config.skip_reviewer_request,
        )
    else:
        opts_kwargs["local"] = LocalAgentOptions(cwd=config.cwd)

    if config.resume_agent_id:
        return Agent.resume(config.resume_agent_id, AgentOptions(**opts_kwargs))

    return Agent.create(AgentOptions(**opts_kwargs))


def run_prompt(config: DriverConfig, prompt: str) -> DriverResult:
    """One-shot Agent.prompt wrapper."""
    if config.dry_run or not config.api_key:
        agent = MockAgent()
        run = agent.send(prompt)
        return run.wait()

    try:
        from cursor_sdk import Agent, AgentOptions, CloudAgentOptions, LocalAgentOptions, CursorAgentError
    except ImportError as exc:
        raise RuntimeError("cursor-sdk not installed") from exc

    opts_kwargs: dict[str, Any] = {"api_key": config.api_key, "model": config.model}
    if config.runtime == "cloud" and config.repo_url:
        opts_kwargs["cloud"] = CloudAgentOptions(
            repos=[{"url": config.repo_url, "branch": config.branch or "main"}],
            auto_create_pr=config.auto_create_pr,
            skip_reviewer_request=config.skip_reviewer_request,
        )
    else:
        opts_kwargs["local"] = LocalAgentOptions(cwd=config.cwd)

    try:
        result = Agent.prompt(prompt, AgentOptions(**opts_kwargs))
    except CursorAgentError as err:
        print(f"startup failed: {err.message}", file=sys.stderr)
        sys.exit(1)

    if result.status == "error":
        print(f"run failed: {result.id}", file=sys.stderr)
        sys.exit(2)

    return DriverResult(
        agent_id=getattr(result, "agent_id", "prompt"),
        run_id=getattr(result, "id", "prompt-run"),
        status=result.status,
        text=getattr(result, "result", "") or "",
    )


def send_and_wait(agent, prompt: str) -> DriverResult:
    try:
        from cursor_sdk import CursorAgentError
    except ImportError:
        CursorAgentError = Exception  # type: ignore

    try:
        run = agent.send(prompt)
        logger.info("agent_id=%s run_id=%s", getattr(agent, "agent_id", "?"), run.id)
        result = run.wait()
    except CursorAgentError as err:
        print(f"startup failed: {err.message}", file=sys.stderr)
        sys.exit(1)

    status = getattr(result, "status", "finished")
    if status == "error":
        print(f"run failed: {getattr(result, 'id', '?')}", file=sys.stderr)
        sys.exit(2)

    text = ""
    if hasattr(result, "result") and result.result:
        text = str(result.result)

    return DriverResult(
        agent_id=getattr(agent, "agent_id", "unknown"),
        run_id=getattr(result, "id", getattr(run, "id", "unknown")),
        status=status,
        text=text,
    )


def config_from_env(**overrides) -> DriverConfig:
    cfg = DriverConfig(
        api_key=os.environ.get("CURSOR_API_KEY"),
        cwd=overrides.get("cwd", os.getcwd()),
        runtime=overrides.get("runtime", "local"),
        repo_url=overrides.get("repo_url") or os.environ.get("HARNESS_REPO_URL"),
        branch=overrides.get("branch"),
        auto_create_pr=overrides.get("auto_create_pr", False),
        skip_reviewer_request=overrides.get("skip_reviewer_request", False),
        resume_agent_id=overrides.get("resume_agent_id"),
        dry_run=overrides.get("dry_run", False),
        strict_gates=overrides.get("strict_gates", True),
    )
    for k, v in overrides.items():
        if hasattr(cfg, k) and v is not None:
            setattr(cfg, k, v)
    return cfg
