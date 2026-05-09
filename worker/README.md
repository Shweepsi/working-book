# Working Book API (Cloudflare Worker)

Persists logbook, production-test and suivi data into D1, behind a thin
JSON HTTP API. Two environments share the same Worker code:

| env          | Worker name              | D1 database         | Used by                                          |
| ------------ | ------------------------ | ------------------- | ------------------------------------------------ |
| `dev`        | `working-book-api-dev`   | `working-book-dev`  | GitHub Pages preview build, `wrangler dev`, local |
| `production` | `working-book-api`       | `working-book-prod` | Cloudflare Pages production build                |

## First-time setup

```bash
cd worker
npm install
npx wrangler login

# Create the two D1 databases — copy the printed IDs into wrangler.toml.
npm run db:create:dev
npm run db:create:prod

# Apply schema migrations (initial table creation) to both remotes.
npm run db:migrate:dev
npm run db:migrate:prod

# Deploy.
npm run deploy:dev
npm run deploy:prod
```

After deploying, note both Worker URLs (e.g. `https://working-book-api-dev.<your-account>.workers.dev`)
and register them as `VITE_API_URL_DEV` / `VITE_API_URL_PROD` repository secrets so the
front-end CI can inject them at build time.

## Local development

```bash
# Start the Worker locally with the dev D1 (uses local SQLite by default).
npm run dev

# Apply migrations to the local sandbox.
npm run db:migrate:dev:local
```

When `wrangler dev` is running, point the front at it with
`VITE_API_URL=http://127.0.0.1:8787 npm run dev` from the repo root.

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
