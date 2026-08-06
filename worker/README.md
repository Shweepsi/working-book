# Working Book API (Cloudflare Worker)

Persists logbook, production-test and suivi data into D1 behind a thin JSON
HTTP API. Two environments share the same Worker code:

| env          | Worker name              | D1 database         | D1 ID                                      | Used by                                          |
| ------------ | ------------------------ | ------------------- | ------------------------------------------ | ------------------------------------------------ |
| `dev`        | `working-book-api-dev`   | `working-book-dev`  | `67d3ea83-4067-495e-97e0-02dd46f18cbe`     | GitHub Pages preview build, `wrangler dev`, local |
| `production` | `working-book-api`       | `working-book-prod` | `98426291-1638-4dfa-94a7-63109c5300fc`     | Cloudflare Pages production build                |

The front end is built against one of the two, and CI tells it which through
`VITE_CHANNEL` (`prod` on `main`, `dev` everywhere else) alongside
`VITE_API_URL`. Anything gated on the dev channel — today the Logbook, Test and
Cosmétique tabs — therefore appears in the Pages previews and in `npm run dev`,
never on <https://working-book.pages.dev>. A local `npm run build` with no
`VITE_CHANNEL` set builds as production; pass `VITE_CHANNEL=dev npm run build`
to check a preview bundle.

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
- `GET  /api/policy` → `{ data: PolicyResult | null, updated_at }` — MTO/MTS lookup, always synced
- `PUT  /api/policy` body: `PolicyResult`
- `GET  /api/schedules` → `{ data: PMS230Result | null, updated_at }` — PMS230 report, gated by local/sync toggle
- `PUT  /api/schedules` body: `PMS230Result | null`
- `POST /api/schedules/ingest` body: `{ text: string }` — direct import, always additive (see below)
- `GET  /api/speeds` → `{ data: Record<schedule, number> | null, updated_at }` — coater speed (m/min) per schedule
- `PUT  /api/speeds` body: `Record<schedule, number>`
- `GET  /api/archives` → `{ data: Record<schedule, ISO date> | null, updated_at }` — schedules retirés du planning
- `PUT  /api/archives` body: `Record<schedule, ISO date>`
- `GET  /api/updates[?date=…&poste=…&shift=…]` → `{ data: Record<domain, number | null>, updated_at }` — change probe, see below

Conflict policy is last-write-wins per partition; the Worker overwrites the
stored JSON wholesale on every `PUT`.

## Change probe

`GET /api/updates` answers with nothing but the `updated_at` of each partition,
keyed by the domain names the front uses (`suivi`, `policy`, `schedules`,
`speeds`, `archives`, plus `logbook` / `prodtest` when the matching params are
supplied). A couple of hundred bytes against a report blob past a hundred
kilobytes: that
ratio is what lets a client poll on a short interval and only fetch a partition
whose stamp has actually moved. The reply is `Cache-Control: no-store` — a
cached probe would pin a tab on a stale timestamp.

Clients poll it while the tab is visible and stop entirely when it is hidden
(`src/lib/sync.ts`); a partition opts in with `useSyncedState(..., { live: true })`.

## Direct import from the Infor portal

`POST /api/schedules/ingest` takes a raw Operator Mashup dump instead of a
parsed report. It runs `parsePMS230` — the same module the paste sheet imports,
so no route can drift from the others — and merges the result into the shared
report. Two callers: the "Import direct" bookmarklet the app generates
(Schedule → *Importer rapport Operator Mashup* → *⇱ Import direct*), which
reads the operator's clipboard, and the browser extension in `extension/`,
which reads the M3 grid directly. Both run inside the operator's already
authenticated session; the Worker never talks to Infor and holds no Infor
credentials.

**Every import adds.** There is no replace and no mode parameter: an operator
walking a multi-page report, or re-importing after a fresh search, only ever
wants more rows. `mergePMS230` keys on `schedule|MO`, so re-sending a page
updates those rows in place instead of duplicating them. Taking a schedule out
of the planning is a deliberate act, done from the Schedule tab — and it retires
the schedule (`/api/archives`) rather than deleting it, so a re-import of the
same number stays out of the rail until somebody puts it back.

A dump that yields no decodable row answers `422 no_records` and leaves the
stored report alone, so a mis-click on the wrong screen can't damage it.

There is no auth on it, deliberately: the whole API is unauthenticated, so a
token on this one endpoint would have locked one door of an open house while
costing every operator a value to copy into their bookmarklet and extension.

One optional setting governs it:

| Setting          | Kind | Default                 | Meaning |
| ---------------- | ---- | ----------------------- | ------- |
| `INGEST_ORIGINS` | var  | `*.inforcloudsuite.com` | Extra CORS origins accepted **on this endpoint only** — the other routes keep `ALLOWED_ORIGINS` untouched. |

Note that CORS is no defence against non-browser clients; it only keeps other
web pages from posting here on an operator's behalf. If this ever needs real
protection, it belongs in front of the whole API, not on this route alone.
