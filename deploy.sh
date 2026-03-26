#!/usr/bin/env bash
# ============================================================================
#  EntraLogin – Production Deployment Script  (Linux)
# ============================================================================
#  Supported OS : Ubuntu 20.04 / 22.04 / 24.04  |  Debian 11 / 12
#
#  Windows Server? Use deploy.ps1 instead:
#    powershell -ExecutionPolicy Bypass -File deploy.ps1
#
#  Usage        : bash deploy.sh
#                 (run from the EntraLogin project root, with sudo-capable user)
#  Log          : ./deploy.log
# ============================================================================

set -uo pipefail
IFS=$'\n\t'

# ── colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m'
BLUE='\033[0;34m' CYAN='\033[0;36m' BOLD='\033[1m' NC='\033[0m'

info()    { printf "${BLUE}  ▸${NC} %s\n"          "$*"; }
ok()      { printf "${GREEN}  ✓${NC} %s\n"          "$*"; }
warn()    { printf "${YELLOW}  ⚠${NC}  %s\n"        "$*"; }
die()     { printf "${RED}  ✗  FATAL:${NC} %s\n" "$*" >&2; exit 1; }
section() { printf "\n${BOLD}${CYAN}──── %s ────${NC}\n" "$*"; }

# ── prompt helpers ────────────────────────────────────────────────────────────
ask() {          # ask VARNAME "prompt" "default"
  local __v="$1" __p="$2" __d="${3:-}" __r
  read -rp "    ${YELLOW}▸${NC} ${__p}${__d:+ [${__d}]}: " __r || true
  printf -v "$__v" '%s' "${__r:-${__d}}"
}

ask_secret() {   # ask_secret VARNAME "prompt"
  local __v="$1" __p="$2" __r
  read -rsp "    ${YELLOW}▸${NC} ${__p}: " __r || true
  echo
  printf -v "$__v" '%s' "$__r"
}

gen_secret() { openssl rand -hex 32; }
cmd_exists()  { command -v "$1" &>/dev/null; }

# ── paths ─────────────────────────────────────────────────────────────────────
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$DIR/backend"
FRONTEND="$DIR/frontend"
LOG="$DIR/deploy.log"

# Tee all output to log file
exec > >(tee -a "$LOG") 2>&1

# ── banner ────────────────────────────────────────────────────────────────────
printf "\n${BOLD}"
echo "  ╔════════════════════════════════════════════════╗"
echo "  ║       EntraLogin – Production Deployment       ║"
echo "  ╚════════════════════════════════════════════════╝"
printf "${NC}\n"

# ── sanity checks ─────────────────────────────────────────────────────────────
section "Pre-flight checks"

[[ -d "$BACKEND"  ]] || die "backend/ directory not found. Run from the project root."
[[ -d "$FRONTEND" ]] || die "frontend/ directory not found. Run from the project root."
ok "Project root: $DIR"

[[ -f /etc/os-release ]] || die "Cannot detect OS."
# shellcheck source=/dev/null
. /etc/os-release
[[ "$ID" == "ubuntu" || "$ID" == "debian" ]] \
  || die "Unsupported OS: ${PRETTY_NAME:-$ID}. See DEPLOYMENT.md for manual setup."
ok "OS: ${PRETTY_NAME}"

[[ $EUID -eq 0 ]] && SUDO="" || SUDO="sudo"
$SUDO true || die "sudo access is required."
ok "sudo access confirmed"

# ── install system packages ───────────────────────────────────────────────────
section "Installing system packages"

$SUDO apt-get -qq update
$SUDO apt-get -qq install -y curl gnupg ca-certificates lsb-release openssl nginx redis-server
ok "curl / nginx / redis-server installed"

# Node.js 20 – skip if >= v18 already present
if cmd_exists node && node -e "process.exit(+process.version.slice(1).split('.')[0] < 18 ? 1 : 0)" 2>/dev/null; then
  ok "Node.js $(node -v) already installed (>= 18)"
else
  info "Installing Node.js 20 LTS via NodeSource…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash - >/dev/null
  $SUDO apt-get -qq install -y nodejs
  ok "Node.js $(node -v) installed"
fi

# MongoDB 7.0
if ! cmd_exists mongod; then
  info "Installing MongoDB 7.0 Community Edition…"
  curl -fsSL https://pgp.mongodb.com/server-7.0.asc \
    | $SUDO gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg
  # Use focal for Ubuntu 24 until MongoDB publishes a noble repo
  UBUNTU_CS="$(lsb_release -cs)"
  [[ "$UBUNTU_CS" == "noble" ]] && UBUNTU_CS="jammy"
  echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] \
    https://repo.mongodb.org/apt/ubuntu ${UBUNTU_CS}/mongodb-org/7.0 multiverse" \
    | $SUDO tee /etc/apt/sources.list.d/mongodb-org-7.0.list >/dev/null
  $SUDO apt-get -qq update
  $SUDO apt-get -qq install -y mongodb-org
  ok "MongoDB 7.0 installed"
