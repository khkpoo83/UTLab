# E2E — mobile regression smoke (Playwright)

Guards the Phase 3 mobile work and god-component refactors: every authed route
must render at phone width with no horizontal page overflow and no console
errors. Runs against an **already-serving** app (it does not build/serve).

## One-time: install the browser (off the tight root disk)

```bash
PLAYWRIGHT_BROWSERS_PATH=/data/playwright-browsers npx playwright install chromium
```

## Run

The suite is auth-gated, so it needs a JWT in `AUDIT_TOKEN` (it *skips* — does
not fail — when absent). Sign a short-lived token with the backend's secret:

```bash
TOKEN=$(sudo docker exec stock-backend-1 python -c "import os;from jose import jwt;from datetime import datetime,timedelta;print(jwt.encode({'sub':'admin','exp':datetime.utcnow()+timedelta(minutes=15)},os.environ['JWT_SECRET'],algorithm='HS256'))")

E2E_BASE_URL=http://localhost:7432 AUDIT_TOKEN="$TOKEN" \
  PLAYWRIGHT_BROWSERS_PATH=/data/playwright-browsers npm run test:e2e
```

- `E2E_BASE_URL` — app origin (default `http://localhost:7432`, the live nginx).
- Not wired into CI (needs a running authed backend); it's a local/manual guard.
