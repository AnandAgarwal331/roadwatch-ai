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

Three services: a **Next.js** frontend, a **FastAPI** backend that owns every
rule and score, and a small **inference service** that only turns images into
detections. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how they fit
and why the boundaries sit where they do.

## Quick start

Three terminals. Nothing needs to be containerised: the backend runs on a local
SQLite file and every external dependency has a deterministic mock, so the whole
system comes up with a Python venv and an `npm install`.

**Backend:**

```bash
cd backend
python -m venv .venv && . .venv/Scripts/activate   # Linux/macOS: . .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
alembic upgrade head
python -m app.seed                                  # synthetic demo data
uvicorn app.main:app --reload --port 8000
```

**Inference service** (optional - the backend defaults to `AI_PROVIDER=mock`):

```bash
cd ai-service
pip install -r requirements.txt      # add requirements-ml.txt for real YOLO
uvicorn app.main:app --reload --port 8001
```

**Frontend:**

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

The web app comes up on <http://localhost:3000> and the API on
<http://localhost:8000>, with interactive API docs at `/docs`.

### Demo accounts

After seeding, every account uses the password `Password123`:

| Role | Email |
|---|---|
| Administrator | `admin@roadwatch.example` |
| Citizen | `priya.sharma@example.com` |
| Repair crew | `ravi.kumar@roadwatch.example` |

All seeded data is synthetic. It is not government data.

## Development

```bash
# Backend
cd backend
pytest                 # 174 tests
ruff check .

# Frontend
cd frontend
npm run typecheck
npm run lint
npm test               # 44 tests
npm run build
```

The backend test suite runs with no network and no model: every external
dependency sits behind a provider interface with a deterministic mock. That is
also what lets a deployment start on mocks and adopt real traffic, places and
inference sources one at a time.

## Configuration

The backend reads its settings from the environment (see
`backend/app/core/config.py`). The values that matter most:

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | SQLite file | PostgreSQL is required in production; the app refuses to start on SQLite there |
| `AUTH_SECRET` | dev-only value | Must be set outside development. Changing it signs everyone out |
| `CORS_ORIGINS` | `localhost:3000` | Must list origins exactly; a wildcard is rejected because the API sends credentials |
| `AI_PROVIDER` | `mock` | `http` to use the inference service |
| `TRAFFIC_PROVIDER` | `mock` | |
| `PLACES_PROVIDER` | `seeded` | `overpass` for live OpenStreetMap data |
| `STORAGE_PROVIDER` | `local` | `s3` for object storage |
| `PRIORITY_WEIGHT_*` | 4.0 / 2.5 / 2.0 / 1.5 | Severity, traffic, location, history |
| `PRIORITY_THRESHOLD_*` | 40 / 70 / 85 | Medium, high, critical bands |

The live values are visible in the app at **Admin -> Scoring settings**. They
are read-only there on purpose: changing a scoring rule is a deployment change,
which keeps it from being altered silently mid-operation.

The frontend needs only `BACKEND_INTERNAL_URL` - the address its server uses to
reach the API. The browser never calls the API directly; it goes through
`/api/proxy/*`, which attaches the session token server-side so the token stays
out of reach of page scripts.

## Repository layout

```
backend/      FastAPI: models, repositories, services, providers, migrations, tests
ai-service/   Inference only: image in, detections out
frontend/     Next.js App Router, React Query, Tailwind
docs/         Architecture notes
```

## Deploying

There is no container setup in the repository - the project is run directly, as
above. For a real deployment the pieces that have to change are configuration
rather than code:

- Point `DATABASE_URL` at PostgreSQL. The app refuses to start on SQLite when
  `ENVIRONMENT=production`, so this is enforced rather than merely advised.
- Set `AUTH_SECRET` to a generated value and list the real origin in
  `CORS_ORIGINS` (a wildcard is rejected, because the API sends credentials).
- Run `alembic upgrade head` before starting the API; nothing creates tables at
  runtime.
- Switch `STORAGE_PROVIDER` to `s3` so uploads outlive a single host, and move
  `AI_PROVIDER` to `http` if you are running the inference service.
- Serve `backend` with `uvicorn` behind a process manager, and `frontend` with
  `npm run build && npm run start`.
