#!/usr/bin/env sh
# openlit CLI uninstaller for macOS + Linux.
#
# Removes the binary installed by `install.sh` plus the on-disk state
# that the coding-agent hook subcommand caches per session. Does NOT
# touch the host-level vendor plugins — those carry user config the
# uninstaller has no business deleting. Use
# `openlit coding uninstall --vendor=all` BEFORE running this script
# if you also want to detach the hooks from Claude Code / Cursor /
# Codex.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/openlit/openlit/main/cli/scripts/uninstall.sh | sh
#
# Environment overrides:
#   OPENLIT_INSTALL_DIR  Target install directory; default $HOME/.openlit/bin
#   OPENLIT_PURGE_STATE  When `1`, also wipe the session cache + config dir.
#                         Default: 0 (leaves them in place so a fresh install
#                         picks up where the old one left off).
#
# Exit codes:
#   0  Successfully removed (or nothing to remove).
#   1  Refused (path looks suspicious; see comment below).

set -eu

OPENLIT_INSTALL_DIR=${OPENLIT_INSTALL_DIR:-"$HOME/.openlit/bin"}
OPENLIT_PURGE_STATE=${OPENLIT_PURGE_STATE:-0}

info()  { printf 'openlit: %s\n'        "$*"; }
warn()  { printf 'openlit: %s\n'        "$*" >&2; }
fatal() { printf 'openlit: error: %s\n' "$*" >&2; exit 1; }

# Safety net: refuse to operate on suspicious install dirs. A typoed
# OPENLIT_INSTALL_DIR=/ or =$HOME would otherwise blow away the
# user's home or root file system. Require the path to look like
# something installer.sh actually creates.
case "$OPENLIT_INSTALL_DIR" in
	/|"$HOME"|"$HOME/"|"")
		fatal "refusing to uninstall from suspicious path: '$OPENLIT_INSTALL_DIR'"
		;;
esac

bin="$OPENLIT_INSTALL_DIR/openlit"
if [ -f "$bin" ]; then
	rm -f "$bin"
	info "Removed binary: $bin"
else
	info "No binary at $bin (already uninstalled?)"
fi

# `rmdir` only removes empty dirs — if the user keeps other tools in
# $HOME/.openlit/bin we leave it alone. The 2>/dev/null swallow keeps
# this clean for the common "dir is empty" path.
rmdir "$OPENLIT_INSTALL_DIR" 2>/dev/null || true

if [ "$OPENLIT_PURGE_STATE" = "1" ]; then
	# Mirror the resolution rules in cli/internal/config/config.go
	# (configDir) and cli/internal/coding/sessionstate/sessionstate.go
	# (which uses os.UserCacheDir). The CLI deliberately stays on
	# ~/.config/openlit on macOS for parity with Linux, even though
	# os.UserConfigDir returns ~/Library/Application Support there.
	if [ "$(uname -s)" = "Darwin" ]; then
		cache_root="$HOME/Library/Caches"
	else
		cache_root="${XDG_CACHE_HOME:-$HOME/.cache}"
	fi
	config_root="${XDG_CONFIG_HOME:-$HOME/.config}"
	cache_dir="$cache_root/openlit"
	config_dir="$config_root/openlit"
	if [ -d "$cache_dir" ]; then
		rm -rf "$cache_dir"
		info "Removed session cache: $cache_dir"
	fi
	if [ -d "$config_dir" ]; then
		rm -rf "$config_dir"
		info "Removed config: $config_dir"
	fi
else
	info "Left session cache + config in place. Pass OPENLIT_PURGE_STATE=1 to also remove them."
fi

info ""
info "Note: this script does NOT detach openlit from your coding agents."
info "If you previously ran 'openlit coding install', also run:"
info "  openlit coding uninstall --vendor=all"
info "(while the binary is still on \$PATH), or remove the hook entries"
info "manually from your vendor configs."
