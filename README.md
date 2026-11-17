# Talaan

Offline-first field data sync. Field workers fill in inspection forms with no network; every change
reaches the server exactly once, with no silent overwrites, even when the network fails mid-sync.

> Status: design phase. See [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md).

## Stack

Django + DRF + simplejwt + PostgreSQL · React + TypeScript + Vite + Dexie + Workbox ·
pytest, Vitest, Playwright · Docker Compose, GitHub Actions.

## Run / test

Server and client skeletons so far (one-command compose setup arrives in 0.4).

```bash
cp .env.example .env            # then set DJANGO_SECRET_KEY
docker compose up -d db
cd server
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
bash scripts/migrate.sh         # migrations run as the owner role
python manage.py seed_demo      # dev logins: admin, worker1, worker2
python manage.py runserver      # API docs at http://localhost:8000/api/docs/
python -m pytest                # runs as the least-privilege DB role
```

```bash
cd client
npm ci
npm run dev                     # http://localhost:5173, proxies /api to Django on :8000
npm test                        # unit tests (Vitest, jsdom)
npm run build                   # production build with the service worker
```

## Docs

[docs/README.md](docs/README.md) is the index.

## Guarantees and non-guarantees

Filled in as each guarantee gets a passing test (see `docs/failure-scenarios.md`).
