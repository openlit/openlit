#!/usr/bin/env sh
# openlit CLI installer for macOS + Linux.
#
# Detects OS + architecture, downloads the matching tarball from the
# latest `cli-*.*.*` GitHub Release of openlit/openlit, and installs
# the binary to $HOME/.openlit/bin/openlit. Prints a PATH-add hint if
# that directory is not already on $PATH.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/openlit/openlit/main/cli/scripts/install.sh | sh
#
# Environment overrides:
#   OPENLIT_INSTALL_DIR  Target install directory.
#                        Default: $HOME/.openlit/bin
#   OPENLIT_VERSION      Release tag WITHOUT the `cli-` prefix, e.g.
#                        `1.2.0`. Default: `latest`, resolved to the
#                        newest `cli-*` tag through the releases API —
#                        NOT through /releases/latest, which points at
#                        whichever component shipped most recently.
#
# Exit codes:
#   0  Installed (or already present).
#   1  Unsupported OS/arch, network failure, or missing curl/tar.

set -eu

OPENLIT_REPO=${OPENLIT_REPO:-openlit/openlit}
OPENLIT_INSTALL_DIR=${OPENLIT_INSTALL_DIR:-"$HOME/.openlit/bin"}
OPENLIT_VERSION=${OPENLIT_VERSION:-latest}

info()  { printf 'openlit: %s\n'        "$*"; }
warn()  { printf 'openlit: %s\n'        "$*" >&2; }
fatal() { printf 'openlit: error: %s\n' "$*" >&2; exit 1; }

need() {
	command -v "$1" >/dev/null 2>&1 || fatal "missing required command: $1"
}
need curl
need tar
need uname
# The release lookup below parses the releases JSON with grep/sed/head.
# Fail here, before any download, if one of them is missing.
need grep
need sed
need head

# `sha256sum` lives on Linux, `shasum` on macOS — fall back gracefully
# below. We don't fatal on missing either: if neither tool is present,
# the verifier degrades to a clear warning instead of a hard failure,
# matching how every other "official" CLI installer behaves on systems
# without GNU coreutils (e.g. minimal Alpine images).
sha256_cmd=""
if command -v sha256sum >/dev/null 2>&1; then
	sha256_cmd="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
	sha256_cmd="shasum -a 256"
fi

# --- Detect OS + arch -------------------------------------------------------

uname_os=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$uname_os" in
	darwin) os=darwin ;;
	linux)  os=linux ;;
	*) fatal "unsupported OS: $uname_os (this installer supports macOS + Linux; on Windows use install.ps1)" ;;
esac

uname_arch=$(uname -m)
case "$uname_arch" in
	x86_64|amd64)        arch=amd64 ;;
	aarch64|arm64)       arch=arm64 ;;
	*) fatal "unsupported architecture: $uname_arch" ;;
esac

# --- Resolve the asset URL --------------------------------------------------

# The release-cli.yml workflow uploads one tarball per OS/arch named
# openlit-<os>-<arch>.tar.gz, on a `cli-X.Y.Z` tag.
#
# `/releases/latest` cannot be used to find it. This repository releases
# many components from one tree — openlit-*, py-*, ts-*, controller-*,
# otel-gpu-collector-* — and GitHub's "latest" is whichever of them was
# published most recently, regardless of component. That release does not
# carry the CLI archives, so the download 404s (#1596).
#
# Resolve the newest `cli-*` tag explicitly. The releases API returns
# newest first, so the first match is the one we want. Both installers
# use that rule; do not skip prereleases here unless install.ps1 does too.
asset="openlit-${os}-${arch}.tar.gz"
if [ "$OPENLIT_VERSION" = "latest" ]; then
	info "Resolving the latest CLI release"
	releases_api="https://api.github.com/repos/${OPENLIT_REPO}/releases"
	# Page, rather than reading only the first 100. The CLI is one
	# component among many, so its newest tag will not stay on page 1.
	# Walk until a cli-* tag is found, the list ends, or a ten-page cap.
	# The cap stops a repository with no cli-* release from reading every
	# page before it fails.
	#
	# A failed call is not the end of the list. Treating it as one reports
	# "no cli-* release" when the request never succeeded, including on a
	# later page after earlier pages held only other components.
	# Unauthenticated calls are rate limited (60/hour per IP).
	tag=""
	page=1
	while [ "$page" -le 10 ]; do
		if ! body=$(curl -fsSL --retry 3 --retry-delay 1 \
			-H "Accept: application/vnd.github+json" \
			-H "User-Agent: openlit-installer" \
			"${releases_api}?per_page=100&page=${page}"); then
			fatal "could not reach ${releases_api} (network error or GitHub rate limit). \
Set OPENLIT_VERSION to a published CLI version (for example OPENLIT_VERSION=0.0.1) and re-run."
		fi
		# grep -o first, so each tag_name lands on its own line before
		# anything tries to pick one. A lone sed would depend on the API
		# pretty-printing one tag_name per line: on a compact body the
		# leading .* is greedy and walks to the LAST cli-* on the line,
		# which is the oldest release rather than the newest.
		tag=$(printf '%s' "$body" \
			| grep -o '"tag_name"[[:space:]]*:[[:space:]]*"cli-[^"]*"' \
			| sed -n 's/.*"\(cli-[^"]*\)"/\1/p' \
			| head -n 1)
		[ -n "$tag" ] && break
		# HTTP 200 with no tag_name is the end of the list. A page of
		# other components still has tag_name and has to be turned.
		printf '%s' "$body" | grep -q '"tag_name"' || break
		page=$((page + 1))
	done
	if [ -z "$tag" ]; then
		fatal "could not resolve the latest cli-* release from ${releases_api}. \
Set OPENLIT_VERSION to a published CLI version (for example OPENLIT_VERSION=0.0.1) and re-run."
	fi
	info "Latest CLI release is ${tag}"
