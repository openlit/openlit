// Package git collects the minimal VCS context every hook adapter
// stamps on its spans (vcs.repository.url.full, vcs.ref.head.revision,
// vcs.ref.head.name, coding_agent.vcs.dirty).
//
// Why we shell out to `git` rather than parse `.git/` ourselves: git's
// CLI is universally installed on developer machines, handles edge
// cases (worktrees, submodules, the GIT_DIR / GIT_WORK_TREE env vars),
// and is a small fraction of the hook's overall budget. Each call here
// has an explicit deadline; failures are silently dropped (we'd rather
// emit a span without VCS context than wedge the hook).
package git

import (
	"context"
	"errors"
	"net/url"
	"os/exec"
	"strings"
	"time"
)

// perSubcommandBudget bounds how long any single `git` invocation can
// take. The original hook deadline (a couple of seconds, see the
// caller) is shared across roughly 4 git calls per Snapshot, so a
// hung clone or a flaky filesystem can swallow the entire budget and
// starve the actual span emission. 500ms is more than enough for a
// healthy local repo and short enough that a hung call fails fast.
const perSubcommandBudget = 500 * time.Millisecond

// Context is the VCS snapshot captured at hook time. All fields are
// best-effort — empty values mean "not in a repo" or "git not on PATH".
type Context struct {
	// RepoURL is the canonical remote URL (https://… or git@…), pulled
	// from the configured upstream of HEAD or, failing that, `origin`.
	RepoURL string
	// HeadSHA is the full HEAD commit SHA.
	HeadSHA string
	// Branch is the current branch name; empty in detached-HEAD state.
	Branch string
	// Dirty is true if the working tree has uncommitted changes
	// (porcelain output non-empty).
	Dirty bool
}

// Empty reports whether the snapshot is entirely empty (no VCS context
// available). Callers can use this to decide whether to stamp the
// vcs.dirty boolean.
func (c Context) Empty() bool {
	return c.RepoURL == "" && c.HeadSHA == "" && c.Branch == ""
}

// Snapshot returns the VCS context for `dir`. If `dir` is empty, the
// process's current working directory is used.
func Snapshot(ctx context.Context, dir string) Context {
	if _, err := exec.LookPath("git"); err != nil {
		return Context{}
	}

	out := Context{}
	out.HeadSHA = run(ctx, dir, "rev-parse", "HEAD")
	out.Branch = strings.TrimSpace(run(ctx, dir, "rev-parse", "--abbrev-ref", "HEAD"))
	if out.Branch == "HEAD" {
		out.Branch = "" // detached HEAD
	}

	out.RepoURL = NormalizeRepoURL(remoteURL(ctx, dir))

	// `git status --porcelain` is empty iff the worktree is clean.
	if status := run(ctx, dir, "status", "--porcelain"); strings.TrimSpace(status) != "" {
		out.Dirty = true
	}
	return out
}

// remoteURL prefers the upstream of HEAD; falls back to `origin`. Both
// queries are cheap and non-network-touching.
func remoteURL(ctx context.Context, dir string) string {
	upstream := strings.TrimSpace(run(ctx, dir, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"))
	if upstream != "" {
		// upstream looks like "origin/main"; the remote is the prefix.
		if i := strings.IndexByte(upstream, '/'); i > 0 {
			remote := upstream[:i]
			if url := strings.TrimSpace(run(ctx, dir, "remote", "get-url", remote)); url != "" {
				return url
			}
		}
	}
	if url := strings.TrimSpace(run(ctx, dir, "remote", "get-url", "origin")); url != "" {
		return url
	}
	return ""
}

// run executes a git subcommand in `dir` (or cwd if empty) and returns
// stdout trimmed of trailing whitespace. Errors and non-zero exits map
// to the empty string — git's stderr is intentionally ignored because
// we never want to surface "fatal: not a git repository" to the user.
//
// Each invocation is wrapped in its own perSubcommandBudget so a
// single hung call can't starve the surrounding hook deadline.
func run(ctx context.Context, dir string, args ...string) string {
	if ctx.Err() != nil {
		return ""
	}
	subCtx, cancel := context.WithTimeout(ctx, perSubcommandBudget)
	defer cancel()
	cmd := exec.CommandContext(subCtx, "git", args...)
	if dir != "" {
		cmd.Dir = dir
	}
	out, err := cmd.Output()
	if err != nil {
		// Distinguish "not a repo" (exit code 128) from a real error
		// only when we want to log; here we drop both to keep the
		// hook silent on stderr.
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			return ""
		}
		return ""
	}
	return strings.TrimRight(string(out), "\n\r")
}

// NormalizeRepoURL coerces remote URLs to the canonical https form so
// dashboards group sessions from `git@github.com:org/repo.git`,
// `https://github.com/org/repo.git`, and `ssh://git@github.com/org/repo`
// into the same VCS bucket. Returns the input untouched when it
// doesn't look like a recognisable git URL.
//
// F10: this is the single source of truth — adapters call into here
// rather than rolling their own normalisation.
func NormalizeRepoURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	// scp-style (`git@host:path`) — convert to https.
	if !strings.Contains(raw, "://") && strings.Contains(raw, "@") && strings.Contains(raw, ":") {
		at := strings.IndexByte(raw, '@')
		colon := strings.IndexByte(raw[at+1:], ':')
		if colon > 0 {
			host := raw[at+1 : at+1+colon]
			path := raw[at+1+colon+1:]
			raw = "https://" + host + "/" + path
		}
	}
	// Strip trailing .git so https://github.com/o/r and the same with
	// .git produce identical keys.
	if u, err := url.Parse(raw); err == nil && u.Scheme != "" {
		u.Scheme = "https"
		u.User = nil
		u.Path = strings.TrimSuffix(u.Path, ".git")
		return u.String()
	}
	return raw
}
