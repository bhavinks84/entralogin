# EntraLogin – Deployment Guide

---

## Choose your platform

| Platform | Script | Guide |
|----------|--------|-------|
| **Windows Server 2016 / 2019 / 2022** | `deploy.ps1` | [Windows Server Deployment](#windows-server-deployment) (this page, §A) |
| **Ubuntu 20.04 / 22.04 / 24.04 · Debian 11 / 12** | `deploy.sh` | [Linux Deployment](#linux-deployment) (this page, §B) |

---

## Windows Server Deployment

### A1. Prerequisites

- Windows Server 2016, 2019, or 2022
- PowerShell 5.1 or later (included with all supported versions)
- Administrator account
- Inbound firewall ports 80 and 443 open
- Internet access (script downloads packages automatically)
- A domain name pointed at the server's IP (for SSL)

### A2. Upload code to the server

Copy the `EntraLogin` project folder to the server via RDP file-copy, SCP, or your preferred method:

```
\\server\C$\deploy\entralogin\   ← suggested location
```

Or use Git in PowerShell:

```powershell
git clone https://github.com/your-org/entralogin.git C:\deploy\entralogin
cd C:\deploy\entralogin
```

### A3. Run the deployment script

Open **PowerShell as Administrator**, then:

```powershell
cd C:\deploy\entralogin
powershell -ExecutionPolicy Bypass -File deploy.ps1
```

The script interactively prompts for every required value, prints a summary, and asks for confirmation before making any changes.

### A4. What `deploy.ps1` installs

| Component | How installed | Notes |
|-----------|---------------|-------|
| Node.js 20 LTS | Chocolatey `nodejs-lts` | Added to system PATH |
| MongoDB 7.0 | Chocolatey `mongodb` | Registered as Windows service |
| Redis 3.0 | Chocolatey `redis-64` | Registered as Windows service |
| nginx 1.26 | Direct download from nginx.org | Installed to `C:\nginx` |
| NSSM | Chocolatey `nssm` | Used to wrap nginx and Node.js as services |

> **Redis note:** `redis-64` is a maintained community Windows port of Redis 3.0.
> For high-traffic production workloads consider:
> - **Memurai** — Redis-compatible Windows service: https://www.memurai.com
> - **Redis Cloud** — managed cloud Redis (free tier available): https://redis.io/cloud

### A5. Windows services created

| Service name | What it runs |
|--------------|-------------|
| `entralogin-api` | Node.js Express backend |
| `nginx-entralogin` | nginx reverse proxy + static files |
| `MongoDB` | MongoDB database |
| `Redis` | Redis key-value store |

All services are set to `Automatic` start — they come back up after a reboot automatically.

### A6. Service management commands

```powershell
# Check status of all EntraLogin services
sc query entralogin-api
sc query nginx-entralogin

# Stop / start
net stop  entralogin-api
net start entralogin-api

# View logs
Get-Content C:\Logs\entralogin\out.log -Tail 50 -Wait     # live tail
Get-Content C:\Logs\entralogin\err.log -Tail 50           # errors
Get-Content C:\nginx\logs\error.log    -Tail 20            # nginx errors

# Edit service config (opens NSSM GUI)
nssm edit entralogin-api
nssm edit nginx-entralogin
```

### A7. SSL / HTTPS with win-acme

After the script completes and DNS is resolving to your server:

1. Download **win-acme** from https://www.win-acme.com
2. Extract to `C:\win-acme`
3. Run as Administrator:
   ```
   C:\win-acme\wacs.exe
   ```
4. Choose: *Manually input host names* → enter your domain → *nginx* as web installer
5. win-acme will obtain a Let's Encrypt certificate and update `C:\nginx\conf\nginx.conf` automatically
6. Update your Entra redirect URI to use `https://`

### A8. Updating the application

```powershell
cd C:\deploy\entralogin

# Pull latest code
git pull origin main

# Rebuild frontend
cd frontend; npm install; npm run build; cd ..

# Update backend dependencies (if package.json changed)
cd backend; npm install --omit=dev; cd ..

# Restart the backend service to pick up code changes
net stop entralogin-api
net start entralogin-api

# Reload nginx if the config changed
net stop nginx-entralogin
net start nginx-entralogin
```

### A9. Troubleshooting (Windows)

**Service fails to start**
```powershell
nssm status entralogin-api
Get-Content C:\Logs\entralogin\err.log -Tail 50
Get-EventLog -LogName Application -Newest 20 | Where-Object { $_.Source -eq 'entralogin-api' }
```

**Port 80 already in use (IIS or another service)**
```powershell
netstat -ano | findstr :80
# Find the PID and stop that service, or change the nginx listen port
```

**MongoDB not connecting**
```powershell
sc query MongoDB
mongosh --eval "db.adminCommand({ping:1})"
```

**Redis not connecting**
```powershell
sc query Redis
redis-cli ping   # should return PONG
```

**nginx config test**
```powershell
C:\nginx\nginx.exe -p C:\nginx -t
```

---

## Linux Deployment

Complete instructions for deploying EntraLogin on a Ubuntu/Debian Linux server.

---

## Table of Contents

1. [Server Requirements](#1-server-requirements)
2. [Pre-Deployment Checklist](#2-pre-deployment-checklist)
3. [Microsoft Entra External ID Setup](#3-microsoft-entra-external-id-setup)
4. [Upload Code to the Server](#4-upload-code-to-the-server)
5. [Run the Deployment Script](#5-run-the-deployment-script)
6. [What the Script Installs](#6-what-the-script-installs)
7. [SSL / HTTPS with Certbot](#7-ssl--https-with-certbot)
8. [Post-Deployment Verification](#8-post-deployment-verification)
9. [MongoDB Security Hardening](#9-mongodb-security-hardening)
10. [Updating the Application](#10-updating-the-application)
11. [PM2 Process Management](#11-pm2-process-management)
12. [Nginx Configuration](#12-nginx-configuration)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Server Requirements

| Resource | Minimum             | Recommended         |
|----------|---------------------|---------------------|
| OS       | Ubuntu 20.04 LTS    | Ubuntu 22.04/24.04 LTS |
| CPU      | 1 vCPU              | 2 vCPU              |
| RAM      | 1 GB                | 2 GB                |
| Disk     | 10 GB               | 20 GB               |
| Ports    | 22 (SSH), 80, 443   | Same                |

**Supported distributions:** Ubuntu 20.04, 22.04, 24.04 · Debian 11, 12

For other distributions (CentOS, RHEL, Amazon Linux), follow the manual steps in each section instead of running `deploy.sh`.

---

## 2. Pre-Deployment Checklist

Before running the script, confirm:

- [ ] A domain name (e.g. `auth.example.com`) points to the server's IP via an `A` record  
      *(DNS propagation can take up to 24 h — check with `dig auth.example.com +short`)*
- [ ] Inbound firewall rules allow TCP 22, 80, 443
- [ ] You can SSH into the server as a user with `sudo` access
- [ ] You have your Microsoft Entra External ID credentials ready (see §3)
- [ ] You have SMTP credentials for a transactional email service (required for OTP)

---

## 3. Microsoft Entra External ID Setup

Follow `ENTRA_SETUP.md` in full before deploying. Key values you will need during `deploy.sh`:

| Prompt in deploy.sh       | Where to find it in the Azure portal           |
|---------------------------|------------------------------------------------|
| Entra Application (Client) ID | App registrations → your app → Overview → Application (client) ID |
| Entra Tenant (Directory) ID   | App registrations → your app → Overview → Directory (tenant) ID  |
| Entra tenant subdomain        | External Identities → Overview → Domain (the part before `.onmicrosoft.com`) |
| Entra Client Secret           | App registrations → your app → Certificates & secrets → new client secret |

### Required API permissions

Your app registration needs **both** of these:

| Permission         | Type        | Why                                    |
|--------------------|-------------|----------------------------------------|
| `User.Read`        | Delegated   | Read signed-in user's profile          |
| `User.ReadWrite.All` | Application | Provision OTP users into Entra directory |

After granting `User.ReadWrite.All` (Application), click **Grant admin consent**.

### Redirect URI

Add the following URI in **Authentication → Platform configurations → Web → Redirect URIs**:

```
https://<your-domain>/api/auth/entra/callback
```

*(The script will print the exact URI at the end of setup.)*

---

## 4. Upload Code to the Server

### Option A — Git clone (recommended)

```bash
ssh user@your-server
git clone https://github.com/your-org/entralogin.git
cd entralogin
```

### Option B — SCP / SFTP

From your local machine, upload the project folder:

```bash
scp -r ./EntraLogin user@your-server:/home/user/entralogin
ssh user@your-server
cd entralogin
```

### Option C — rsync

```bash
rsync -avz --exclude node_modules --exclude '*/dist' \
  ./EntraLogin/ user@your-server:/home/user/entralogin/
```

---

## 5. Run the Deployment Script

```bash
cd entralogin
chmod +x deploy.sh
bash deploy.sh
```

The script is **interactive** — it will prompt for all required values and print a summary before making any changes. A full transcript is saved to `deploy.log`.

### What the script configures at each prompt

| Prompt | Notes |
|--------|-------|
| Domain name | Use `localhost` only for testing on the server itself |
| Backend port | Default `5000`. Change if another service uses that port. |
| MongoDB URI | Default `mongodb://127.0.0.1:27017/entralogin` (local) |
| Redis URL | Default `redis://127.0.0.1:6379` (local) |
| JWT secrets | Leave blank to auto-generate a cryptographically secure value |
| Entra credentials | From §3 above. Required for "Sign in with Microsoft". |
| SMTP settings | Required — OTP emails will not be sent without a working SMTP server |

---

## 6. What the Script Installs

| Component | Version | Notes |
|-----------|---------|-------|
| Node.js | 20 LTS | Via NodeSource apt repo |
| MongoDB | 7.0 CE | Via official MongoDB apt repo |
| Redis | System package | `redis-server` via apt |
| Nginx | System package | Reverse-proxy + static file server |
| PM2 | Latest | Node.js process manager (global npm install) |

**Existing services are not removed or reconfigured.** The script skips installation for any component that is already present and >= the minimum version.

### Files written by the script

| File | Purpose |
|------|---------|
| `backend/.env` | Application environment variables (chmod 600) |
| `ecosystem.config.cjs` | PM2 process configuration |
| `/etc/nginx/sites-available/entralogin` | Nginx virtual host |
| `/etc/nginx/sites-enabled/entralogin` | Symlink to enable the site |
| `/var/log/entralogin/` | Directory for PM2 log files |
| `deploy.log` | Full transcript of the deployment run |

---

## 7. SSL / HTTPS with Certbot

After the script completes and DNS is pointing to your server:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d auth.example.com
```

Certbot will:
1. Obtain a certificate from Let's Encrypt
2. Modify the Nginx config to redirect HTTP → HTTPS and use the certificate
3. Set up automatic renewal via a systemd timer

Verify auto-renewal:

```bash
sudo certbot renew --dry-run
```

After enabling SSL, update your Entra redirect URI to use `https://`.

---

## 8. Post-Deployment Verification

```bash
# 1. Check the app is running
pm2 status

# 2. Hit the health endpoint
curl http://localhost:5000/api/health

# 3. Check Nginx is serving the frontend
curl -I http://your-domain/

# 4. Test the full OTP flow via browser
open http://your-domain/login
```

If the API returns `{"status":"ok"}` and the browser shows the login page, the deployment is successful.

---

## 9. MongoDB Security Hardening

By default MongoDB only binds to `127.0.0.1` (not accessible from the internet), but for a production deployment you should also enable authentication:

```bash
# 1. Connect to mongo and create an admin user
mongosh

use admin
db.createUser({
  user: "adminUser",
  pwd: passwordPrompt(),
  roles: [{ role: "userAdminAnyDatabase", db: "admin" }]
})

# 2. Create an app-specific user
use entralogin
db.createUser({
  user: "entralogin",
  pwd: passwordPrompt(),
  roles: [{ role: "readWrite", db: "entralogin" }]
})
exit

# 3. Enable auth in mongod.conf
sudo nano /etc/mongod.conf
# Add under the "security" section:
#   security:
#     authorization: enabled

sudo systemctl restart mongod
```

Update `MONGODB_URI` in `backend/.env` to include credentials:

```
MONGODB_URI=mongodb://entralogin:<password>@127.0.0.1:27017/entralogin?authSource=entralogin
```

Then restart the backend:

```bash
pm2 restart entralogin-api
```

---

## 10. Updating the Application

```bash
# Pull latest code
git pull origin main

# Rebuild the frontend
cd frontend && npm install && npm run build && cd ..

# Update backend dependencies (if package.json changed)
cd backend && npm install --omit=dev && cd ..

# Reload the backend without downtime
pm2 reload entralogin-api

# If environment variables changed, restart instead of reload
pm2 restart entralogin-api
```

---

## 11. PM2 Process Management

```bash
# View running processes
pm2 status

# Tail live logs
pm2 logs entralogin-api

# Tail only errors
pm2 logs entralogin-api --err

# Restart the backend
pm2 restart entralogin-api

# Reload without downtime (zero-downtime restart)
pm2 reload entralogin-api

# Stop the backend
pm2 stop entralogin-api

# Persist current process list to survive reboots
pm2 save
```

### Enable PM2 auto-start on reboot

Run the command printed at the end of `deploy.sh`, or obtain it again with:

```bash
pm2 startup
# Copy the printed "sudo env PATH=..." command and run it
pm2 save
```

---

## 12. Nginx Configuration

The generated config is at `/etc/nginx/sites-available/entralogin`.

The template source is `nginx/entralogin.conf` in the project repository.

```bash
# Test configuration for syntax errors
sudo nginx -t

# Reload without dropping connections
sudo systemctl reload nginx

# View Nginx access log
sudo tail -f /var/log/nginx/access.log

# View Nginx error log
sudo tail -f /var/log/nginx/error.log
```

If you have **multiple web apps** on the same server, each gets its own file in `sites-available/`. Do not edit `/etc/nginx/nginx.conf` directly.

---

## 13. Troubleshooting

### OTP emails not arriving

1. Confirm `SMTP_HOST` is set in `backend/.env`
2. Check PM2 error log: `pm2 logs entralogin-api --err`
3. Test SMTP credentials independently:
   ```bash
   node -e "
   const n = require('nodemailer');
   n.createTransport({
     host: process.env.SMTP_HOST,
     port: 587,
     auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
   }).verify().then(()=>console.log('OK')).catch(console.error);
   " 
   ```

### "Sign in with Microsoft" button shows an error

1. Verify all four Entra env vars are set in `backend/.env`
2. Confirm the redirect URI in the Azure portal **exactly** matches `ENTRA_REDIRECT_URI`
3. Check PM2 logs for MSAL errors: `pm2 logs entralogin-api`

### MongoDB connection refused

```bash
sudo systemctl status mongod
sudo journalctl -u mongod -n 50
```

Ensure `MONGODB_URI` in `.env` matches your MongoDB configuration (include auth credentials if you enabled them in §9).

### Redis connection refused

```bash
sudo systemctl status redis-server
redis-cli ping   # should return PONG
```

### Port 5000 already in use

Change `PORT=` in `backend/.env` and update the Nginx config:

```bash
sudo nano /etc/nginx/sites-available/entralogin
# Update proxy_pass to use the new port
sudo nginx -t && sudo systemctl reload nginx
pm2 restart entralogin-api
```

### Nginx config test fails

```bash
sudo nginx -t
# Read the error output carefully — it includes the file and line number
```

Common causes: syntax error after manual edit, or `root` path does not exist (frontend not built yet).

### Frontend shows blank page after deployment

The React build may not have completed or the Nginx `root` path is wrong.

```bash
ls /path/to/entralogin/frontend/dist/index.html   # should exist
sudo nginx -T | grep root                          # verify the path
```

Rebuild if needed:

```bash
cd /path/to/entralogin/frontend
npm run build
sudo systemctl reload nginx
```

---

## Environment variable reference

All variables are set in `backend/.env`. A documented template is at `backend/.env.example`.

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | Yes | Express listen port (default `5000`) |
| `NODE_ENV` | Yes | Must be `production` on the server |
| `MONGODB_URI` | Yes | Full MongoDB connection string |
| `REDIS_URL` | Yes | Redis connection URL |
| `JWT_SECRET` | Yes | HS256 signing secret for access tokens |
| `JWT_REFRESH_SECRET` | Yes | HS256 signing secret for refresh tokens |
| `FRONTEND_URL` | Yes | Full URL of the front end (for CORS & redirects) |
| `ENTRA_CLIENT_ID` | Yes* | Azure app registration client ID |
| `ENTRA_CLIENT_SECRET` | Yes* | Azure client secret |
| `ENTRA_TENANT_ID` | Yes* | Azure directory (tenant) ID |
| `ENTRA_TENANT_SUBDOMAIN` | Yes* | CIAM subdomain (before `.onmicrosoft.com`) |
| `ENTRA_REDIRECT_URI` | Yes* | OAuth2 callback URL |
| `SMTP_HOST` | Yes | SMTP relay hostname |
| `SMTP_PORT` | Yes | SMTP port (usually 587 for STARTTLS) |
| `SMTP_SECURE` | No | `true` for port 465 (TLS), `false` for STARTTLS |
| `SMTP_USER` | Yes | SMTP authentication username |
| `SMTP_PASS` | Yes | SMTP authentication password |
| `EMAIL_FROM_NAME` | No | Display name in the From header |
| `EMAIL_FROM_ADDRESS` | Yes | Sender email address |

\* Required for Microsoft Entra sign-in. OTP-only login still works without these.
