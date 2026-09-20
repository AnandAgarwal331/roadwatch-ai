# RoadWatch AI - architecture

A citizen photographs a road problem. The system works out what it is, how bad
it looks, and how much it matters relative to everything else waiting; a works
department triages from that ranking; a repair crew closes it out with evidence.

This document covers how the pieces fit and, more importantly, *why* the
boundaries sit where they do.

## Services

```
                    browser
                       |
                       |  same-origin only
                       v
        +------------------------------+
        |  web  (Next.js, port 3000)   |
        |  - renders every surface     |
        |  - /api/proxy/* attaches the |
        |    session token server-side |
        +---------------+--------------+
                        |  Authorization: Bearer ... + apikey
                        v
        +----------------------------------------------+
        |  Supabase project                             |
        |  +------------------------------------------+ |        +--------------------+
        |  |  api  (Edge Function, Deno/Hono)          | |------->|  ai  (port 8001)   |
        |  |  - routes/*.ts: auth, complaints, admin,  | | image  |  - detections only |
        |  |    map, team, notifications, public       | |<-------|  optional, mocked  |
        |  |  - services/*.ts: severity, priority,     | |        |  by default        |
        |  |    duplicates, assessment orchestration   | |        +--------------------+
        |  +--------------------+-----------------------+ |
        |                       |  RLS-scoped (publishable    |
        |                       |  key + caller's JWT), or    |
        |                       |  service-role for system-   |
        |                       |  level reads/writes          |
        |                       v                              |
        |  Postgres  +  Row Level Security  +  security       |
        |  definer RPCs (create_complaint, persist_assessment, |
        |  check_rate_limit, ...)  +  Storage  +  Auth          |
        +----------------------------------------------+
```

Split along the lines that actually change independently:

- **web** owns presentation and the session cookie. It holds no business rules.
- **the Edge Function** owns every rule, every score and every permission
  check made in code - the same responsibility FastAPI used to have, ported
  route-for-route (`supabase/functions/api/routes/*.ts` mirrors the old
  `app/api/v1/*.py` routers, `services/*.ts` mirrors `app/services/*.py`).
- **Postgres itself, via Row Level Security**, is the actual authorization
  boundary underneath the Edge Function - not a bypass connection. Ordinary
  reads/writes run as the calling user through RLS policies; anything too
  complex for a row-level policy (creating a complaint, the atomic
  multi-table assessment write, admin status transitions) is a `security
  definer` Postgres function instead, so the elevated privilege is scoped to
  one auditable function rather than a whole connection.
- **ai** owns inference and nothing else - no database, no auth, no judgement.
  It answers "what do you see in this image" and stops there. It's optional:
  the Edge Function defaults to a deterministic mock provider and only calls
  out to this service when `AI_PROVIDER=http`.

The AI boundary is the one worth defending, same as before the migration:
because it makes no decisions, it can be scaled separately, moved to a GPU
host, or swapped for a different model without touching a single business
rule. Severity, priority and duplicate detection all live in the Edge
Function, where they're deterministic and unit-tested (`deno task test` -
see `supabase/functions/api/services/*.test.ts`), without a model in the
loop.

## How a report flows

1. **Submit.** The citizen posts a photo, coordinates and an optional
   description. The image is validated by type and size, stripped of EXIF,
   resized, and stored through the storage provider.
2. **Detect.** `api` sends the image to `ai`, which returns damage-class
   detections with confidences and bounding boxes.
3. **Severity.** `api` turns those detections into a 0-10 *visual* severity
   estimate from the damage class, the detector confidence, the damaged area
   ratio, and how many distinct damaged regions there are.
4. **Context.** In parallel it gathers traffic level, nearby places (hospitals,
   schools, bus stops, major junctions) and the reporting history at that spot.
5. **Priority.** The four factors are combined into a 0-100 recommendation.
6. **Duplicates.** Nearby recent reports of a similar kind are flagged as
   possible duplicates for a human to confirm or dismiss.
