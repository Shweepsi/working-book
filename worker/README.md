# Working Book API (Cloudflare Worker)

Persists logbook, production-test and suivi data into D1 behind a thin JSON
HTTP API. Two environments share the same Worker code:

| env          | Worker name              | D1 database         | D1 ID                                      | Used by                                          |
| ------------ | ------------------------ | ------------------- | ------------------------------------------ | ------------------------------------------------ |
| `dev`        | `working-book-api-dev`   | `working-book-dev`  | `67d3ea83-4067-495e-97e0-02dd46f18cbe`     | GitHub Pages preview build, `wrangler dev`, local |
| `production` | `working-book-api`       | `working-book-prod` | `98426291-1638-4dfa-94a7-63109c5300fc`     | Cloudflare Pages production build                |

Both D1 databases live in region `WEUR` and already have the `0001_init.sql`
schema applied (provisioned through the Cloudflare MCP connector). `account_id`
is hard-coded in `wrangler.toml`.

## What CI needs (one-off)

Add the following repository secrets in GitHub Settings → Secrets and variables
→ Actions:

| Secret                | Value |
| --------------------- | ----- |
| `CLOUDFLARE_API_TOKEN`  | Cloudflare API token with `Workers Scripts: Edit`, `D1: Edit`, `Cloudflare Pages: Edit` (create at <https://dash.cloudflare.com/profile/api-tokens>) |
| `CLOUDFLARE_ACCOUNT_ID` | `5ed16f85af827a8d3c10bc075a66e4fb` |
| `VITE_API_URL_DEV`      | URL of the deployed dev Worker (e.g. `https://working-book-api-dev.<subdomain>.workers.dev`) |
| `VITE_API_URL_PROD`     | URL of the deployed prod Worker (e.g. `https://working-book-api.<subdomain>.workers.dev`) |

Until `CLOUDFLARE_API_TOKEN` is set, the `Deploy to Cloudflare (production)`
workflow skips itself; nothing fails.

## Local development

```bash
cd worker
npm install
npx wrangler login

# Start the Worker locally with the dev D1 (uses the local SQLite sandbox).
npm run dev

# Apply migrations to the local sandbox if you reset it.
npm run db:migrate:dev:local
```

When `wrangler dev` is running, point the front at it from the repo root with:

```bash
VITE_API_URL=http://127.0.0.1:8787 npm run dev
```

## Manual ops (only if needed)

```bash
# Re-apply migrations to the remote D1s (idempotent, IF NOT EXISTS).
npm run db:migrate:dev
npm run db:migrate:prod

# Manual deploy.
npm run deploy:dev
npm run deploy:prod
```

## API surface

All endpoints accept and return JSON. Keys are positional (no auth).

- `GET  /api/health` — liveness check
- `GET  /api/logbook?date=YYYY-MM-DD&poste=A|B|C|D` → `{ data: LogEvent[] | null, updated_at }`
- `PUT  /api/logbook?date=...&poste=...` body: `LogEvent[]`
- `GET  /api/prodtest?date=YYYY-MM-DD&shift=M|A|N|R` → `{ data: TestState | null, updated_at }`
- `PUT  /api/prodtest?date=...&shift=...` body: `TestState`
- `GET  /api/suivi` → `{ data: SuiviState | null, updated_at }`
- `PUT  /api/suivi` body: `SuiviState`

Conflict policy is last-write-wins per partition; the Worker overwrites the
stored JSON wholesale on every `PUT`.
