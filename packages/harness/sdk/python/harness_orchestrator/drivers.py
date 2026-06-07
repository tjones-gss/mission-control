from __future__ import annotations

from harness_orchestrator import claude_driver, cursor_driver

# Runtime selector. `runtime` on DriverConfig picks the backend:
#   - "local" / "cloud"  -> Cursor SDK driver (cursor_driver)
#   - "claude"           -> Claude Code CLI driver (claude_driver)
# The loop imports create_agent/run_prompt/send_and_wait from here so adding a
# backend is a one-line dispatch, not a change at every call site.


def _driver(config):
    if getattr(config, "runtime", "") == "claude":
        return claude_driver
    return cursor_driver


def create_agent(config):
    return _driver(config).create_agent(config)


def run_prompt(config, prompt):
    return _driver(config).run_prompt(config, prompt)


def send_and_wait(agent, prompt):
    # send_and_wait only receives the agent (not config), so dispatch on the
    # agent type. A real Claude session routes to the Claude driver; everything
    # else (Cursor agents and the shared MockAgent) uses the Cursor path, whose
    # send_and_wait already handles MockAgent.
    if isinstance(agent, claude_driver.ClaudeAgent):
        return claude_driver.send_and_wait(agent, prompt)
    return cursor_driver.send_and_wait(agent, prompt)
