# Migration Checklist — EC2 → Home Server + Cloudflare (utlab.kr)

Move the UT Lab stock dashboard from the current EC2 host to a home server,
serving `https://www.utlab.kr` via Cloudflare. Cloudflare terminates TLS at
the edge; the origin keeps serving plain HTTP. **No certbot / Let's Encrypt.**

The stack is two containers (`docker-compose`):
- `backend` — FastAPI/uvicorn, internal only (`expose: 8000`), runs as **uid 10001**.
- `frontend` — nginx, serves the SPA + proxies `/api` → `backend:8000`, published `7432:80`.

---

## 1. On the OLD host (EC2): take a final snapshot

```bash
# Fresh consistent DB backup (pg_dump custom format). The live DB is
# PostgreSQL since the 2026-07-01 cutover — NOT SQLite anymore.
sudo /home/ec2-user/Dev/Stock/scripts/backup_pg.sh

# Stop the stack so the Postgres data dir is quiescent for copying
cd /home/ec2-user/Dev/Stock && sudo docker-compose down
```

## 2. Copy DATA to the new host

Stateful data lives in **two** host dirs — copy BOTH while the stack is stopped
(preserve numeric ownership/timestamps):

```bash
# 1. Postgres data dir — the LIVE database (bind-mounted to the postgres container)
sudo rsync -aHAX --numeric-ids /data/pgdata/  newhost:/data/pgdata/

# 2. App data dir — uploads + backups (bind-mounted to /app/data)
sudo rsync -aHAX --numeric-ids /data/utlab/   newhost:/data/utlab/
```

Includes:
- `/data/pgdata/` — **the live PostgreSQL 16 data directory** (owner uid 70 / gid 999).
  Must be copied cold (stack stopped) for a consistent snapshot.
- `/data/utlab/blog_images/` — uploaded blog images.
- `/data/utlab/backups/` — prior pg_dump snapshots + the final retired SQLite archive
  (`utlab_FINAL_sqlite_pre-retirement_*.db.gz`, kept only for historical rollback).

> The old live SQLite file (`utlab.db`) was retired on 2026-07-02 after the
> Postgres cutover — it no longer exists; the DB now lives in `/data/pgdata`.
> `--numeric-ids` preserves ownership (10001:10001 for app data, 70:999 for pgdata).
> If you don't use it, re-run the chown in step 5.

## 3. Copy CODE + SECRETS + CONFIG

- The repo itself (git clone or rsync `/home/ec2-user/Dev/Stock`), **or** just
  redeploy from git on the new host.
- `.env` — environment file referenced by `docker-compose.yml` (`env_file: .env`).
  Contains `JWT_SECRET` (required — backend refuses to start with an empty key),
  `KIS_TAR_PATH`, `KIS_*`, Naver/Unsplash/etc. API keys. **Not in git — copy it.**
- `65938259_secretkey.tar` — KIS/Kiwoom API secret keys, mounted read-only to
  `/app/secrets/keys.tar`. **Not in git — copy it.** (Repo path on the old host:
  `/home/ec2-user/Dev/Stock/65938259_secretkey.tar`.)

```bash
scp /home/ec2-user/Dev/Stock/.env                       newhost:<repo>/.env
scp /home/ec2-user/Dev/Stock/65938259_secretkey.tar     newhost:<repo>/
```

> If repo paths differ on the new host, update the absolute `volumes:` paths in
> `docker-compose.yml` (the secret tar mount and the docs mount use absolute host paths).

## 4. Adjust docker-compose.yml paths (if the new host layout differs)

`docker-compose.yml` hard-codes a few host paths — verify they exist on the new host:
- `/data/utlab:/app/data`
- `<repo>/65938259_secretkey.tar:/app/secrets/keys.tar:ro`
- `<repo>/docs:/usr/share/nginx/docs:ro`

## 5. Set HOST OWNERSHIP / PERMISSIONS (REQUIRED — backend runs as uid 10001)

