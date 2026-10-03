# CAP 360 — VPS Configuration Checklist

> **Date:** 2026-10-03 (phases 0–4 applied the same day; root login is key-only, password SSH disabled, ufw + fail2ban active, Docker 29 + Compose v5 installed, `deploy` user + `/opt/cap360-{staging,prod}` created) · Hostinger KVM 2 (2 vCPU, 8 GB RAM, 100 GB NVMe), Ubuntu 24.04, Düsseldorf.
> Hosts **staging + production** as two Compose stacks. Deploy design, rollback and the full
> command reference live in [DEPLOYMENT.md §0](DEPLOYMENT.md#0-deploy-runbook--one-vps-two-stacks-docker-compose--ghcr);
> this file is the order to do things in on the fresh box.

## Connection

| | |
|---|---|
| Host | `179.198.220.184`  (host key ED25519 `SHA256:9Y956mq+VHByw0J4sGLAR3uDlno50ajTlOsO3RnmRa8`) |
| Domain | `cap360.tech` (Hostinger free domain, claimed 2026-10-03). **Prod = `https://cap360.tech`**; staging stays on `http://179.198.220.184:8080` for now. DNS points at the VPS and a Let's Encrypt cert exists on it (expires 2027-01-01) — Phase 9 |
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

- [ ] `cd /opt/cap360-staging && cp .env.prod.example .env.prod && chmod 600 .env.prod`, then fill: `GHCR_OWNER=zyron153`,
  `HTTP_PORT=8080`, `HTTPS_PORT=8443`, `WEB_URL` / `ALLOWED_ORIGINS` = `http://179.198.220.184:8080`, fresh
  `POSTGRES_PASSWORD` (`openssl rand -base64 32`), fresh `FIELD_ENCRYPTION_KEY` (`openssl rand -hex 32`), `ADMIN_EMAIL`/`ADMIN_PASSWORD`
- [ ] **Back up `FIELD_ENCRYPTION_KEY` off the server** (password manager) — losing it makes encrypted patient data unreadable
- [ ] Push to `staging` (or Run workflow → Deploy Staging); run is green
- [ ] Create the first admin (DEPLOYMENT.md §0.4 `run --rm seed`), then delete `ADMIN_PASSWORD` from `.env.prod`
- [ ] `curl -i http://179.198.220.184:8080/health` → 200 and the login page loads in a browser

## Phase 8 — Backups (required before real patient data)

- [ ] Nightly dump for prod, as `deploy` crontab (`crontab -e`) — adjust to staging while only staging exists:
  ```cron
  0 2 * * * cd /opt/cap360-prod && IMAGE_TAG=$(cat .deployed-tag) docker compose -p cap360-prod --env-file .env.prod -f docker-compose.prod.yml exec -T postgres pg_dump -U cap cap | gzip > backups/nightly-$(date +\%F).sql.gz && find backups -name 'nightly-*' -mtime +14 -delete
  ```
- [ ] Copy `backups/` **off the server** nightly (e.g. rclone → Backblaze B2, encrypted)
- [ ] Do one restore drill into an empty scratch database (DEPLOYMENT.md §0.5)

## Phase 9 — Domain `cap360.tech` + production HTTPS

Layout: **prod = `https://cap360.tech`** (nginx on 80/443). Staging keeps `http://179.198.220.184:8080` — it carries no real
data, and its own hostname would need a `:8443` cert + a rebuild (the web image bakes in its URL). Add `staging.cap360.tech`
later if a public HTTPS staging is needed (Meta's WhatsApp webhook is the likely reason).

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
