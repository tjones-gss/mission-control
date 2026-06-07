# Interactive Mission Control cockpit — single container running the full
# `npm run up` dev flow (Express API :3001 + Vite UI :5173) with the `claude`
# CLI installed so agents can be spawned and driven from the browser.
#
# Build context MUST be the repo root (see docker/docker-compose.yml) because the
# canonical installer (installers/setup.mjs) installs the root workspaces
# (apps/cockpit + packages/contracts) plus the cockpit's own server/ and client/.
FROM node:22-bookworm

# Native toolchain for node-pty (PTY messaging) + git for the agents' builds.
# ripgrep ships inside the claude CLI, so it is not installed separately.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# The Claude Code CLI the cockpit shells out to (`claude -p`, `claude --resume`).
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# Husky sets up git hooks in a `prepare` script; there is no .git in the build
# context, so disable it to keep `npm install` clean.
ENV HUSKY=0

# Copy the whole monorepo, then run the project's own installer. setup.mjs is
# idempotent and installs: root workspaces, apps/cockpit/server, apps/cockpit/client.
COPY . .
RUN node installers/setup.mjs

# Vite (UI) is the only port the host browser reaches; Express stays on
# 127.0.0.1 inside the container and is reached only via Vite's /api proxy.
EXPOSE 5173

ENTRYPOINT ["bash", "docker/entrypoint.sh"]
