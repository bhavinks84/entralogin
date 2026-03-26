#Requires -RunAsAdministrator
<#
.SYNOPSIS
    EntraLogin – Production Deployment for Windows Server
.DESCRIPTION
    Installs prerequisites (Chocolatey, Node.js 20, MongoDB 7, Redis, nginx,
    NSSM) and deploys the EntraLogin authentication portal as Windows services.
.NOTES
    Supported : Windows Server 2016 / 2019 / 2022
    Run as   : Administrator
    Usage    : powershell -ExecutionPolicy Bypass -File deploy.ps1
               (from the EntraLogin project root)
    Log      : .\deploy.log
#>
[CmdletBinding()] param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'   # suppress Invoke-WebRequest bars

# ── helpers ───────────────────────────────────────────────────────────────────
function Write-Step  ($msg) { Write-Host "`n──── $msg ────" -ForegroundColor Cyan }
function Write-Ok    ($msg) { Write-Host "  ✓  $msg"        -ForegroundColor Green }
function Write-Info  ($msg) { Write-Host "  ▸  $msg"        -ForegroundColor DarkCyan }
function Write-Warn  ($msg) { Write-Host "  ⚠  $msg"        -ForegroundColor Yellow }
function Write-Fatal ($msg) { Write-Host "  ✗  FATAL: $msg" -ForegroundColor Red; exit 1 }

function Ask {
    param([string]$Prompt, [string]$Default = '')
    $hint = if ($Default) { " [$Default]" } else { '' }
    $raw  = Read-Host "    > $Prompt$hint"
    if ([string]::IsNullOrWhiteSpace($raw)) { $Default } else { $raw.Trim() }
}

