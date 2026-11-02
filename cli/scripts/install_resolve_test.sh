#!/usr/bin/env sh
# Hermetic checks for the CLI installer's release lookup.
#
# curl | sh downloads install.sh alone, so the lookup stays in that file
# (and the matching block in install.ps1). This test executes install.sh
# with a fake curl on PATH. It does not reimplement the parser.
#
# install.ps1 cannot run on the Linux CI image. The checks at the bottom
# lock the two Windows failure modes that have no shell equivalent:
# TLS 1.2 must cover the release request, and User-Agent must follow
# whichever parameter that host's Invoke-RestMethod actually has.
#
#   sh cli/scripts/install_resolve_test.sh
#   INSTALL_SHELL=/bin/dash sh cli/scripts/install_resolve_test.sh

set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
INSTALL="$ROOT/install.sh"
PS1="$ROOT/install.ps1"
SHELL_BIN=${INSTALL_SHELL:-/bin/sh}

WORKDIR=$(mktemp -d -t openlit-install-test-XXXXXX)
trap 'rm -rf "$WORKDIR"' EXIT INT TERM
BIN="$WORKDIR/bin"
mkdir -p "$BIN"

fail=0
rc=0

say() { printf '%s\n' "$*"; }
ok() { say "ok $1"; }
bad() {
	printf 'FAIL %s\n' "$1" >&2
	fail=1
}

write_curl() {
	cat > "$BIN/curl"
	chmod +x "$BIN/curl"
}

run_install() {
	if "$SHELL_BIN" "$INSTALL" >"$WORKDIR/out" 2>"$WORKDIR/err"; then
		rc=0
	else
		rc=$?
	fi
}

tag_of() {
	tail -n 1 "$WORKDIR/out"
}

expect_tag() {
	name=$1
	want=$2
	got=$(tag_of)
	if [ "$rc" -ne 0 ] || [ "$got" != "$want" ]; then
		bad "$name: rc=$rc got='${got:-}' want='$want'"
		cat "$WORKDIR/err" >&2 || true
		return
	fi
	ok "$name"
}

expect_fail() {
	name=$1
	must=$2
	forbid=$3
	if [ "$rc" -eq 0 ]; then
		bad "$name: expected a failing install"
		return
	fi
	if ! grep -q "$must" "$WORKDIR/err"; then
		bad "$name: stderr missing '$must'"
		cat "$WORKDIR/err" >&2 || true
		return
	fi
	if grep -q "$forbid" "$WORKDIR/err"; then
		bad "$name: stderr contains '$forbid'"
		cat "$WORKDIR/err" >&2 || true
		return
	fi
	if ! grep -q "OPENLIT_VERSION" "$WORKDIR/err"; then
		bad "$name: stderr does not name the OPENLIT_VERSION override"
		return
	fi
	ok "$name"
}

# Newest cli-* on a compact one-line body. A greedy sed returns the oldest.
write_curl << 'EOF'
#!/bin/sh
printf '%s' '[{"tag_name":"cli-0.0.9"},{"tag_name":"sdk-1.0"},{"tag_name":"cli-0.0.1"}]'
EOF
OPENLIT_VERSION=latest OPENLIT_PRINT_TAG=1 PATH="$BIN:$PATH" run_install
expect_tag "compact body keeps the newest cli tag" "cli-0.0.9"

# Pretty-printed, non-CLI release first.
write_curl << 'EOF'
#!/bin/sh
printf '%s\n' '{' '  "tag_name": "otel-gpu-collector-1.0.0"' '}' '{' '  "tag_name": "cli-0.0.1"' '}'
EOF
OPENLIT_VERSION=latest OPENLIT_PRINT_TAG=1 PATH="$BIN:$PATH" run_install
expect_tag "pretty body skips newer non-cli releases" "cli-0.0.1"

# A release note that mentions a cli tag must not win. Inside a JSON
# string the quotes are escaped, so the structural tag_name is the one
# that counts.
write_curl << 'EOF'
#!/bin/sh
printf '%s\n' \
  '{' \
  '  "tag_name": "py-1.2.3",' \
  '  "body": "notes mention \"tag_name\": \"cli-9.9.9\" in prose"' \
  '}' \
  '{' \
  '  "tag_name": "cli-0.0.1"' \
  '}'
