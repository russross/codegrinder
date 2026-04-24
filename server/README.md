# server deployment (Alpine + OpenRC, single-user host, standalone HTTP-01)

This setup runs `server` as your normal account (`russ`) on a dedicated server, with all CodeGrinder state under:

`CODEGRINDEROOT=/home/russ/codegrinder`

No app config/database data is stored under `/etc` or `/var`.

This guide uses Let’s Encrypt `http-01` with `certbot --standalone`.
Nginx serves only 443. Port 80 is used only when certbot runs.

## 1. Packages to install

Install/verify these packages:

```sh
doas apk update
doas apk add nginx certbot certbot-nginx uv podman
```

Notes:
- `openrc` is part of `alpine-base`.
- `python3` is required (already present in your package list).

## 2. Directory layout under CODEGRINDEROOT

```sh
export CODEGRINDEROOT="$HOME/codegrinder"
mkdir -p "$CODEGRINDEROOT"/db
mkdir -p "$CODEGRINDEROOT"/certs/{letsencrypt,letsencrypt-work,letsencrypt-logs}
```

Expected runtime files:
- Config: `$CODEGRINDEROOT/config.json`
- DB: `$CODEGRINDEROOT/db/codegrinder.db`
- TLS: `$CODEGRINDEROOT/certs/letsencrypt/live/mud.russross.com/...`

## 3. Create server config

Start from the checked-in template:

```sh
cp /home/russ/codegrinder/server/config.example.json /home/russ/codegrinder/config.json
```

Set secrets in `/home/russ/codegrinder/config.json` (`daycareSecret`, `ltiSecret`, `sessionSecret`) before starting the service.
Set `containerEngine` to `doas podman` for rootful Podman execution from an unprivileged server process. Daycare containers are launched unprivileged (`--user 1001:1001`, dropped capabilities, `no-new-privileges`).
When using Podman, unqualified image names (for example `codegrinder/riscv`) are automatically resolved as `localhost/codegrinder/riscv`.
Daycare always runs containers with `--pull=never` and only tries local image candidates, so it will not trigger remote image pulls.

## 4. Sync Python environment

From `server/`:

```sh
cd /home/russ/codegrinder/server
uv sync
```

## 5. OpenRC service for server (daemon mode, syslog logging)

This repo includes `openrc.codegrinder-server`.

Install and start it:

```sh
doas cp /home/russ/codegrinder/server/openrc.codegrinder-server /etc/init.d/codegrinder-server
doas chmod 755 /etc/init.d/codegrinder-server
doas rc-update add codegrinder-server default
doas rc-service codegrinder-server start
doas rc-service codegrinder-server status
```

Logs go to system logger with tag `codegrinder-server`.

## 6. First TLS certificate (http-01 on port 80)

`certbot --standalone` binds port 80 directly during validation.
Because nginx is configured for 443 only, nginx can stay running.

```sh
doas certbot certonly \
  --standalone \
  --preferred-challenges http \
  -d mud.russross.com \
  --email russ.ross@utahtech.edu \
  --agree-tos \
  --no-eff-email \
  --config-dir /home/russ/codegrinder/certs/letsencrypt \
  --work-dir /home/russ/codegrinder/certs/letsencrypt-work \
  --logs-dir /home/russ/codegrinder/certs/letsencrypt-logs
```

## 7. Nginx config (443 only)

This repo includes `nginx.codegrinder.conf` with:
- hostname: `mud.russross.com`
- Let’s Encrypt tree: `/home/russ/codegrinder/certs/letsencrypt`
- backend gRPC: `127.0.0.1:8080`
- backend HTTP (LTI/etc): `127.0.0.1:8081`

Install and start nginx:

```sh
doas cp /home/russ/codegrinder/server/nginx.codegrinder.conf /etc/nginx/http.d/codegrinder.conf
doas nginx -t
doas rc-update add nginx default
doas rc-service nginx start
```

## 8. Renewal schedule (your crontab)

This repo includes `certbot-renew-codegrinder`.

Install script and schedule it in root crontab:

```sh
doas cp /home/russ/codegrinder/server/certbot-renew-codegrinder /usr/local/sbin/certbot-renew-codegrinder
doas chmod 755 /usr/local/sbin/certbot-renew-codegrinder
doas crontab -e
```

Add a daily job, for example:

```cron
15 3 * * * /usr/local/sbin/certbot-renew-codegrinder
```

Renewals also use standalone `http-01` and briefly bind port 80 while validating.
When a cert is actually renewed, the script reloads nginx automatically.

## 9. Foreground dev run (console logs)

```sh
cd /home/russ/codegrinder/server
CODEGRINDERROOT=/home/russ/codegrinder \
uv run python main.py \
  --config /home/russ/codegrinder/config.json \
  --bind 127.0.0.1:8080 \
  --http-bind 127.0.0.1:8081
```

This mode is for local testing and prints logs directly to your terminal.

## 10. Verify end-to-end

```sh
doas rc-service codegrinder-server status
doas rc-service nginx status
ss -lnt | grep -E '(:443|:8080|:8081)'
curl -I https://mud.russross.com/version
```

Expected routes:
- gRPC: `/codegrinder.CodeGrinderService/<MethodName>`
- LTI: `/lti/config.xml`, `/lti/problem_sets/:ui/:unique`
- daycare registration: `/daycare_registrations`
- versions: `/version`, `/v2/version`
