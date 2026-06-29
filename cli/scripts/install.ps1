# openlit CLI installer for Windows.
#
# Detects architecture, downloads the matching zip from the latest
# `cli-*.*.*` GitHub Release of openlit/openlit, extracts the binary
# to $env:USERPROFILE\.openlit\bin\openlit.exe, and adds that
# directory to the user-scope PATH if it is not already there.
#
# Usage:
#   iwr -useb https://raw.githubusercontent.com/openlit/openlit/main/cli/scripts/install.ps1 | iex
#
# Environment overrides:
#   $env:OPENLIT_INSTALL_DIR  Target install directory.
#                             Default: $env:USERPROFILE\.openlit\bin
#   $env:OPENLIT_VERSION      Release tag WITHOUT the `cli-` prefix,
#                             e.g. `1.2.0`. Default: `latest`.

$ErrorActionPreference = 'Stop'

$Repo = if ($env:OPENLIT_REPO) { $env:OPENLIT_REPO } else { 'openlit/openlit' }
$InstallDir = if ($env:OPENLIT_INSTALL_DIR) {
    $env:OPENLIT_INSTALL_DIR
} else {
    Join-Path $env:USERPROFILE '.openlit\bin'
}
$Version = if ($env:OPENLIT_VERSION) { $env:OPENLIT_VERSION } else { 'latest' }

function Write-OpenLit($msg)      { Write-Host "openlit: $msg" }
function Write-OpenLitWarn($msg)  { Write-Warning "openlit: $msg" }
function Stop-OpenLit($msg)       { throw "openlit: $msg" }

# --- Detect architecture ----------------------------------------------------

# PROCESSOR_ARCHITECTURE under WoW64 is "x86" on 64-bit hosts, so we
# fall through to Is64BitOperatingSystem for the AMD64 case. ARM64
# stays as-is.
$archEnv = $env:PROCESSOR_ARCHITECTURE
if ($archEnv -eq 'ARM64') {
    $arch = 'arm64'
} elseif ([Environment]::Is64BitOperatingSystem) {
    $arch = 'amd64'
} else {
    Stop-OpenLit "unsupported architecture: $archEnv (the CLI is 64-bit only)"
}

# --- Resolve the asset URL --------------------------------------------------

$asset = "openlit-windows-$arch.zip"
$url = if ($Version -eq 'latest') {
    "https://github.com/$Repo/releases/latest/download/$asset"
} else {
    "https://github.com/$Repo/releases/download/cli-$Version/$asset"
}

Write-OpenLit "Downloading $asset"

# --- Stage download into a temp dir then atomic-move -----------------------

$tmpDir = Join-Path $env:TEMP ("openlit-install-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmpDir | Out-Null

try {
    $zipPath = Join-Path $tmpDir $asset
    # Use TLS 1.2 explicitly for older Windows PowerShell builds that
    # default to TLS 1.0; GitHub disabled that years ago and the
    # download would fail with a misleading "could not create SSL/TLS
    # secure channel" otherwise.
    [Net.ServicePointManager]::SecurityProtocol = `
        [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing

    Expand-Archive -Path $zipPath -DestinationPath $tmpDir -Force

    # cli-release.yml zips the binary as `openlit-windows-<arch>.exe`.
    # Find it defensively so a future rename in the workflow doesn't
    # silently break this installer.
    $extracted = Get-ChildItem -Path $tmpDir -Filter 'openlit*.exe' -Recurse |
        Select-Object -First 1
    if (-not $extracted) {
        Stop-OpenLit "no openlit*.exe found inside $asset"
    }

    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir | Out-Null
    }

    $target = Join-Path $InstallDir 'openlit.exe'
    Move-Item -Path $extracted.FullName -Destination $target -Force

    Write-OpenLit "Installed: $target"

    # --- User PATH update ---------------------------------------------------

    # Only touch the User scope; never the Machine scope. That keeps
    # the installer usable without admin rights and avoids accidentally
    # publishing the binary to other Windows accounts on the same box.
    $currentUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $currentUserPath) { $currentUserPath = '' }

    $pathParts = $currentUserPath -split ';' | Where-Object { $_ -ne '' }
    if ($pathParts -notcontains $InstallDir) {
        $newPath = if ($currentUserPath) { "$currentUserPath;$InstallDir" } else { $InstallDir }
        [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
        Write-OpenLit "Added $InstallDir to your user PATH (open a new terminal to pick it up)"
    }

    Write-OpenLit ""
    Write-OpenLit "Next: configure + wire a vendor. The current shell may not"
    Write-OpenLit "      have the install dir on PATH yet -- open a new terminal,"
    Write-OpenLit "      or use the absolute path below:"
    Write-OpenLit ""
    Write-OpenLit "  & `"$target`" configure --endpoint <url> --api-key <key>"
    Write-OpenLit "  & `"$target`" coding install --vendor=cursor   # or claude-code / codex"
}
finally {
    Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
}