function AskSecret {
    param([string]$Prompt)
    $ss  = Read-Host "    > $Prompt" -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss)
    try { [Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function GenSecret {
    $buf = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
    ($buf | ForEach-Object { $_.ToString('x2') }) -join ''
}

function CmdExists { param($Name) $null -ne (Get-Command $Name -ErrorAction SilentlyContinue) }

function RefreshPath {
    $m = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine')
    $u = [System.Environment]::GetEnvironmentVariable('PATH', 'User')
    $env:PATH = "$m;$u"
}

function Invoke-Choco {
    param([string[]]$ChocoArgs)
    & choco @ChocoArgs --no-progress --yes 2>&1 |
        Where-Object { $_ -match '(installed|upgraded|already installed|ERROR|WARNING)' } |
        ForEach-Object { Write-Info "$_" }
}

function Get-ServiceByNames {
    param([string[]]$Names)
    foreach ($n in $Names) {
        $s = Get-Service $n -ErrorAction SilentlyContinue
        if ($s) { return $s }
    }
    return $null
}

# ── constants ─────────────────────────────────────────────────────────────────
$NGINX_VERSION = '1.26.2'
$NGINX_URL     = "https://nginx.org/download/nginx-$NGINX_VERSION.zip"
$NGINX_DIR     = 'C:\nginx'
$LOG_DIR       = 'C:\Logs\entralogin'

# ── paths ─────────────────────────────────────────────────────────────────────
$Dir         = $PSScriptRoot
$BackendDir  = Join-Path $Dir 'backend'
$FrontendDir = Join-Path $Dir 'frontend'
$LogFile     = Join-Path $Dir 'deploy.log'

Start-Transcript -Path $LogFile -Append | Out-Null

# ── banner ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║  EntraLogin – Production Deployment (Windows)   ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── pre-flight ─────────────────────────────────────────────────────────────────
Write-Step "Pre-flight checks"

if (-not (Test-Path $BackendDir))  { Write-Fatal "backend/ not found. Run from the project root." }
if (-not (Test-Path $FrontendDir)) { Write-Fatal "frontend/ not found. Run from the project root." }
Write-Ok "Project root: $Dir"

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Fatal "This script must be run as Administrator."
}
Write-Ok "Running as Administrator"

$osCaption = (Get-WmiObject Win32_OperatingSystem).Caption
Write-Ok "OS: $osCaption"
if ($osCaption -notmatch 'Windows Server') {
    Write-Warn "Script targets Windows Server. Proceeding — some steps may behave differently."
}

# ── Chocolatey ────────────────────────────────────────────────────────────────
Write-Step "Package manager (Chocolatey)"

if (-not (CmdExists 'choco')) {
    Write-Info "Installing Chocolatey..."
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072
    Invoke-Expression ((New-Object Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    RefreshPath
    Write-Ok "Chocolatey installed"
} else {
    Write-Ok "Chocolatey already installed"
}

# ── Node.js ───────────────────────────────────────────────────────────────────
Write-Step "Node.js"

$needsNode = $true
if (CmdExists 'node') {
    $nodeMajor = [int]((node -v) -replace 'v(\d+).*', '$1')
    if ($nodeMajor -ge 18) {
        Write-Ok "Node.js $(node -v) already installed"
        $needsNode = $false
    } else {
        Write-Info "Upgrading Node.js (found v$nodeMajor, need >= 18)..."
        Invoke-Choco @('install', 'nodejs-lts', '--force')
        RefreshPath
    }
}
if ($needsNode) {
    Write-Info "Installing Node.js 20 LTS..."
    Invoke-Choco @('install', 'nodejs-lts')
    RefreshPath
    Write-Ok "Node.js $(node -v) installed"
}

# ── MongoDB ───────────────────────────────────────────────────────────────────
Write-Step "MongoDB"

if (CmdExists 'mongod') {
    Write-Ok "MongoDB already installed"
} else {
    Write-Info "Installing MongoDB 7.0..."
    Invoke-Choco @('install', 'mongodb')
    RefreshPath
    Write-Ok "MongoDB installed"
}

# ── NSSM (Windows service wrapper) ───────────────────────────────────────────
if (-not (CmdExists 'nssm')) {
    Write-Info "Installing NSSM..."
    Invoke-Choco @('install', 'nssm')
    RefreshPath
}
Write-Ok "NSSM ready"

# ── Redis for Windows ─────────────────────────────────────────────────────────
Write-Step "Redis"

Write-Warn "Checking for Redis..."
$redisExe = 'C:\Program Files\Redis\redis-server.exe'
if (-not (Test-Path $redisExe)) {
    Write-Info "Installing redis-64 (Windows community port of Redis 3.0)..."
    Write-Warn "redis-64 v3.0 is a 2016 Windows port. For production traffic:"
    Write-Warn "  - Memurai     https://www.memurai.com  (Redis-compatible Windows service)"
    Write-Warn "  - Redis Cloud https://redis.io/cloud   (managed cloud Redis)"
    Write-Warn "Continuing with redis-64 which handles OTP/session workloads adequately."
    Invoke-Choco @('install', 'redis-64')
    RefreshPath
}
Write-Ok "Redis ready"

# ── nginx for Windows (direct download) ──────────────────────────────────────
Write-Step "nginx $NGINX_VERSION"

if (Test-Path "$NGINX_DIR\nginx.exe") {
    Write-Ok "nginx already installed at $NGINX_DIR"
} else {
    Write-Info "Downloading nginx $NGINX_VERSION from nginx.org..."
    $zipPath = Join-Path $env:TEMP 'nginx.zip'
    Invoke-WebRequest -Uri $NGINX_URL -OutFile $zipPath
    Write-Info "Extracting..."
    Expand-Archive -Path $zipPath -DestinationPath 'C:\' -Force
    if (Test-Path "C:\nginx-$NGINX_VERSION") {
        Rename-Item "C:\nginx-$NGINX_VERSION" $NGINX_DIR -ErrorAction SilentlyContinue
    }
    Remove-Item $zipPath -Force
    New-Item -ItemType Directory -Path "$NGINX_DIR\logs" -Force | Out-Null
    Write-Ok "nginx $NGINX_VERSION installed to $NGINX_DIR"
}

# ── collect configuration ─────────────────────────────────────────────────────
Write-Step "Configuration"
Write-Host "  Press Enter to accept the value shown in [brackets]."
Write-Host ""

$Domain      = Ask 'Public domain / hostname (e.g. auth.example.com)' 'localhost'
$NginxPort   = Ask 'nginx listen port  (choose a free port – NOT 80 or 443)' '8080'
$ApiPort     = Ask 'Express backend port (internal, not exposed publicly)'  '5000'
$MongoUri = Ask 'MongoDB connection URI'                           'mongodb://127.0.0.1:27017/entralogin'
$RedisUrl = Ask 'Redis URL'                                        'redis://127.0.0.1:6379'

Write-Host ""
Write-Info "JWT secrets — press Enter to auto-generate secure random values"
$JwtSecret  = Ask 'JWT_SECRET         (blank = auto-generate)' ''
$JwtRefresh = Ask 'JWT_REFRESH_SECRET (blank = auto-generate)' ''
if ([string]::IsNullOrEmpty($JwtSecret))  { $JwtSecret  = GenSecret; Write-Info "JWT_SECRET auto-generated" }
if ([string]::IsNullOrEmpty($JwtRefresh)) { $JwtRefresh = GenSecret; Write-Info "JWT_REFRESH_SECRET auto-generated" }

Write-Host ""
Write-Info "Microsoft Entra External ID — see ENTRA_SETUP.md for details"
$EntraClientId  = Ask 'Entra Application (Client) ID'      ''
$EntraTenantId  = Ask 'Entra Tenant (Directory) ID'        ''
$EntraTenantSub = Ask 'Entra tenant subdomain (e.g. myapp)' ''
$EntraSecret    = AskSecret 'Entra Client Secret'

$Protocol      = if ($Domain -eq 'localhost') { 'http' } else { 'https' }
# Include the port in public URLs only when it differs from the scheme default
$PortSuffix    = if (($Protocol -eq 'http' -and $NginxPort -ne '80') -or
                     ($Protocol -eq 'https' -and $NginxPort -ne '443')) { ":$NginxPort" } else { '' }
$FrontendUrl   = if ($Domain -eq 'localhost') { "http://localhost:${NginxPort}" } `
                 else                          { "${Protocol}://${Domain}${PortSuffix}" }
$EntraRedirect = "${FrontendUrl}/api/auth/entra/callback"
Write-Info "Entra redirect URI → $EntraRedirect"

Write-Host ""
Write-Info "SMTP / email settings (required for OTP delivery)"
$SmtpHost  = Ask 'SMTP hostname (e.g. smtp.sendgrid.net)' ''
$SmtpPort  = Ask 'SMTP port'                              '587'
$SmtpUser  = Ask 'SMTP username'                          ''
$SmtpPass  = AskSecret 'SMTP password'
$EmailFrom = Ask 'From address'       "noreply@$Domain"
$EmailName = Ask 'From display name'  'EntraLogin'

# ── confirmation ──────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "──── Summary ────" -ForegroundColor Cyan
Write-Host "  Domain        : $Domain"
Write-Host "  nginx port    : $NginxPort"
Write-Host "  API port      : $ApiPort"
Write-Host "  MongoDB URI   : $MongoUri"
Write-Host "  Redis URL     : $RedisUrl"
Write-Host "  Entra client  : $(if ($EntraClientId) { $EntraClientId } else { '<not set>' })"
Write-Host "  SMTP host     : $(if ($SmtpHost) { $SmtpHost } else { '<not set>' })"
Write-Host "  Frontend URL  : $FrontendUrl"
Write-Host "  Redirect URI  : $EntraRedirect"
Write-Host ""
$confirm = Read-Host "  Proceed with deployment? [y/N]"
if ($confirm -notmatch '^[Yy]') { Write-Host "Aborted."; Stop-Transcript | Out-Null; exit 0 }

# ── write backend\.env ────────────────────────────────────────────────────────
Write-Step "Writing backend\.env"

$EnvFile  = Join-Path $BackendDir '.env'
if (Test-Path $EnvFile) {
    Write-Warn ".env already exists — backing up to .env.bak"
    Copy-Item $EnvFile "$EnvFile.bak" -Force
}

$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
# Build as an array to avoid variable-expansion issues with special chars in secrets
[string[]]$envLines = @(
    "# EntraLogin – backend environment",
    "# Generated by deploy.ps1 on $timestamp",
    "",
    "PORT=$ApiPort",
    "NODE_ENV=production",
    "",
    "MONGODB_URI=$MongoUri",
    "REDIS_URL=$RedisUrl",
    "",
    "JWT_SECRET=$JwtSecret",
    "JWT_REFRESH_SECRET=$JwtRefresh",
    "",
    "FRONTEND_URL=$FrontendUrl",
    "",
    "# Microsoft Entra External ID",
    "ENTRA_CLIENT_ID=$EntraClientId",
    "ENTRA_CLIENT_SECRET=$EntraSecret",
    "ENTRA_TENANT_ID=$EntraTenantId",
    "ENTRA_TENANT_SUBDOMAIN=$EntraTenantSub",
    "ENTRA_REDIRECT_URI=$EntraRedirect",
    "",
    "# SMTP / Email (required for OTP delivery)",
    "SMTP_HOST=$SmtpHost",
    "SMTP_PORT=$SmtpPort",
    "SMTP_SECURE=false",
    "SMTP_USER=$SmtpUser",
    "SMTP_PASS=$SmtpPass",
    "EMAIL_FROM_NAME=$EmailName",
    "EMAIL_FROM_ADDRESS=$EmailFrom"
)
$envLines | Set-Content $EnvFile -Encoding UTF8

# Restrict file to current user only (no Everyone / BUILTIN\Users)
$acl = Get-Acl $EnvFile
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    [System.Security.Principal.WindowsIdentity]::GetCurrent().Name,
    'FullControl', 'Allow')
$acl.AddAccessRule($rule)
Set-Acl $EnvFile $acl

Write-Ok ".env written (restricted to current user)"

# ── install dependencies & build ──────────────────────────────────────────────
Write-Step "Installing dependencies and building"

Write-Info "Backend – npm install (production)..."
Push-Location $BackendDir
npm install --omit=dev --silent
Pop-Location
Write-Ok "Backend dependencies installed"

Write-Info "Frontend – npm install and build..."
Push-Location $FrontendDir
npm install --silent
npm run build
Pop-Location
$FrontendDist = Join-Path $FrontendDir 'dist'
Write-Ok "Frontend built → $FrontendDist"

# ── configure nginx ───────────────────────────────────────────────────────────
Write-Step "Configuring nginx"

$nginxTemplate = Join-Path $Dir 'nginx\entralogin.windows.conf'
if (-not (Test-Path $nginxTemplate)) {
    Write-Fatal "nginx Windows template not found: $nginxTemplate"
}

# nginx requires forward slashes even on Windows
$FrontendDistFwd = $FrontendDist -replace '\\', '/'

$nginxConf = Get-Content $nginxTemplate -Raw
$nginxConf = $nginxConf -replace '__DOMAIN__',        $Domain
$nginxConf = $nginxConf -replace '__NGINX_PORT__',    $NginxPort
$nginxConf = $nginxConf -replace '__FRONTEND_DIST__', $FrontendDistFwd
$nginxConf = $nginxConf -replace '__BACKEND_PORT__',  $ApiPort
Set-Content "$NGINX_DIR\conf\nginx.conf" $nginxConf -Encoding UTF8

# Validate config syntax
$testResult = & "$NGINX_DIR\nginx.exe" -p $NGINX_DIR -t 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host $testResult
    Write-Fatal "nginx configuration test failed. See above for details."
}
Write-Ok "nginx configuration validated"

# Register nginx as a Windows service via NSSM
$nginxSvc = 'nginx-entralogin'
if (Get-Service $nginxSvc -ErrorAction SilentlyContinue) {
    Write-Info "Removing existing nginx service..."
    Stop-Service $nginxSvc -Force -ErrorAction SilentlyContinue
    & nssm remove $nginxSvc confirm | Out-Null
}
& nssm install    $nginxSvc "$NGINX_DIR\nginx.exe"
& nssm set        $nginxSvc AppParameters "-p $NGINX_DIR"
& nssm set        $nginxSvc DisplayName   "EntraLogin – nginx"
& nssm set        $nginxSvc AppStdout     "$NGINX_DIR\logs\service.log"
& nssm set        $nginxSvc AppStderr     "$NGINX_DIR\logs\service.log"
& nssm set        $nginxSvc Start         SERVICE_AUTO_START
Start-Service $nginxSvc
Write-Ok "nginx service started"

# ── ensure MongoDB and Redis are running ──────────────────────────────────────
Write-Step "Starting MongoDB and Redis"

$mongoSvc = Get-ServiceByNames @('MongoDB', 'mongodb', 'mongod')
if ($mongoSvc) {
    Set-Service $mongoSvc.Name -StartupType Automatic
    if ($mongoSvc.Status -ne 'Running') { Start-Service $mongoSvc.Name }
    Write-Ok "MongoDB service running"
} else {
    Write-Warn "MongoDB service not found — check Chocolatey install or start manually."
}

$redisSvc = Get-ServiceByNames @('Redis', 'redis', 'redis-server')
if ($redisSvc) {
    Set-Service $redisSvc.Name -StartupType Automatic
    if ($redisSvc.Status -ne 'Running') { Start-Service $redisSvc.Name }
    Write-Ok "Redis service running"
} else {
    Write-Warn "Redis service not found — start Redis manually or update REDIS_URL in .env."
}

# ── Node.js backend as Windows service ───────────────────────────────────────
Write-Step "Registering Node.js backend service"

New-Item -ItemType Directory -Path $LOG_DIR -Force | Out-Null
$nodeExe = (Get-Command node -ErrorAction Stop).Source
$apiSvc  = 'entralogin-api'

if (Get-Service $apiSvc -ErrorAction SilentlyContinue) {
    Write-Info "Removing existing entralogin-api service..."
    Stop-Service $apiSvc -Force -ErrorAction SilentlyContinue
    & nssm remove $apiSvc confirm | Out-Null
}

& nssm install $apiSvc $nodeExe "src/server.js"
& nssm set     $apiSvc AppDirectory         $BackendDir
& nssm set     $apiSvc AppEnvironmentExtra  "NODE_ENV=production"
& nssm set     $apiSvc AppStdout            "$LOG_DIR\out.log"
& nssm set     $apiSvc AppStderr            "$LOG_DIR\err.log"
& nssm set     $apiSvc AppRotateFiles       1
& nssm set     $apiSvc AppRotateBytesHigh   0
& nssm set     $apiSvc AppRotateBytesLow    10485760   # rotate at 10 MB
& nssm set     $apiSvc DisplayName          "EntraLogin – API"
& nssm set     $apiSvc Description          "Express.js backend for EntraLogin"
& nssm set     $apiSvc Start                SERVICE_AUTO_START
Start-Service $apiSvc
Write-Ok "entralogin-api service started"

# ── Windows Firewall ──────────────────────────────────────────────────────────
Write-Step "Windows Firewall rules"

# Open the custom nginx port and the internal API port (localhost-only; not needed publicly)
$fwRules = @(
    @{Name='EntraLogin nginx'; Port=[int]$NginxPort}
)
foreach ($portDef in $fwRules) {
    if (-not (Get-NetFirewallRule -DisplayName $portDef.Name -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $portDef.Name -Direction Inbound `
            -Protocol TCP -LocalPort $portDef.Port -Action Allow | Out-Null
        Write-Ok "Rule added: $($portDef.Name) (TCP $($portDef.Port))"
    } else {
        Write-Ok "Rule already exists: $($portDef.Name)"
    }
}

# ── done ──────────────────────────────────────────────────────────────────────
Stop-Transcript | Out-Null

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║              Deployment complete!                ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  App URL   :  $FrontendUrl"
Write-Host "  Health    :  ${FrontendUrl}/api/health"
Write-Host "  API log   :  $LOG_DIR\out.log"
Write-Host "  Error log :  $LOG_DIR\err.log"
Write-Host "  Full log  :  $LogFile"
Write-Host ""
Write-Host "  Service management:" -ForegroundColor Yellow
Write-Host "    sc query entralogin-api          check status"
Write-Host "    net stop / net start <svc>        stop or start a service"
Write-Host "    nssm edit entralogin-api          edit service config (GUI)"
Write-Host "    Get-EventLog -LogName Application check Windows event log"
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor Yellow
if ($Domain -ne 'localhost') {
    Write-Host "  1. SSL  →  Install win-acme: https://www.win-acme.com"
    Write-Host "             Run: wacs.exe  (follow prompts for domain $Domain, port $NginxPort)"
}
Write-Host "  2. Entra portal → add Redirect URI: $EntraRedirect"
if ([string]::IsNullOrEmpty($SmtpHost)) {
    Write-Warn "SMTP_HOST not set — OTP emails will fail. Edit $EnvFile and restart entralogin-api."
}
Write-Host ""
Write-Host "  Full guide: DEPLOYMENT.md" -ForegroundColor Cyan
Write-Host ""
