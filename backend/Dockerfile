FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/data

# Run as a non-root user (uid:gid 10001:10001).
# IMPORTANT host-state prerequisites (NOT captured in this image — set on the
# Docker host before/at deploy, because they concern bind-mounted paths):
#   1. DB + blog_images dir (bind-mounted to /app/data):
#        sudo chown -R 10001:10001 /data/utlab
#   2. KIS secret tar (bind-mounted :ro to /app/secrets/keys.tar) must be
#      readable by uid 10001 (host file is mode 600 / owner ec2-user):
#        sudo chmod 644 /home/ec2-user/Dev/Stock/65938259_secretkey.tar
# Without these, the container user cannot write the DB or read KIS keys.
RUN groupadd -g 10001 appuser \
    && useradd -u 10001 -g 10001 -m -s /usr/sbin/nologin appuser \
    && chown -R 10001:10001 /app
USER appuser

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