7. **Triage, repair, verify.** An administrator assigns a crew; the crew starts
   the job and submits completion photos; an administrator verifies, which
   resolves the report and notifies the reporter.

Every step is written to an audit trail with the account that caused it.

## The priority engine

```
priority_score = severity * 4.0    (40%)
               + traffic  * 2.5    (25%)
               + location * 2.0    (20%)
               + history  * 1.5    (15%)
```

Each factor is normalised to 0-10, so the maximum is 100. Bands: below 40 is
low, 40+ medium, 70+ high, 85+ critical. Weights and thresholds are
configuration rather than constants, so a city can retune them without a code
change; the live values are visible at **Admin -> Scoring settings**.

Two properties are load-bearing.

**It is explainable.** Every factor value, its weight and its point contribution
are persisted alongside the score and returned by the API, so the interface can
always answer "why is this 86.5?" A score a municipal officer cannot interrogate
is a score they cannot defend, and therefore will not use.

**It is a recommendation, not a decision.** The output is a ranking aid. The
final call belongs to authorised personnel, an administrator can override any
score with a recorded reason, and every surface that displays a score says so in
so many words.

### Why a weighted model rather than a learned one

There is no training data at the start: ranking quality can only be learned from
the resolution history a deployment has not yet produced. A transparent weighted
model is honest about that, works from day one, and is auditable.

The factor vector is deliberately the feature vector a learned ranker would
consume. `ENGINE_VERSION` (`weighted-v1`) is stored on every assessment, so when
a model is trained on accumulated outcomes, old and new scores stay
distinguishable and comparable.

## What the system does not claim

An ordinary RGB photograph carries no depth information. Severity is therefore
an estimate of how bad damage *looks*, not a measurement of how deep a pothole
is or how structurally compromised a road is. The severity service says this in
its own docstring, the API description repeats it, and the interface carries the
disclaimer everywhere a severity or priority value appears. This is a
correctness requirement, not a legal decoration.

## Authentication and authorisation

