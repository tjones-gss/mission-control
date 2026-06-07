# Interactive cockpit in a container

Runs the **full, interactive** Oversight cockpit in one container — spawn, drive,
and approve Claude Code agents from your browser — using your existing Claude
subscription auth. The apps those agents build land on your host disk under
`WORKSPACE_DIR`.

This is the dev flow (`npm run up`: Express `:3001` + Vite `:5173`) running inside
a container that also has the `claude` CLI installed. The browser talks to Vite;
Vite proxies `/api` to Express. **No cockpit source code is changed.**

## Run it

```bash
cp docker/.env.example docker/.env   # then edit CLAUDE_DIR / WORKSPACE_DIR
npm run up:docker                    # == docker compose -f docker/docker-compose.yml up --build
```

Open <http://localhost:5173>.

To stop: `Ctrl-C`, or `docker compose -f docker/docker-compose.yml down`.

## Drive your first build

1. Open <http://localhost:5173>. Your existing sessions render immediately
   (read from the mounted `~/.claude`).
2. Click **+** (new session). Set **working directory** to `/workspace/<app-name>`
   and write a build prompt.
3. Watch it think and call tools live. Approve tools from the amber banner.
4. The app's files appear in `/workspace` inside the container — i.e. your host
   `WORKSPACE_DIR`.

> Paths in the dashboard are *container* paths. Home is `/root`; your build area
> is `/workspace`.

## Auth

The container's `claude` reads `~/.claude/.credentials.json` from the bind mount,
and can refresh the token there. If it ever reports as unauthenticated:

```bash
# one-time interactive login inside the container
docker compose -f docker/docker-compose.yml exec oversight claude
# ...or provide an API key instead, via docker/.env:
#   ANTHROPIC_API_KEY=sk-ant-...
```

## Caveats

- **Don't run a host Claude Code session against the same `~/.claude` at the same
  time** — both processes writing `~/.claude/.claude.json` can contend on its
  lockfile. Drive agents through the container while it's up.
- File-watching uses polling (`CHOKIDAR_USEPOLLING=true`) because native inotify
  is unreliable across Docker Desktop bind mounts. That's why the live feed works
  but costs a little CPU.
- Only the Vite UI is published, and only to `127.0.0.1` — no LAN exposure.
