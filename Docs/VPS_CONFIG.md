# CAP 360 — VPS Configuration Checklist

> **Date:** 2026-10-03 (phases 0–4 applied the same day; root login is key-only, password SSH disabled, ufw + fail2ban active, Docker 29 + Compose v5 installed, `deploy` user + `/opt/cap360-{staging,prod}` created) · Hostinger KVM 2 (2 vCPU, 8 GB RAM, 100 GB NVMe), Ubuntu 24.04, Düsseldorf.
> Hosts **staging + production** as two Compose stacks. Deploy design, rollback and the full
> command reference live in [DEPLOYMENT.md §0](DEPLOYMENT.md#0-deploy-runbook--one-vps-two-stacks-docker-compose--ghcr);
> this file is the order to do things in on the fresh box.

## Connection

| | |
|---|---|
| Host | `179.198.220.184`  (host key ED25519 `SHA256:9Y956mq+VHByw0J4sGLAR3uDlno50ajTlOsO3RnmRa8`) |
| Domain | `cap360.tech` (Hostinger free domain, claimed 2026-10-03). **Prod = `https://cap360.tech`**; **staging = `https://staging.cap360.tech:8443`** (Phase 9b; until then `http://179.198.220.184:8080` — API works, browser sessions don't, see 9b). DNS points at the VPS and a Let's Encrypt cert exists on it (expires 2027-01-01) — Phase 9 |
| First login | `ssh -i ~/.ssh/cap_vps root@179.198.220.184` |
| Day-to-day login (after phase 2) | `ssh -i ~/.ssh/cap_vps deploy@179.198.220.184` |
| Private key | `C:\Users\emerson.silva\.ssh\cap_vps` — **never** copy it into the repo, chat, or a form |
| Public key (safe to share) | `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGTOuAr02dmWWoE31uwqrpvpSsubk7K/dsAaTkMpMPG9 tmais\emerson.silva@UTMAIS-PC-424` |
| Root password | password manager only (Hostinger → VPS → Settings can reset it). Not stored here: this file is tracked by git |

If Windows OpenSSH says `UNPROTECTED PRIVATE KEY FILE`, fix the ACL once:
`icacls $env:USERPROFILE\.ssh\cap_vps /inheritance:r /grant:r "$($env:USERNAME):(R)"`

## Phase 0 — Purchase (done)

- [x] Hostinger KVM 2, Ubuntu 24.04, Germany – Düsseldorf (best latency, 151 ms)
- [x] Admin SSH key `cap_vps` added in hPanel; Docker Manager left off (Docker is installed by hand below)
- [ ] hPanel → VPS → Backups: confirm weekly snapshots are on (not a substitute for phase 8)
- [x] Note the VPS IP in the table above

## Phase 1 — Base system (as root)

- [x] `ssh -i ~/.ssh/cap_vps root@179.198.220.184` works
- [x] `apt update && apt -y full-upgrade && reboot`, reconnect
- [x] `apt -y install ufw fail2ban unattended-upgrades curl git` then `dpkg-reconfigure -plow unattended-upgrades`

## Phase 2 — Deploy user + lock down SSH

- [x] Create the user and give it your key:
  ```bash
  adduser --disabled-password --gecos "" deploy
  install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
  cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
  chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys
  ```
- [x] **In a second terminal**, confirm `ssh -i ~/.ssh/cap_vps deploy@179.198.220.184` works before continuing
- [x] Disable password login. The file is named `00-` on purpose: sshd uses the *first* value it sees, and
  Ubuntu's `50-cloud-init.conf` sets `PasswordAuthentication yes`:
  ```bash
  printf 'PasswordAuthentication no\nPermitRootLogin prohibit-password\n' > /etc/ssh/sshd_config.d/00-hardening.conf
  sshd -t && systemctl reload ssh
  ```
- [x] Re-test both logins from a new terminal; password login must now be refused

## Phase 3 — Firewall + fail2ban

- [x] ```bash
  ufw default deny incoming && ufw default allow outgoing
  ufw allow 22/tcp && ufw allow 80,443/tcp && ufw allow 8080,8443/tcp   # 8080/8443 = staging
  ufw enable && ufw status
  systemctl enable --now fail2ban
  ```
  Only nginx publishes host ports (see `docker-compose.prod.yml`), so Docker bypassing ufw is not an issue today.

## Phase 4 — Docker

- [x] `curl -fsSL https://get.docker.com | sh && usermod -aG docker deploy`
- [x] Cap container logs so they can't fill the disk, then restart Docker:
  ```bash
  printf '{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}\n' > /etc/docker/daemon.json
  systemctl restart docker
  ```
- [x] As `deploy` (re-login so the group applies): `docker --version && docker compose version && curl --version`
- [x] `docker compose ls && docker volume ls` → nothing named `cap360-*` yet

## Phase 5 — Repo access (as `deploy`) — details in DEPLOYMENT.md §0.4

- [x] `sudo install -d -o deploy -g deploy /opt/cap360-staging /opt/cap360-prod`
- [x] Read-only GitHub deploy key (`ssh-keygen -t ed25519 -N "" -f ~/.ssh/cap360_deploy`, add the `.pub` at
  github.com/zyron153/cap_360 → Settings → Deploy keys, write access **off**, `~/.ssh/config` entry, `ssh -T git@github.com`)
- [x] `git clone git@github.com:zyron153/cap_360.git` into `/opt/cap360-staging` and `/opt/cap360-prod` (done 2026-10-03, `master` at 5de077f)
- [x] GHCR pull (done 2026-10-03, token expires per its setting — renew before then): classic PAT with only `read:packages` → `docker login ghcr.io -u zyron153 --password-stdin`

## Phase 6 — GitHub secrets (repo → Settings → Environments)

Use a **dedicated CI key**, not `cap_vps`: `ssh-keygen -t ed25519 -N "" -f cap360_ci` on your PC, append `cap360_ci.pub` to
`/home/deploy/.ssh/authorized_keys`, paste the *private* half into GitHub only.

- [x] Environment `STAGING` (created via gh 2026-10-03; CI key is `~/.ssh/cap360_ci` on the PC, authorized for `deploy`): `STAGING_VM_IP` = `179.198.220.184`, `STAGING_VM_USER` = `deploy`, `STAGING_SSH_PRIVATE_KEY`
- [x] Repo variable `STAGING_PUBLIC_APP_URL` = `http://179.198.220.184:8080`
- [ ] Environment `PRODUCTION` (required reviewers on) + `PRODUCTION_*` secrets + variable `PUBLIC_APP_URL` = `https://cap360.tech` (the repo variable currently still holds the old `http://127.0.0.1`)
  — set it **before the first prod build**: the web image bakes it in, changing it later needs a rebuild

## Phase 7 — First staging deploy

- [x] (2026-10-03: written on the VPS with generated secrets; `ADMIN_PASSWORD` still empty — the seed needs ≥ 12 chars) `cd /opt/cap360-staging && cp .env.prod.example .env.prod && chmod 600 .env.prod`, then fill: `GHCR_OWNER=zyron153`,
  `HTTP_PORT=8080`, `HTTPS_PORT=8443`, `WEB_URL` / `ALLOWED_ORIGINS` = `http://179.198.220.184:8080`, fresh
  `POSTGRES_PASSWORD` (`openssl rand -hex 24` — hex, it goes into a URL), fresh `FIELD_ENCRYPTION_KEY` (`openssl rand -hex 32`), `ADMIN_EMAIL`/`ADMIN_PASSWORD`
- [ ] **Back up `FIELD_ENCRYPTION_KEY` off the server** (password manager) — losing it makes encrypted patient data unreadable
- [x] Run workflow → Deploy Staging from `master`; green (2026-10-03, images `staging-5de077f`, all containers healthy)
- [x] First admin `admin@cap360.tech` created, `ADMIN_PASSWORD` blanked in `.env.prod`. The `seed` service failed with `ERR_UNKNOWN_FILE_EXTENSION` (ts-node vs node:20 ESM loader) — fixed in `docker-compose.prod.yml` (`--compiler-options {"module":"commonjs"}`); that fix is **not yet pushed**, so the VPS clone still has the old line until the next deploy
- [x] `/health` → 200 and `POST /v1/auth/login` with the admin → 200 (verified by curl). **A browser can't keep the session over plain http**: the `cap_session` cookie is `Secure` whenever `NODE_ENV=production` (`session.service.ts:22`), so staging needs HTTPS → Phase 9b

## Phase 8 — Backups (required before real patient data)

- [x] `scripts/vps/backup.sh <staging|prod>`: `pg_dump | gzip` into `./backups` (dir 700, files 600) via a `.tmp` + `gzip -t` + size check, so a failed
  dump exits non-zero and leaves no file; keeps the newest 14 (`KEEP=`). Files are `nightly-<project>-<utc>.sql.gz` so `deploy.sh`'s own prune of its
  pre-deploy dumps never touches them. Tested 2026-10-03 on staging, including the failure path.
- [ ] Cron, as `deploy` (`crontab -e`) — staging now, add the prod line when prod exists:
  ```cron
  15 2 * * * bash /opt/cap360-staging/scripts/vps/backup.sh staging >> /opt/cap360-staging/backups/backup.log 2>&1
  15 3 * * * bash /opt/cap360-prod/scripts/vps/backup.sh prod >> /opt/cap360-prod/backups/backup.log 2>&1
  ```
  The VPS clone needs the script first: `git fetch origin && git checkout --detach origin/master` once it is pushed (the next deploy does the same).
- [ ] Copy `backups/` **off the server** nightly (e.g. rclone → Backblaze B2, encrypted) — **not done**; local-only backups die with the VPS
- [x] Restore drill 2026-10-03 on staging: dump restored into a scratch DB → 38 tables and the admin row, then dropped. Repeat on prod
  before real data (`gunzip -c <file> | docker compose … exec -T postgres psql -U cap -d <scratch> -v ON_ERROR_STOP=1`)

## Phase 9 — Domain `cap360.tech` + production HTTPS

Layout: **prod = `https://cap360.tech`** (nginx on 80/443). Staging is **`https://staging.cap360.tech:8443`** (Phase 9b): its own hostname keeps the `cap_session` cookie separate from prod
(cookies ignore ports, so `cap360.tech:8443` would collide with prod).

- [x] certbot 2.9.0 installed on the VPS (`certbot.timer` active); ports 80/443 free
- [x] **DNS** — hPanel → Domains → `cap360.tech` → DNS / Nameservers (must be on Hostinger's nameservers). Add
  `A  @  179.198.220.184` (TTL 300) and delete the parking `AAAA` for `@` (Let's Encrypt prefers IPv6, so a stale AAAA fails validation). Done 2026-10-03; `www` CNAME and parking `MX` left as is.
- [x] `nslookup cap360.tech 8.8.8.8` returns `179.198.220.184` (verified 2026-10-03; AAAA gone at the authoritative NS)
- [x] Cert issued 2026-10-03, expires 2027-01-01: `certbot certonly --standalone -d cap360.tech --register-unsafely-without-email`
  (no expiry emails — auto-renew handles it; add one with `certbot update_account -m <email>`)
- [x] Renewal hooks (installed, `certbot renew --dry-run` passes). Standalone renewal needs :80, so stop whatever container publishes it, only on days a renewal actually
  runs (certbot skips pre/post hooks otherwise); ceiling: ~10 s of downtime then — move to `--webroot` if that matters:
  ```bash
  cd /etc/letsencrypt/renewal-hooks
  printf '#!/bin/sh\ndocker ps -q --filter publish=80 > /run/cap360-certbot-stopped\nxargs -r docker stop < /run/cap360-certbot-stopped\n' > pre/cap360.sh
  printf '#!/bin/sh\nxargs -r docker start < /run/cap360-certbot-stopped\nrm -f /run/cap360-certbot-stopped\n' > post/cap360.sh
  printf '#!/bin/sh\nd=/opt/cap360-prod/infra/nginx/certs\n[ -d "$d" ] || exit 0\ncp "$RENEWED_LINEAGE/fullchain.pem" "$RENEWED_LINEAGE/privkey.pem" "$d/"\n' > deploy/cap360.sh
  chmod +x pre/cap360.sh post/cap360.sh deploy/cap360.sh
  certbot renew --dry-run
  ```
- [x] Prod clone done (Phase 5). Still to do: `.env.prod` with its **own** secrets,
  `WEB_URL` / `ALLOWED_ORIGINS` = `https://cap360.tech`, no `HTTP_PORT`/`HTTPS_PORT` (defaults 80/443)
- [ ] Seed the certs into the clone, then enable TLS (no edit to the tracked `app.conf` — keep it untouched so deploys' `git checkout` stays clean):
  ```bash
  cd /opt/cap360-prod && mkdir -p infra/nginx/certs
  cp /etc/letsencrypt/live/cap360.tech/{fullchain,privkey}.pem infra/nginx/certs/
  sed 's/YOUR_DOMAIN/cap360.tech/g' infra/nginx/tls.conf.example > infra/nginx/conf.d/tls.conf
  ```
  The `tls.conf` carries the `cap360.tech` :80 → :443 redirect; `app.conf`'s default server still answers by IP, which is what
  `deploy.sh`'s health probe (`curl http://127.0.0.1/health`) needs.
- [ ] First prod deploy (Run workflow → Deploy Production, approve), seed the admin, then
  `curl -I https://cap360.tech/health` → 200 and `curl -I http://cap360.tech` → 301
- [ ] Once prod is live, allow only what's needed: if staging never gets TLS, close `8443`: `ufw delete allow 8080,8443/tcp && ufw allow 8080/tcp`
- [ ] Pin the host key in the deploy workflows (`fingerprint:` input of `appleboy/ssh-action`): `ssh-keyscan -t ed25519 179.198.220.184 | ssh-keygen -lf -` (should match the ED25519 fingerprint in the table above)

## Phase 9b — Staging over HTTPS (`staging.cap360.tech:8443`)

- [x] **DNS** (you, hPanel → DNS): `A  staging  179.198.220.184`, TTL 300; no AAAA
- [x] Cert: `certbot certonly --standalone -d staging.cap360.tech --register-unsafely-without-email --agree-tos`
- [x] Extend `/etc/letsencrypt/renewal-hooks/deploy/cap360.sh` to copy per lineage: `cap360.tech` → `/opt/cap360-prod/infra/nginx/certs`,
  `staging.cap360.tech` → `/opt/cap360-staging/infra/nginx/certs`; then `certbot renew --dry-run`
- [x] Staging clone: copy the cert into `infra/nginx/certs/`, then
  `sed 's/YOUR_DOMAIN/staging.cap360.tech/g' infra/nginx/tls.conf.example > infra/nginx/conf.d/tls.conf` and change that file's
  :80 redirect to `return 301 https://$host:8443$request_uri;` (staging's :80 is host port 8080)
- [x] `.env.prod`: `WEB_URL` / `ALLOWED_ORIGINS` = `https://staging.cap360.tech:8443`
- [x] Repo variable `STAGING_PUBLIC_APP_URL` = `https://staging.cap360.tech:8443` (baked into the web image → redeploy rebuilds it)
- [x] Redeploy staging, then `curl -I https://staging.cap360.tech:8443/health` → 200 and log in from a browser Verified 2026-10-03: TLS valid, login page 200, :8080 → 301 → :8443, admin login 200 with a Secure cookie. Note `https://…:8443/health` returns 307 (the old `tls.conf.example` copy has no `/health` block; deploy.sh probes 127.0.0.1:8080 so it's unaffected).
