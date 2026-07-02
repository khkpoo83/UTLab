# systemd units — daily PostgreSQL backup

Amazon Linux 2023 has no cron (`crontab: command not found`), so the daily DB
backup runs as a **systemd timer** instead of a crontab entry.

## Install

```bash
sudo cp scripts/systemd/utlab-pg-backup.service /etc/systemd/system/
sudo cp scripts/systemd/utlab-pg-backup.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now utlab-pg-backup.timer
```

## Operate

```bash
sudo systemctl list-timers utlab-pg-backup.timer   # next scheduled run
sudo systemctl start utlab-pg-backup.service       # run a backup right now
tail -n 20 /data/utlab/backups/backup_pg.log       # logs
```

The service runs `scripts/backup_pg.sh` (pg_dump `-Fc` inside the postgres
container, gzipped to `/data/utlab/backups`, 14-day retention). If the repo path
differs from `/home/ec2-user/Dev/Stock`, update `ExecStart` in the `.service`.
