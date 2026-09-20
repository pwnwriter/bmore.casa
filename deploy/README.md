# Deploying bmore.casa

One domain, two processes behind Caddy ([`bmore.casa.caddy`](bmore.casa.caddy)):

| Path | Process | Port |
|---|---|---|
| `/` | Next.js app | 3003 |
| `/notebook` | marimo notebook in read-only app mode | 2718 |

```bash
# web app
cd web
bun install && bun run build
PORT=3003 bun run start

# notebook
cd notebook
uv sync --locked
uv run marimo run baltimore.py --headless --no-sandbox --host 127.0.0.1 --port 2718 \
    --base-url /notebook --include-code --no-token --no-skew-protection --session-ttl 120
```

Then copy `bmore.casa.caddy` into Caddy's config directory, `systemctl reload caddy`, and check that
`https://bmore.casa/notebook/health` returns 200. API keys go in `web/.env` (all optional, see the main
README); the notebook needs none.

The notebook is started with `--base-url /notebook`, so Caddy passes the prefix through instead of
stripping it, and proxies the WebSocket without extra configuration. Visitors can use every control and
read the code (`--include-code`) but cannot edit or execute anything else. Each open tab gets its own
Python session, closed 120 s after the tab disconnects.

`--no-skew-protection` matters for a public link: without it, any tab that was open before a restart keeps
sending the old server token, every control update is rejected ("invalid server token" in the log) and the
page silently stops reacting until it is reloaded. `--no-sandbox` skips the interactive sandbox prompt and uses
the locked project environment from `uv sync`.

> [!CAUTION]
> Only ever expose `marimo run`. `marimo edit` lets anyone who can reach it execute arbitrary code on the server.