The access token is a JWT issued by **Supabase Auth**, not by application
code - login/register/logout call GoTrue (Supabase Auth's REST API) directly
from the Next.js route handler rather than through the Edge Function, since
they *are* what Supabase Auth already is. The token is stored in an
**httpOnly**, `SameSite=Lax` cookie and is never exposed to client
JavaScript - which is exactly what `localStorage` would fail to do.

The browser never calls the Edge Function directly. It calls `/api/proxy/*`
on its own origin; that route reads the cookie server-side and attaches the
`Authorization` header (plus the publishable key as `apikey`, which
Supabase's own gateway requires in front of the function). A second,
non-sensitive cookie carries only the role so `proxy.ts` (Next.js 16 renamed
the "middleware" file convention to "proxy" - unrelated to the `/api/proxy/*`
route above, which predates the rename and does something entirely
different) can route without a round-trip.

Authorisation is layered, and each layer is honest about its job:

| Layer | What it is for | What it is *not* |
|---|---|---|
| `proxy.ts` | Sends signed-out visitors to login, and each role to its own home | Not a security boundary; the role cookie is a routing hint |
| Layout `getCurrentUser()` | Verifies the session against `/auth/me` before rendering a console | Still not the last word |
| Row Level Security + `_shared/auth.ts` | The real check, re-run on every single request - the role is re-read from `profiles` every time, never trusted from the JWT | - |

Forging the role cookie gets you a page that fails to load its data. Every
admin route in `routes/admin.ts` calls `requireAdmin(req)` as its first line
(Hono has no router-level dependency injection the way FastAPI did, so this
is the closest equivalent - still enforced on every handler, just written
explicitly rather than declared once). Crews read their team from their own
profile row, never from a request parameter, so one crew cannot reach
another's jobs by guessing an id.

Throughout, "not found" and "not yours" return the same response, so ids
cannot be probed for existence.

## Providers

Every external dependency sits behind a small interface with a factory and at
least two implementations - usually a real one and a deterministic mock, the
same pattern before and after the migration:

| Provider | Options |
|---|---|
| AI | `mock`, `http` (the optional standalone inference service), `qwen` (Qwen-VL via an OpenAI-compatible API; approximate boxes, self-reported confidence - measure before trusting) |
| Traffic | `mock`, `http` |
| Places | `seeded`, `overpass` (public OpenStreetMap, blocks automated traffic in practice), `geoapify` (real data, free-tier API key) |
| Storage | Supabase Storage only (`complaint-photos` public bucket, `repair-evidence` private bucket) |
| Weather | `mock` (off by default) |

This is what lets a deployment start on mocks and adopt real sources one at a
time. The mock traffic and weather providers are deterministic via SHA-256
hashing and were verified bit-for-bit identical to the original Python
output during the migration; the mock AI provider intentionally is not (it's
an explicitly-labelled "not a trained model" dev stub, so only the
deterministic-per-photo property matters).

## Data model

Defined in `supabase/migrations/*_initial_schema.sql` (plain DDL, enums as
`text` + `check` constraints rather than native Postgres enums, so adding a
value later is an `ALTER TABLE`, not an `ALTER TYPE`):

- `profiles` - citizen, admin or repair crew; crews carry a `team_id`. Extends
  `auth.users` (same UUID) instead of owning its own password - replaces the
  old `User` model now that Supabase Auth issues credentials.
- `complaints` - the report, its status, its scores and its numbering. Soft
  deletable (`deleted_at`) by the reporter via `delete_own_complaint`, but
  only before the report is closed (assigned, in progress, resolved,
  rejected or marked a duplicate) - see that migration's own comment.
  Deleted rows stay visible to admins by direct id, invisible everywhere
  else (every listing, the map, duplicate/history matching).
- `complaint_images` - the stored photo and its thumbnail, in Supabase Storage.
- `ai_analyses` / `ai_detections` - detections and the model that produced them.
- `priority_assessments` - the score, the factor breakdown and the engine version.
- `repair_teams` / `repair_assignments` / `repair_evidence` - the repair side.
- `potential_duplicates` - a suggested link awaiting a human decision.
- `complaint_status_history` / `audit_logs` / `notifications` - the record of
  what happened.
- `rate_limit_counters` - the shared rate-limit state stateless Edge Functions
  need in place of the old in-memory counter; touchable only through the
  `check_rate_limit` RPC, never directly (RLS enabled, no policies).

Geographic queries use a bounding-box prefilter followed by an exact haversine
distance, which stays correct without requiring PostGIS - unchanged by the
migration, since it was already plain application-level math.

## Frontend structure

```
src/app/(public)     landing, map, browse, report, my reports, profile
src/app/(auth)       login, register
src/app/admin        works-department console
src/app/team         repair-crew console
src/app/api          session routes and the authenticated proxy
src/components       design system, domain badges, dashboard shell, chart kit
src/features         one folder per workflow
```

Server components resolve the session and gate the consoles; client components
own interaction and data fetching through React Query. Domain vocabulary -
labels, colours, disclaimers - lives once in `lib/constants.ts` so the queue,
the map, the charts and the citizen views cannot drift apart.

### Charts

Charts follow a small set of rules, applied consistently:

- **Categorical colour is capped at three series**, using the Okabe-Ito core
  (blue / vermillion / bluish-green). Every pair clears the colour-vision
  separation threshold in both light and dark mode. A fourth measure becomes a
  second chart or folds into a residual bucket rather than getting an invented
  hue.
- **Magnitude comparisons use one hue.** When the category is already on the
  axis, colouring it again adds nothing.
- **Priority is ordinal, so it gets a one-hue ramp** running low to critical,
  not four competing hues.
- **Dark mode is stepped, not flipped** - each mode has its own values, checked
  against its own surface.
- **Every chart has a table view**, so no number is reachable only by hovering a
  colour, and a legend is always present for two or more series.

The palettes are not eyeballed: they were checked with a validator for
lightness banding, chroma, colour-vision separation and contrast, and the
reasoning is recorded in comments in `lib/constants.ts`.
