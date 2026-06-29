# openlit CLI uninstaller for Windows.
#
# Removes the binary installed by install.ps1 plus the on-disk state
# that the coding-agent hook subcommand caches per session. Does NOT
# touch the host-level vendor plugins — those carry user config the
# uninstaller has no business deleting. Run:
#
#   openlit coding uninstall --vendor=all
#
# BEFORE this script if you also want to detach the hooks from Claude
# Code / Cursor / Codex.
#
# Usage:
#   iwr -useb https://raw.githubusercontent.com/openlit/openlit/main/cli/scripts/uninstall.ps1 | iex
#
# Environment overrides:
#   $env:OPENLIT_INSTALL_DIR  Target install directory.
#                             Default: $env:USERPROFILE\.openlit\bin
#   $env:OPENLIT_PURGE_STATE  When `1`, also wipe the session cache +
#                             config dir. Default: 0.
#
# Exit codes:
#   0  Successfully removed (or nothing to remove).
#   1  Refused (path looks suspicious — see below).

$ErrorActionPreference = 'Stop'

$InstallDir = if ($env:OPENLIT_INSTALL_DIR) {
    $env:OPENLIT_INSTALL_DIR
} else {
    Join-Path $env:USERPROFILE '.openlit\bin'
}
$PurgeState = $env:OPENLIT_PURGE_STATE -eq '1'

function Write-OpenLit($msg) { Write-Host "openlit: $msg" }
function Stop-OpenLit($msg)  { throw "openlit: $msg" }

# Safety net: refuse to operate on suspicious install dirs. A typoed
# OPENLIT_INSTALL_DIR=C:\ or =$env:USERPROFILE would otherwise blow
# away the user's home. Require the path to look like something
# install.ps1 actually creates.
$normalised = $InstallDir.TrimEnd('\','/').ToLowerInvariant()
$suspicious = @(
    '',
    'c:',
    $env:USERPROFILE.TrimEnd('\','/').ToLowerInvariant(),
    'c:\windows',
    'c:\program files',
    'c:\program files (x86)'
)
if ($suspicious -contains $normalised) {
    Stop-OpenLit "refusing to uninstall from suspicious path: '$InstallDir'"
}

# --- Remove binary ---------------------------------------------------------

$bin = Join-Path $InstallDir 'openlit.exe'
if (Test-Path -LiteralPath $bin) {
    Remove-Item -LiteralPath $bin -Force
    Write-OpenLit "Removed binary: $bin"
} else {
    Write-OpenLit "No binary at $bin (already uninstalled?)"
}

# Remove the bin dir only when empty so we don't trample on other tools
# the user might have stored there.
if (Test-Path -LiteralPath $InstallDir) {
    if (-not (Get-ChildItem -LiteralPath $InstallDir -Force | Select-Object -First 1)) {
        Remove-Item -LiteralPath $InstallDir -Force
    }
}

# --- Optional purge of state + config -------------------------------------

if ($PurgeState) {
    # Mirrors cli/internal/coding/sessionstate/sessionstate.go (uses
    # os.UserCacheDir → %LOCALAPPDATA% on Windows) and
    # cli/internal/config/config.go (uses os.UserConfigDir →
    # %APPDATA% on Windows, with $XDG_CONFIG_HOME taking precedence).
    $cacheRoot  = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE 'AppData\Local' }
    $configRoot = if ($env:XDG_CONFIG_HOME) {
        $env:XDG_CONFIG_HOME
    } elseif ($env:APPDATA) {
        $env:APPDATA
    } else {
        Join-Path $env:USERPROFILE 'AppData\Roaming'
    }
    $cacheDir  = Join-Path $cacheRoot 'openlit'
    $configDir = Join-Path $configRoot 'openlit'
    if (Test-Path -LiteralPath $cacheDir) {
        Remove-Item -LiteralPath $cacheDir -Recurse -Force
        Write-OpenLit "Removed session cache: $cacheDir"
    }
    if (Test-Path -LiteralPath $configDir) {
        Remove-Item -LiteralPath $configDir -Recurse -Force
        Write-OpenLit "Removed config: $configDir"
    }
} else {
    Write-OpenLit "Left session cache + config in place. Set `$env:OPENLIT_PURGE_STATE='1' to also remove them."
}

Write-OpenLit ""
Write-OpenLit "Note: this script does NOT detach openlit from your coding agents."
Write-OpenLit "If you previously ran 'openlit coding install', also run:"
Write-OpenLit "  openlit coding uninstall --vendor=all"
Write-OpenLit "(while the binary is still on `$env:PATH), or remove the hook entries"
Write-OpenLit "manually from your vendor configs."