else
  ok "MongoDB already installed"
fi

# Enable & start services
for SVC in mongod redis-server nginx; do
  $SUDO systemctl enable --now "$SVC" 2>/dev/null \
    || $SUDO systemctl enable --now "${SVC%%-server}" 2>/dev/null \
    || warn "Could not start $SVC – check manually"
done
ok "mongod / redis-server / nginx services enabled"

# PM2
if cmd_exists pm2; then
  ok "PM2 already installed ($(pm2 -v))"
else
  $SUDO npm install -g pm2 --silent
  ok "PM2 $(pm2 -v) installed"
fi

# ── collect configuration ─────────────────────────────────────────────────────
section "Configuration"
echo "  Press Enter to accept the value shown in [brackets]."
echo ""

ask DOMAIN    "Public domain name (e.g. auth.example.com)"    "localhost"
ask API_PORT  "Express backend port"                          "5000"
ask MONGO_URI "MongoDB connection URI" \
              "mongodb://127.0.0.1:27017/entralogin"
ask REDIS_URL "Redis URL" "redis://127.0.0.1:6379"

echo ""
info "JWT secrets — press Enter to auto-generate secure random values"
ask JWT_SECRET         "JWT_SECRET         (blank = auto-generate)" ""
ask JWT_REFRESH_SECRET "JWT_REFRESH_SECRET (blank = auto-generate)" ""
[[ -z "${JWT_SECRET:-}"         ]] && JWT_SECRET=$(gen_secret)         && info "JWT_SECRET auto-generated"
[[ -z "${JWT_REFRESH_SECRET:-}" ]] && JWT_REFRESH_SECRET=$(gen_secret) && info "JWT_REFRESH_SECRET auto-generated"

echo ""
info "Microsoft Entra External ID — see ENTRA_SETUP.md for where to find these"
ask        ENTRA_CLIENT_ID  "Entra Application (Client) ID"     ""
ask        ENTRA_TENANT_ID  "Entra Tenant (Directory) ID"       ""
ask        ENTRA_TENANT_SUB "Entra tenant subdomain (e.g. myapp)" ""
ask_secret ENTRA_SECRET     "Entra Client Secret"

PROTOCOL="https"
[[ "$DOMAIN" == "localhost" ]] && PROTOCOL="http"
ENTRA_REDIRECT="${PROTOCOL}://${DOMAIN}/api/auth/entra/callback"
[[ "$DOMAIN" == "localhost" ]] && ENTRA_REDIRECT="http://localhost:${API_PORT}/api/auth/entra/callback"
info "Entra redirect URI → ${ENTRA_REDIRECT}"

echo ""
info "SMTP / email settings (required for OTP delivery)"
ask        SMTP_HOST     "SMTP hostname (e.g. smtp.sendgrid.net)" ""
ask        SMTP_PORT_VAL "SMTP port"                              "587"
ask        SMTP_USER     "SMTP username"                          ""
ask_secret SMTP_PASS     "SMTP password"
ask        EMAIL_FROM    "From address"    "noreply@${DOMAIN}"
ask        EMAIL_NAME    "From display name" "EntraLogin"

FRONTEND_URL="${PROTOCOL}://${DOMAIN}"
[[ "$DOMAIN" == "localhost" ]] && FRONTEND_URL="http://localhost:3000"

# ── confirmation ──────────────────────────────────────────────────────────────
echo ""
printf "${BOLD}──── Summary ────${NC}\n"
echo "  Domain        : $DOMAIN"
echo "  API port      : $API_PORT"
echo "  MongoDB URI   : $MONGO_URI"
echo "  Redis URL     : $REDIS_URL"
echo "  Entra client  : ${ENTRA_CLIENT_ID:-<not set>}"
echo "  SMTP host     : ${SMTP_HOST:-<not set>}"
echo "  Frontend URL  : $FRONTEND_URL"
echo "  Redirect URI  : $ENTRA_REDIRECT"
echo ""
read -rp "  Proceed with deployment? [y/N]: " CONFIRM || true
[[ "${CONFIRM:-}" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }

# ── write backend/.env ────────────────────────────────────────────────────────
section "Writing backend/.env"

ENV_FILE="$BACKEND/.env"
if [[ -f "$ENV_FILE" ]]; then
  warn ".env already exists – backing up to .env.bak"
  cp "$ENV_FILE" "${ENV_FILE}.bak"
fi

cat > "$ENV_FILE" <<EOF
# EntraLogin – backend environment
# Generated by deploy.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")

PORT=${API_PORT}
NODE_ENV=production

MONGODB_URI=${MONGO_URI}
REDIS_URL=${REDIS_URL}

JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}

FRONTEND_URL=${FRONTEND_URL}

