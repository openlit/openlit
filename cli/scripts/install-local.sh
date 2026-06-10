#!/usr/bin/env sh
# Local-build installer for the openlit CLI.
#
# Dev-mode escape hatch for testing the onboarding flow before a
# `cli-X.Y.Z` GitHub Release exists. Builds the CLI from the current
# checkout with `go build` and installs the result to the same path
# that `install.sh` would (~/.openlit/bin/openlit), so the rest of the
# onboarding snippet (`openlit configure` + `openlit coding install`)
# behaves identically whether the user installed from source or from
# a release.
#
# Usage:
#   sh /path/to/openlit/cli/scripts/install-local.sh
#
# Or, from inside the repo:
#   sh cli/scripts/install-local.sh
#
# Environment overrides (same names install.sh recognises so the two
# scripts feel interchangeable):
#   OPENLIT_INSTALL_DIR  Target directory. Default: $HOME/.openlit/bin
#
# Delete with:
#   rm ~/.openlit/bin/openlit          # the binary
#   openlit coding uninstall --vendor=all --purge   # before deleting the binary

set -eu

OPENLIT_INSTALL_DIR=${OPENLIT_INSTALL_DIR:-"$HOME/.openlit/bin"}

info()  { printf 'openlit: %s\n'        "$*"; }
warn()  { printf 'openlit: %s\n'        "$*" >&2; }
fatal() { printf 'openlit: error: %s\n' "$*" >&2; exit 1; }

need() {
	command -v "$1" >/dev/null 2>&1 || fatal "missing required command: $1"
}
need go
need uname

# --- Locate the cli/ module relative to THIS script -------------------------

# We resolve via the script's own directory so the user can sh
# install-local.sh from anywhere — from inside the repo, from outside,
# piped through `cat`, doesn't matter. Falls back to $PWD if dirname
# returns something nonsensical (shouldn't happen on POSIX systems
# but the fallback keeps the failure modes loud).
script_dir=$(cd "$(dirname "$0")" 2>/dev/null && pwd) || script_dir=$(pwd)
cli_dir=$(cd "$script_dir/.." && pwd)

if [ ! -f "$cli_dir/go.mod" ] || [ ! -d "$cli_dir/cmd/openlit" ]; then
	fatal "expected cli/ module at $cli_dir but go.mod or cmd/openlit is missing"
fi

# --- Build into a temp file, atomic-move into place ------------------------

# Build into a temp dir + final rename so we never leave a partially
# linked binary in PATH if the build fails mid-link. Cleanup runs on
# both success and error paths.
tmpdir=$(mktemp -d -t openlit-build-XXXXXX)
trap 'rm -rf "$tmpdir"' EXIT INT TERM

info "Building from $cli_dir"
(
	cd "$cli_dir"
	# -trimpath strips local filesystem paths from the binary so
	# stack traces don't leak the developer's homedir; -ldflags
	# -s -w drops the symbol + DWARF tables, which knocks ~30% off
	# the binary size and matches what cli-release.yml produces.
	# Keep these in sync with the release workflow so behaviour
	# differences between source builds and release builds stay
	# small.
	#
	# Stamp `dev-<short-sha>` into the version vars in
	# cli/internal/version. Without this every local install reports
	# `dev` with no commit, which is impossible to distinguish from
	# an old build. Best-effort: silently fall back to `dev` if the
	# checkout isn't a git tree.
	VERSION_PKG="github.com/openlit/openlit/cli/internal/version"
	COMMIT=$(git -C "$cli_dir" rev-parse --short HEAD 2>/dev/null || echo "")
	VERSION="dev"
	if [ -n "$COMMIT" ]; then
		VERSION="dev-$COMMIT"
	fi
	CGO_ENABLED=0 go build -trimpath \
		-ldflags "-s -w -X ${VERSION_PKG}.Version=${VERSION} -X ${VERSION_PKG}.Commit=${COMMIT}" \
		-o "$tmpdir/openlit" ./cmd/openlit
)

mkdir -p "$OPENLIT_INSTALL_DIR"
target="$OPENLIT_INSTALL_DIR/openlit"
mv "$tmpdir/openlit" "$target"
chmod +x "$target"

info "Installed: $target"

# --- PATH hint --------------------------------------------------------------

case ":$PATH:" in
	*":$OPENLIT_INSTALL_DIR:"*) ;;
	*)
		warn ""
		warn "Add the install directory to your PATH (one of):"
		warn "  echo 'export PATH=\"$OPENLIT_INSTALL_DIR:\$PATH\"' >> ~/.zshrc   # zsh"
		warn "  echo 'export PATH=\"$OPENLIT_INSTALL_DIR:\$PATH\"' >> ~/.bashrc  # bash"
		warn "Then reload your shell or 'source' the file."
		;;
esac

info ""
info "Next: configure + wire a vendor. The current shell may not have"
info "      \$OPENLIT_INSTALL_DIR on PATH yet — open a new terminal, or"
info "      use the absolute path below:"
info ""
info "  $target configure --endpoint <url> --api-key <key>"
info "  $target coding install --vendor=cursor   # or claude-code / codex"
