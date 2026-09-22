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
| Citizen | Signed-in residents | Report a problem, my reports (delete or re-analyze an open report of your own), profile |
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
npm test               # unit tests, incl. sign-in, route guard and session renewal
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
| `AI_PROVIDER` | `mock` | `http` for the inference service (`AI_SERVICE_URL`), or `qwen` for a Qwen-VL model through any OpenAI-compatible API (needs `AI_API_KEY`; `AI_MODEL` and `AI_BASE_URL` pick the model and host - defaults are Alibaba Cloud Model Studio; `AI_EXTRA_PARAMS` is an optional JSON object of host-specific request fields. Groq: `AI_BASE_URL=https://api.groq.com/openai/v1`, `AI_MODEL=qwen/qwen3.8-27b`, `AI_EXTRA_PARAMS={"reasoning_effort":"none"}`) |
| `TRAFFIC_PROVIDER` | `mock` | `http` for a real traffic API in TomTom's Flow Segment Data shape (needs `TRAFFIC_API_URL` and `TRAFFIC_API_KEY` - TomTom's own API matches this shape directly and has a free tier) |
| `PLACES_PROVIDER` | `seeded` | `overpass` for public OpenStreetMap data (unreliable - see the provider's own comment), `geoapify` for a real, paid-but-free-tier places API (needs `PLACES_API_KEY`) |
| `WEATHER_ENABLED` | `false` | |
| `WEATHER_PROVIDER` | `mock` | `open-meteo` for real forecasts via [Open-Meteo](https://open-meteo.com) - free for non-commercial use, no signup or API key needed |
| `PRIORITY_WEIGHT_*` | 4.0 / 2.5 / 2.0 / 1.5 | Severity, traffic, location, history |
| `PRIORITY_THRESHOLD_*` | 40 / 70 / 85 | Medium, high, critical bands |
| `RATE_LIMIT_*` | see config.ts | Backed by a `rate_limit_counters` table, not in-memory |
| `CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated. Set to your real site address(es) in production - the localhost default will not do |
| `MAX_UPLOAD_BYTES` | 10 MB | Also enforced by Storage itself (see the `storage_bucket_limits` migration); keep the two in step |

A handful of `SUPABASE_`-prefixed variables (`SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, ...) are auto-injected by
the platform into every Edge Function - `supabase secrets set` refuses to let
a project override that prefix, so `_shared/supabase.ts` reads those
directly rather than expecting them from config.

The live scoring values are visible in the app at **Admin -> Scoring
settings**. They are read-only there on purpose: changing a scoring rule is a
deployment change, which keeps it from being altered silently mid-operation.

### Sessions

Signing in stores two httpOnly cookies: a short-lived access token (one hour
- `jwt_expiry` in `supabase/config.toml`) and the refresh token that renews it.
The Next.js server swaps in a fresh access token when the old one expires
(`resolveSession` in `frontend/src/lib/session.ts`, used by the route guard,
the API proxy and the keep-alive endpoint), so nobody is signed out for being
busy. While a signed-in page is open and being used, the browser pings
`/api/auth/keepalive` every 10 minutes, which slides the cookies' expiry
forward.

Idle users are signed out after **30 minutes**: the open tab does it itself,
and if the tab was simply closed the cookies expire on their own shortly
after. Both numbers live in `frontend/src/lib/session-policy.ts`.

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
  **Run it before deploying the function**: the dashboard and landing-page
  figures call the `kpi_summary()` database function, so a newer function
  against an older database has no stats to show.
- `supabase functions deploy api` bundles and deploys the Edge Function; it
  needs `supabase/functions/api/deno.json` (a function-scoped import map -
  the bundler does not pick up a shared one at `supabase/functions/deno.json`
  without it).
- Set the Edge Function's own secrets with `supabase secrets set` for
  anything beyond the defaults in `_shared/config.ts` (a real AI/traffic
  provider URL, CORS origins for a real frontend domain, and so on).
- Point the frontend's `NEXT_PUBLIC_SUPABASE_URL` /
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` at the same project and deploy it.

### Speed

Most of the time a page takes is waiting on the network, so the app is built to
wait as little and as rarely as it can:

- **Sign-in and page loads read the user's profile directly from Supabase's
  database API**, not through the Edge Function (one request instead of three),
  and remember it for 30 seconds (`frontend/src/lib/session.ts`). A role change
  or deactivation can therefore take up to 30 seconds to show in what a page
  *renders*; the backend still checks the database on every request that reads
  or changes data.
- **Signed-out visitors' reads are cached** for 30 seconds in the Next.js server,
  and a stale answer is served instantly while a fresh one loads
  (`frontend/src/app/api/proxy/[...path]/route.ts`, `ttl-cache.ts`). Signed-in
  users are never served from, or stored in, that shared cache. The
  `x-rw-cache` response header says `hit`, `stale` or `miss`.
- **The Edge Function verifies tokens itself** against the project's public
  signing keys instead of calling the auth server on every request, and works
  out the statistics in one SQL query (`kpi_summary()`) instead of downloading
  every report to count it. A token revoked on the server is honoured once it
  expires (`jwt_expiry`: 1 hour in `config.toml`, but the hosted project was
  created with 12 hours and keeps that until its auth settings are pushed)
  rather than instantly; sign-out clears it from the browser
  at once, and the role and active flag are still read from the database on
  every call.
- Pages show a loading skeleton the moment a link is clicked, and the landing
  page's statistics stream in after the rest of the page.

- **Cold starts** - the first call to an Edge Function that has sat idle takes 2
  to 3 seconds instead of about half a second. `supabase/optional/keep_api_warm.sql`
  keeps one instance running in the regions traffic comes from by asking
  `/api/health` once a minute. It is kept out of `supabase/migrations/` because it
  creates recurring jobs on the database; apply it deliberately (the command
  is in the file's header) if the first-click delay bothers you.

Judge speed on a production build (`npm run build && npm start`), never
`npm run dev`, which compiles each page the first time it is opened.

### Before going live

Things that work on `localhost` and quietly break on a real domain. None of
them can be checked from the code, so go through them once per deployment:

1. **Redirect URLs.** In Supabase (Authentication -> URL Configuration) set the
   Site URL to the deployed address and add both
   `https://<your-domain>/reset-password` and
   `https://<your-domain>/login?confirmed=1` to the redirect allow-list.
   Without them the password-reset and email-confirmation links are rejected.
   `supabase/config.toml` lists the `localhost` pair for local work.
2. **Email confirmation and a real email sender.** `config.toml` turns
   confirmation on (nobody can register an address they do not own). The
   hosted project must have it enabled too - Authentication -> Providers ->
   Email -> "Confirm email", or `npx supabase config push`, which applies
   every value in `config.toml`, so read the diff first. Supabase's built-in
   mailer only reaches project team members and allows a couple of messages an
   hour, so add custom SMTP (Authentication -> SMTP Settings, or the
   `[auth.email.smtp]` block in `config.toml`) before real users register. The
   app works either way: with confirmation off, registering signs the user in
   directly.
3. **CORS.** `supabase secrets set CORS_ORIGINS=https://<your-domain>`.
4. **Migrations.** `npx supabase db push` - in particular the ones that carry
   the phone number through signup and set the upload limits on the Storage
   buckets.
5. **Hosting region.** Every page and every API call crosses the network to
   Supabase several times, and this project's database is in **Tokyo**
   (`ap-northeast-1`), so the app's server functions should run there too -
   `frontend/vercel.json` pins Vercel to `hnd1` (Tokyo). Left on Vercel's default
   (the US), each backend call adds a few hundred milliseconds; measured from
   a plain laptop connection, even a call that touches no database at all
   takes about a third of a second, so distance to the database is what you
   are really paying for. Edge Functions run in whichever region is nearest the
   caller, so with the app server in Tokyo they run in Tokyo, next to the
   database. If you ever move the database, move this with it.
6. **Upload size.** Photos are limited to 10 MB. Serverless hosts cap request
   bodies well below that (Vercel: 4.5 MB), so the browser shrinks any photo
   over 3 MB to 1600 px before sending it (`frontend/src/lib/shrink-image.ts`),
   which is what the backend would do to it anyway. Repair evidence with many
   large photos in one submission can still exceed a host's cap; if that
   happens, submit them in smaller batches.
