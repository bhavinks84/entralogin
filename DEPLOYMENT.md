# EntraLogin – Deployment Guide (Windows Server)

Supported: **Windows Server 2016 / 2019 / 2022** · Script: `deploy.ps1`

---

## 1. Prerequisites

- Windows Server 2016, 2019, or 2022
- PowerShell 5.1 or later (included with all supported versions)
- Administrator account
- Inbound firewall rule for the chosen nginx port (script adds this automatically — do NOT use 80 or 443)
- Internet access (script downloads packages automatically)
- A domain name pointed at the server's IP (for SSL)

## 2. Upload code to the server

Copy the `EntraLogin` project folder to the server via RDP file-copy, SCP, or your preferred method:

```
\\server\C$\deploy\entralogin\   ← suggested location
```

Or use Git in PowerShell:

```powershell
git clone https://github.com/bhavinks84/entralogin.git C:\deploy\entralogin
cd C:\deploy\entralogin
```

## 3. Run the deployment script

Open **PowerShell as Administrator**, then:

```powershell
cd C:\deploy\entralogin
powershell -ExecutionPolicy Bypass -File deploy.ps1
```

The script interactively prompts for every required value, prints a summary, and asks for confirmation before making any changes.

## 4. What `deploy.ps1` installs

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

## 5. Windows services created

| Service name | What it runs |
|--------------|-------------|
| `entralogin-api` | Node.js Express backend |
| `nginx-entralogin` | nginx reverse proxy + static files |
| `MongoDB` | MongoDB database |
| `Redis` | Redis key-value store |

All services are set to `Automatic` start — they come back up after a reboot automatically.

## 6. Service management commands

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

## 7. SSL / HTTPS with win-acme

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

## 8. Updating the application

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

## 9. Troubleshooting (Windows)

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
