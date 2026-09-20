# RoadWatch AI

AI-assisted road damage reporting and prioritisation for citizens and municipal
authorities.

A citizen photographs a pothole. The system identifies the damage, estimates how
bad it looks, weighs it against traffic, nearby hospitals and schools, and the
reporting history at that spot, and produces a 0-100 priority recommendation the
works department can rank by - and can interrogate, because every point in the
score is shown and explained.

> Priority scores are **AI-assisted recommendations for review by authorised
> personnel**, not decisions. Severity is estimated from a photograph and is not
> an engineering inspection: a standard RGB photo carries no depth information,
> so nothing here measures how deep a pothole is.

## What is in the box

| Surface | For | Routes |
|---|---|---|
| Public site | Anyone | Landing, city map, browse reports, report detail |
| Citizen | Signed-in residents | Report a problem, my reports, profile |
| Crew console | Repair teams | Today, all jobs, job detail with evidence upload |
| Works department | Administrators | Dashboard, queue, report detail, duplicates, analytics, teams, audit, scoring settings |

Two services: a **Next.js** frontend, and a **Supabase** project (Postgres +
Auth + Storage + one Edge Function) that owns every rule, score and
permission check. There is also a small, optional standalone **inference
service** (`ai-service/`) that only turns images into detections - the
backend defaults to a deterministic mock instead of calling it. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how the pieces fit and why
the boundaries sit where they do.

> This project ran on a FastAPI + Neon + Render backend until it was migrated
> onto Supabase (Postgres, Auth, Storage, Edge Functions). The FastAPI
> backend (`backend/`) has been removed; everything it did now lives in
> `supabase/migrations/` (schema, RLS policies, `security definer` RPCs) and
> `supabase/functions/api/` (the Edge Function, ported route-for-route).

## Quick start

Nothing needs to be containerised, and there is no local database to stand
up - the backend is a hosted Supabase project.

**Frontend:**

```bash
cd frontend
cp .env.example .env.local   # NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY
npm install
npm run dev
```

The web app comes up on <http://localhost:3000> and talks straight to the
live Supabase project (Edge Function + Auth) named in `.env.local` - there is
nothing else to start.

**Inference service** (optional - the AI provider defaults to `AI_PROVIDER=mock`):

```bash
cd ai-service
pip install -r requirements.txt      # add requirements-ml.txt for real YOLO
uvicorn app.main:app --reload --port 8001
```

**Backend changes** (schema, RLS policies, RPC functions, or the Edge
Function's own code) are made under `supabase/` and applied with the
Supabase CLI:

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push                  # apply pending migrations
npx supabase functions deploy api     # deploy the Edge Function
```

## Development

```bash
# Frontend
cd frontend
npm run typecheck
npm run lint
npm test               # 44 tests
npm run build

# Edge Function - type-check every file (no bundler step; Deno reads TS directly)
deno check --config supabase/functions/deno.json $(find supabase/functions/api -name "*.ts")

# Edge Function - unit tests for the scoring engines, geo math and serializers
# (run from supabase/functions/, not supabase/functions/api/, so the lockfile
# update lands in the tracked supabase/functions/deno.lock)
cd supabase/functions && deno task test
```

Every external dependency the Edge Function calls (AI, traffic, places,
weather) sits behind a small provider interface with a factory and a
deterministic mock, the same pattern the old FastAPI backend used - so a
deployment can start on mocks and adopt real sources one at a time.

## Configuration

The frontend needs `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (see `.env.example`). The publishable
key is meant to be public; only the Next.js server reads either value today
(the browser never calls Supabase directly - it goes through `/api/proxy/*`
and `/api/auth/*`, which attach the session token server-side so it stays
out of reach of page scripts).

The Edge Function reads its settings from environment variables set via
`supabase secrets set` (see `supabase/functions/api/_shared/config.ts` for
every key and its default). The values that matter most:

| Variable | Default | Notes |
|---|---|---|
| `AI_PROVIDER` | `mock` | `http` to use the inference service (`AI_SERVICE_URL`) |
| `TRAFFIC_PROVIDER` | `mock` | |
| `PLACES_PROVIDER` | `seeded` | `overpass` for live OpenStreetMap data |
| `WEATHER_ENABLED` | `false` | |
| `PRIORITY_WEIGHT_*` | 4.0 / 2.5 / 2.0 / 1.5 | Severity, traffic, location, history |
| `PRIORITY_THRESHOLD_*` | 40 / 70 / 85 | Medium, high, critical bands |
| `RATE_LIMIT_*` | see config.ts | Backed by a `rate_limit_counters` table, not in-memory |

A handful of `SUPABASE_`-prefixed variables (`SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, ...) are auto-injected by
the platform into every Edge Function - `supabase secrets set` refuses to let
a project override that prefix, so `_shared/supabase.ts` reads those
directly rather than expecting them from config.

The live scoring values are visible in the app at **Admin -> Scoring
settings**. They are read-only there on purpose: changing a scoring rule is a
deployment change, which keeps it from being altered silently mid-operation.

## Repository layout

```
supabase/     Postgres schema + RLS policies + RPC functions (migrations/),
              and the Edge Function itself (functions/api/) - routes,
              services, providers, repositories, ported 1:1 from the old
              FastAPI app's structure
ai-service/   Inference only, optional: image in, detections out
frontend/     Next.js App Router, React Query, Tailwind
docs/         Architecture notes
```

## Deploying

The frontend deploys as an ordinary Next.js app (this project deploys to
Vercel). The backend is the Supabase project itself - `supabase db push` and
`supabase functions deploy api` are the only "deploy" steps, there is no
process manager or container to run:

- `supabase db push` applies every migration under `supabase/migrations/` in
  order - schema, RLS policies, and RPC functions are all plain SQL files.
- `supabase functions deploy api` bundles and deploys the Edge Function; it
  needs `supabase/functions/api/deno.json` (a function-scoped import map -
  the bundler does not pick up a shared one at `supabase/functions/deno.json`
  without it).
- Set the Edge Function's own secrets with `supabase secrets set` for
  anything beyond the defaults in `_shared/config.ts` (a real AI/traffic
  provider URL, CORS origins for a real frontend domain, and so on).
- Point the frontend's `NEXT_PUBLIC_SUPABASE_URL` /
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` at the same project and deploy it.