EOF
OPENLIT_VERSION=latest OPENLIT_PRINT_TAG=1 PATH="$BIN:$PATH" run_install
expect_tag "escaped tag_name in a release body is ignored" "cli-0.0.1"

# Page 1 is other components; the CLI tag is on page 2.
write_curl << 'EOF'
#!/bin/sh
page=1
for arg in "$@"; do
	case "$arg" in
		*page=*) page=${arg##*page=} ;;
	esac
done
if [ "$page" = "1" ]; then
	printf '%s' '{"tag_name":"otel-gpu-collector-1.0.0"}'
else
	printf '%s' '{"tag_name":"cli-0.0.1"}'
fi
EOF
OPENLIT_VERSION=latest OPENLIT_PRINT_TAG=1 PATH="$BIN:$PATH" run_install
expect_tag "lookup turns the page when page 1 has no cli release" "cli-0.0.1"

# Transport / rate-limit failure is not "no such release".
write_curl << 'EOF'
#!/bin/sh
echo "curl: (22) The requested URL returned error: 403" >&2
exit 22
EOF
OPENLIT_VERSION=latest OPENLIT_PRINT_TAG=1 PATH="$BIN:$PATH" run_install
expect_fail "api failure names reachability" "could not reach" "could not resolve"

# A real empty list is the other error.
write_curl << 'EOF'
#!/bin/sh
printf '%s' '[]'
EOF
OPENLIT_VERSION=latest OPENLIT_PRINT_TAG=1 PATH="$BIN:$PATH" run_install
expect_fail "empty release list names resolution" "could not resolve" "could not reach"

# An explicit version never consults the API.
write_curl << EOF
#!/bin/sh
echo called > "$WORKDIR/curl-called"
exit 99
EOF
rm -f "$WORKDIR/curl-called"
OPENLIT_VERSION=1.2.3 OPENLIT_PRINT_TAG=1 PATH="$BIN:$PATH" run_install
expect_tag "pinned version skips the releases API" "cli-1.2.3"
if [ -f "$WORKDIR/curl-called" ]; then
	bad "pinned version invoked curl"
else
	ok "pinned version did not invoke curl"
fi

# install.ps1: TLS must cover the lookup, and User-Agent must be chosen
# from the parameters this PowerShell actually has. Neither installer
# filters prereleases unless both do.
tls=$(grep -n 'ServicePointManager]::SecurityProtocol' "$PS1" | head -n 1 | cut -d: -f1)
irm=$(grep -n 'Invoke-RestMethod' "$PS1" | head -n 1 | cut -d: -f1)
web=$(grep -n 'Invoke-WebRequest' "$PS1" | head -n 1 | cut -d: -f1)
if [ -z "$tls" ] || [ -z "$irm" ] || [ -z "$web" ]; then
	bad "windows script is missing TLS setup or a web request"
elif [ "$tls" -ge "$irm" ] || [ "$tls" -ge "$web" ]; then
	bad "windows TLS setup must run before Invoke-RestMethod and Invoke-WebRequest (tls=$tls irm=$irm web=$web)"
else
	ok "windows TLS setup covers the release lookup and the download"
fi
if grep -q "Parameters.Keys -contains 'UserAgent'" "$PS1" \
	&& grep -q "Parameters.Keys -contains 'UseBasicParsing'" "$PS1" \
	&& grep -q 'Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing' "$PS1"; then
	ok "windows User-Agent follows the host cmdlet"
else
	bad "windows User-Agent selection or download -UseBasicParsing was dropped"
fi
if grep -q '\$_.prerelease' "$PS1" || grep -q '"prerelease"' "$INSTALL"; then
	bad "prerelease filtering has to change both installers together"
else
	ok "installers agree on prerelease handling"
fi

if [ "$fail" -ne 0 ]; then
	exit 1
fi
say "installer release resolution ok"
