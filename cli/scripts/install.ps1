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
#                             e.g. `1.2.0`. Default: `latest`, resolved to
#                             the newest `cli-*` tag through the releases
#                             API - NOT through /releases/latest, which
#                             points at whichever component shipped last.

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

# Before any GitHub request. Older Windows PowerShell defaults to TLS 1.0,
# which GitHub rejects. The zip download used to be the only request; the
# release lookup is one too, so this has to be set first or `latest` fails
# on those hosts while a pinned OPENLIT_VERSION still installs.
[Net.ServicePointManager]::SecurityProtocol = `
    [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# --- Resolve the asset URL --------------------------------------------------

# `/releases/latest` cannot be used here. This repository releases many
# components from one tree - openlit-*, py-*, ts-*, controller-*,
# otel-gpu-collector-* - and GitHub's "latest" is whichever of them was
# published most recently, regardless of component. That release does not
# carry the CLI archives, so the download 404s (#1596). Resolve the newest
# `cli-*` tag instead; the releases API returns newest first. Both
# installers use that rule; do not skip prereleases here unless install.sh
# does too.
$asset = "openlit-windows-$arch.zip"
if ($Version -eq 'latest') {
    Write-OpenLit 'Resolving the latest CLI release'
    $releasesApi = "https://api.github.com/repos/$Repo/releases"
    # Page, rather than reading only the first 100. The CLI is one component
    # among many, so its newest tag will not stay on page 1. Walk until a
    # cli-* tag is found, the list ends, or a ten-page cap. The cap stops a
    # repository with no cli-* release from walking every page before failing.
    # A thrown request fails the install in the catch below; it does not
    # look like an empty page. Unauthenticated calls are rate limited
    # (60/hour per IP).
    $tag = $null
    # Resolve once. Windows PowerShell 5.1 and PowerShell 6+ do not accept
    # the same User-Agent spelling, and -UseBasicParsing is not universal.
    $irm = Get-Command Invoke-RestMethod
    for ($page = 1; $page -le 10 -and -not $tag; $page++) {
        $irmParams = @{ Uri = "${releasesApi}?per_page=100&page=$page" }
        if ($irm.Parameters.Keys -contains 'UseBasicParsing') {
            $irmParams.UseBasicParsing = $true
        }
        # 5.1 sets User-Agent through Headers. PowerShell 6+ rejects that
        # restricted header and requires -UserAgent.
        if ($irm.Parameters.Keys -contains 'UserAgent') {
            $irmParams.UserAgent = 'openlit-installer'
        } else {
            $irmParams.Headers = @{ 'User-Agent' = 'openlit-installer' }
        }
        try {
            $releases = Invoke-RestMethod @irmParams
        } catch {
            Stop-OpenLit "could not reach $releasesApi ($($_.Exception.Message)). Set `$env:OPENLIT_VERSION to a published CLI version (for example 0.0.1) and re-run."
        }
        if (-not $releases -or $releases.Count -eq 0) { break }
        $tag = ($releases | Where-Object { $_.tag_name -like 'cli-*' } | Select-Object -First 1).tag_name
    }
    if (-not $tag) {
        Stop-OpenLit "could not resolve the latest cli-* release from $releasesApi. Set `$env:OPENLIT_VERSION to a published CLI version (for example 0.0.1) and re-run."
    }
    Write-OpenLit "Latest CLI release is $tag"
} else {
    $tag = "cli-$Version"
}
$url = "https://github.com/$Repo/releases/download/$tag/$asset"

Write-OpenLit "Downloading $asset"

# --- Stage download into a temp dir then atomic-move -----------------------

$tmpDir = Join-Path $env:TEMP ("openlit-install-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmpDir | Out-Null

try {
    $zipPath = Join-Path $tmpDir $asset
    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing

    Expand-Archive -Path $zipPath -DestinationPath $tmpDir -Force

    # release-cli.yml zips the binary as `openlit-windows-<arch>.exe`.
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