# Microsoft Entra External ID
ENTRA_CLIENT_ID=${ENTRA_CLIENT_ID}
ENTRA_CLIENT_SECRET=${ENTRA_SECRET}
ENTRA_TENANT_ID=${ENTRA_TENANT_ID}
ENTRA_TENANT_SUBDOMAIN=${ENTRA_TENANT_SUB}
ENTRA_REDIRECT_URI=${ENTRA_REDIRECT}

# SMTP / Email (required for OTP delivery)
SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT_VAL}
SMTP_SECURE=false
SMTP_USER=${SMTP_USER}
SMTP_PASS=${SMTP_PASS}
EMAIL_FROM_NAME=${EMAIL_NAME}
EMAIL_FROM_ADDRESS=${EMAIL_FROM}
EOF

chmod 600 "$ENV_FILE"
ok ".env written (permissions: 600)"

# ── install dependencies & build ──────────────────────────────────────────────
section "Installing dependencies & building"

info "Backend – npm install (production dependencies)…"
(cd "$BACKEND" && npm install --omit=dev --silent)
ok "Backend dependencies installed"

info "Frontend – npm install & build…"
(cd "$FRONTEND" && npm install --silent && npm run build)
ok "Frontend built → $FRONTEND/dist"

# ── PM2 ───────────────────────────────────────────────────────────────────────
section "Configuring PM2"

$SUDO mkdir -p /var/log/entralogin
$SUDO chown "$USER:$USER" /var/log/entralogin 2>/dev/null || true

# Write ecosystem with absolute paths so PM2 startup works from any cwd
cat > "$DIR/ecosystem.config.cjs" <<JS
// Auto-generated by deploy.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
'use strict';
module.exports = {
  apps: [
    {
      name: 'entralogin-api',
      script: 'src/server.js',
      cwd: '${BACKEND}',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      error_file: '/var/log/entralogin/err.log',
      out_file:   '/var/log/entralogin/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      max_memory_restart: '500M',
      watch: false,
    },
  ],
};
JS

if pm2 list 2>/dev/null | grep -q 'entralogin-api'; then
  pm2 reload "$DIR/ecosystem.config.cjs" --update-env
  ok "PM2 process reloaded"
else
  pm2 start "$DIR/ecosystem.config.cjs"
  ok "PM2 process started"
fi

pm2 save --force >/dev/null
ok "PM2 process list saved"

# Print the startup command for the admin to run (requires interactive shell)
echo ""
info "Run the following command to make PM2 survive reboots:"
printf "${YELLOW}"
pm2 startup 2>/dev/null | grep "sudo env PATH" || echo "  pm2 startup   (then copy and run the printed command)"
printf "${NC}"

# ── Nginx ─────────────────────────────────────────────────────────────────────
section "Configuring Nginx"

DIST_PATH="$FRONTEND/dist"
NGINX_CONF="/etc/nginx/sites-available/entralogin"

# Use the template from the repo; substitute placeholders with sed
$SUDO sed \
  -e "s|__DOMAIN__|${DOMAIN}|g" \
  -e "s|__FRONTEND_DIST__|${DIST_PATH}|g" \
  -e "s|__BACKEND_PORT__|${API_PORT}|g" \
  "$DIR/nginx/entralogin.conf" \
  | $SUDO tee "$NGINX_CONF" >/dev/null

# Enable site
$SUDO ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/entralogin

# Remove placeholder default site only if a real domain was specified
if [[ "$DOMAIN" != "localhost" && -L /etc/nginx/sites-enabled/default ]]; then
  $SUDO rm -f /etc/nginx/sites-enabled/default
  warn "Removed Nginx default site (can be restored from /etc/nginx/sites-available/default)"
fi

$SUDO nginx -t && $SUDO systemctl reload nginx
ok "Nginx configured and reloaded"

# ── done ──────────────────────────────────────────────────────────────────────
echo ""
printf "${BOLD}${GREEN}"
echo "  ╔════════════════════════════════════════════════╗"
echo "  ║           Deployment complete!                 ║"
echo "  ╚════════════════════════════════════════════════╝"
printf "${NC}\n"

echo "  App URL  :  http://${DOMAIN}"
echo "  Health   :  http://${DOMAIN}/api/health"
echo "  PM2 logs :  pm2 logs entralogin-api"
echo "  Error log:  cat /var/log/entralogin/err.log"
echo "  Full log :  $LOG"
echo ""
printf "${YELLOW}  Next steps:${NC}\n"
[[ "$DOMAIN" != "localhost" ]] \
  && echo "  1. SSL           →  sudo certbot --nginx -d ${DOMAIN}"
echo "  2. Entra portal  →  add Redirect URI: ${ENTRA_REDIRECT}"
[[ -z "${SMTP_HOST:-}" ]] \
  && warn "SMTP_HOST not set – OTP emails will fail. Edit $ENV_FILE and restart PM2."
echo ""
echo "  Full guide: DEPLOYMENT.md"
echo ""