else
	tag="cli-${OPENLIT_VERSION}"
fi
url="https://github.com/${OPENLIT_REPO}/releases/download/${tag}/${asset}"

# Test hook. cli/scripts/install_resolve_test.sh sets this so it can
# read the tag the real installer chose without downloading. Unset for
# a normal install. curl | sh only fetches this file, so the lookup
# cannot live in a sibling the test imports.
if [ "${OPENLIT_PRINT_TAG:-}" = "1" ]; then
	printf '%s\n' "$tag"
	exit 0
fi

info "Downloading ${asset}"

# --- Stage download into a temp dir, then atomic-move ----------------------

# A temp dir + final rename avoids leaving a half-written binary in
# place if curl/tar fails mid-stream. Cleanup runs even on errors.
tmpdir=$(mktemp -d -t openlit-install-XXXXXX)
trap 'rm -rf "$tmpdir"' EXIT INT TERM

if ! curl -fsSL --retry 3 --retry-delay 1 -o "$tmpdir/$asset" "$url"; then
	fatal "download failed: $url"
fi

# Pull the matching `.sha256` sidecar uploaded by release-cli.yml and
# verify the tarball before extracting. The sidecar is best-effort —
# if the release predates the sidecar upload or the network drops the
# second request, we warn but continue rather than hard-fail (the
# tarball was already served over HTTPS from GitHub, so we're paying
# defense-in-depth, not establishing the only trust anchor).
sha_url="${url}.sha256"
if curl -fsSL --retry 3 --retry-delay 1 -o "$tmpdir/$asset.sha256" "$sha_url" 2>/dev/null; then
	if [ -n "$sha256_cmd" ]; then
		expected=$(awk '{print $1}' "$tmpdir/$asset.sha256")
		# shellcheck disable=SC2086  # $sha256_cmd is a deliberate split for `shasum -a 256`.
		actual=$($sha256_cmd "$tmpdir/$asset" | awk '{print $1}')
		if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
			fatal "checksum mismatch for ${asset} — expected ${expected:-<empty>}, got ${actual}. Refusing to install a tampered tarball."
		fi
		info "Verified sha256 ${actual}"
	else
		warn "no sha256/shasum command found — skipping checksum verification"
	fi
else
	warn "sha256 sidecar not available at ${sha_url}; skipping checksum verification"
fi

if ! tar -xzf "$tmpdir/$asset" -C "$tmpdir"; then
	fatal "extract failed; archive may be corrupt"
fi

# The tarball contains a single binary named openlit-<os>-<arch>; the
# release-side packaging step doesn't rename it. Find it defensively
# so a future rename in release-cli.yml doesn't silently break us.
extracted=$(find "$tmpdir" -maxdepth 2 -type f -name 'openlit*' ! -name '*.tar.gz' -print -quit)
if [ -z "$extracted" ]; then
	fatal "no openlit binary found inside ${asset}"
fi

mkdir -p "$OPENLIT_INSTALL_DIR"
target="$OPENLIT_INSTALL_DIR/openlit"
mv "$extracted" "$target"
chmod +x "$target"

info "Installed: $target"

# --- PATH hint --------------------------------------------------------------

# Only print the hint if the install dir isn't already on PATH. Using
# `case` rather than `[[` keeps this portable to /bin/sh on Debian
# (dash) and BusyBox (Alpine container images).
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