The backend container runs as **uid:gid 10001:10001** (non-root). Bind-mounted
host paths must be accessible to that uid or the app gets read-only DB errors
and KIS key-load failures:

```bash
# App data dir (uploads + backups) must be writable by the backend user (10001)
sudo chown -R 10001:10001 /data/utlab

# Postgres data dir must be owned by the postgres container user (uid 70 / gid 999)
sudo chown -R 70:999 /data/pgdata

# KIS secret tar must be readable by uid 10001 (host file is typically mode 600)
sudo chmod 644 <repo>/65938259_secretkey.tar
```

> These are HOST state, not baked into the image — they must be set on EVERY host
> that runs the backend image. (Documented in `backend/Dockerfile` header too.)

## 6. Build and start

```bash
cd <repo>
sudo docker-compose build && sudo docker-compose up -d
sudo docker-compose ps          # both up; backend (healthy)
curl -s http://localhost:7432/api/health   # {"status":"ok",...}
```

> Deploy note: always rebuild the image (`build` + `up -d`); never `docker cp`
> code into a running container — it is rolled back on the next `--force-recreate`.

## 7. Re-install the daily backup on the new host

Amazon Linux 2023 ships **without cron** (`crontab: command not found`), so the
backup runs as a **systemd timer**, not a crontab entry. Recreate both units
(`utlab-pg-backup.service` + `.timer`, daily 04:30 KST, `Persistent=true`) and
enable them (units are versioned in `scripts/systemd/`):

```bash
sudo cp <repo>/scripts/systemd/utlab-pg-backup.service /etc/systemd/system/
sudo cp <repo>/scripts/systemd/utlab-pg-backup.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now utlab-pg-backup.timer
sudo systemctl list-timers utlab-pg-backup.timer   # verify next run
```

> The service runs `scripts/backup_pg.sh` (pg_dump inside the postgres container)
> and appends to `/data/utlab/backups/backup_pg.log`.

## 8. DNS / Cloudflare (TLS at the edge, origin stays HTTP)

1. In Cloudflare, point `www.utlab.kr` (and `utlab.kr`) at the home server's
   public IP (or a Cloudflare Tunnel to avoid exposing the IP / opening ports).
2. SSL/TLS mode: **Flexible** if the origin is plain HTTP on port 7432, or
   **Full** if you later add an origin cert. With a **Cloudflare Tunnel**, point
   the tunnel ingress at `http://localhost:7432`.
3. Enable **Always Use HTTPS** and **HSTS at the Cloudflare edge** (not at nginx).
4. The origin keeps serving HTTP on `7432` — **do NOT run certbot.** nginx already
   forwards `X-Forwarded-Proto` and `X-Forwarded-Host` so the app sees the real
   `https` scheme and host behind Cloudflare.
5. If you ever drop Cloudflare and terminate TLS at the origin directly, the
   commented `listen 443` scaffold and HSTS line in `frontend/nginx.conf` are
   ready to enable (provide a cert/key, uncomment, rebuild frontend).

## 9. Post-migration verification

```bash
curl -s http://localhost:7432/api/health                 # origin ok
curl -sI https://www.utlab.kr/                            # 200 via Cloudflare
# login rate limit still active:
for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code} " \
  -X POST http://localhost:7432/api/auth/login -d 'username=x&password=y' \
  -H 'Content-Type: application/x-www-form-urlencoded'; done; echo
# expect a few 401 then 429
```

Check logs for KIS key load and no readonly DB errors:
```bash
sudo docker-compose logs --tail=50 backend | grep -iE "error|readonly|kis|kiwoom"
sudo docker-compose exec backend id          # uid=10001(appuser)
```

---

### Quick reference — what is NOT in git (must be copied manually)
- `/data/utlab/` (DB, WAL, backups, blog_images)
- `.env`
- `65938259_secretkey.tar`
- host crontab line (step 7)
- host ownership/perms (step 5)
