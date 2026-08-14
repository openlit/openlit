// Package detect contains tiny, dependency-free string helpers the
// per-vendor hook adapters use to recognise high-signal patterns in
// shell commands and code patches:
//
//   - `git commit` invocations (and the SHA written to stdout)
//   - pull / merge request creation (`gh pr create`, the URL printed
//     by `git push -u origin <branch>`, GitLab equivalents)
//   - unified-diff patch bodies (apply_patch on Codex, MultiEdit on
//     Claude Code) → per-file lines-added / lines-removed
//   - inline before / after text diffs (Claude Code Edit, Cursor
//     afterFileEdit) → lines-added / lines-removed
//
// The helpers are best-effort by design: every vendor formats its
// payload slightly differently, and the dashboards downstream prefer
// "directionally honest" numbers over none. When in doubt the helpers
// return zero and let the caller fall through to a vendor-specific
// fallback.
package detect

import (
	"regexp"
	"strings"
)

// IsGitCommit reports whether `cmd` is (or contains) a `git commit`
// invocation by the agent's shell tool. Recognises the common forms:
//
//	git commit -m "..."
//	git commit --message="..."
//	GIT_EDITOR=true git commit
//	git -C subdir commit ...
//
// Quick exclusions:
//   - `git commit --help` / `-h`
//   - `git commit-tree` (plumbing; not a user commit)
//   - `git commit ... --dry-run`
//
// The match is intentionally loose — false positives only inflate the
// commit count, never lose data. Dashboards rely on the SHA span
// attribute being present to dedupe against repeated invocations.
func IsGitCommit(cmd string) bool {
	if cmd == "" {
		return false
	}
	low := strings.ToLower(cmd)
	if !strings.Contains(low, "git") || !strings.Contains(low, "commit") {
		return false
	}
	if strings.Contains(low, "git commit-tree") {
		return false
	}
	if strings.Contains(low, "--dry-run") {
		return false
	}
	if strings.Contains(low, "--help") || gitCommitDashHRe.MatchString(low) {
		return false
	}
	// Accept any token sequence that has `git ... commit` with
	// optional `-C <dir>` / `-c key=val` between them. The simplest
	// reliable form is a regex over the tokenised command.
	return gitCommitRe.MatchString(low)
}

// gitCommitRe matches `git [opts] commit` allowing `-C <path>`,
// `-c key=val`, and env-var prefixes before `git`.
var gitCommitRe = regexp.MustCompile(`(?:^|\s|;|&&|\|\||\()(?:[a-z_][a-z0-9_]*=\S+\s+)*git(?:\s+-[cCp]\s+\S+|\s+--[a-zA-Z-]+(?:=\S+)?|\s+-[a-zA-Z]+)*\s+commit(?:\s|$|;|&&|\|\|)`)

// gitCommitDashHRe matches `git commit -h` invocations and is checked
// alongside `--help` to skip help-only commands. Compiled once at
// package init — the previous in-function MustCompile cost ~200 ns
// per IsGitCommit call on the shell hook hot path.
var gitCommitDashHRe = regexp.MustCompile(`\bgit\s+commit\s+-h\b`)

// shaRe matches a 7-40 char hex SHA, the common short / full forms
// printed by `git commit`'s stdout (e.g. `[main 1a2b3c4] message`).
var shaRe = regexp.MustCompile(`\b([0-9a-f]{7,40})\b`)

// commitOutputSHARe captures the SHA from the typical commit summary
// line: `[<branch> <sha>] <message>`.
var commitOutputSHARe = regexp.MustCompile(`\[[^\]]+\s+([0-9a-f]{7,40})\]`)

// ExtractCommitSHA pulls the commit SHA out of the stdout/stderr of a
// completed `git commit` invocation. Returns "" when no SHA-shaped
// token is present. Vendors that don't surface the tool's stdout
// (Codex's `local_shell` aggregated output) end up with "" and the
// emitter falls back to the at-emit timestamp.
func ExtractCommitSHA(output string) string {
	if output == "" {
		return ""
	}
	if m := commitOutputSHARe.FindStringSubmatch(output); len(m) > 1 {
		return m[1]
	}
	// `git commit-tree` style fallback — the SHA is the only token on
	// the line. Walk the lines and return the first 7+ hex run that
	// looks like a SHA (avoids matching long hex blobs in diff
	// output).
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if m := shaRe.FindStringSubmatch(line); len(m) > 1 {
			// Heuristic: only accept if the SHA is the whole line
			// OR the line starts with one (the common
			// commit-tree output shape).
			if line == m[1] || strings.HasPrefix(line, m[1]) {
				return m[1]
			}
		}
	}
	return ""
}

// ExtractCommitMessage tries to recover the `-m`-supplied message
// from a commit command. Returns "" when no quoted message is found.
// This is best-effort and intentionally cheap — we don't try to
// reconstruct heredoc-supplied or editor-supplied messages.
func ExtractCommitMessage(cmd string) string {
	if cmd == "" {
		return ""
	}
	if m := firstGroup(dashMRe, cmd); m != "" {
		return strings.TrimSpace(m)
	}
	if m := firstGroup(messageEqRe, cmd); m != "" {
		return strings.TrimSpace(m)
	}
	return ""
}

// firstGroup returns the first non-empty capture group from
// re.FindStringSubmatch(s). Lets us write one regex with several
// quote-style alternatives and pick whichever matched.
func firstGroup(re *regexp.Regexp, s string) string {
	m := re.FindStringSubmatch(s)
	for i := 1; i < len(m); i++ {
		if m[i] != "" {
			return m[i]
		}
	}
	return ""
}

var (
	dashMRe     = regexp.MustCompile(`-m\s+(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S+))`)
	messageEqRe = regexp.MustCompile(`--message=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S+))`)
)

// IsPullRequest reports whether `cmd` is a PR / MR creation
// invocation. Covers:
//
//   - `gh pr create ...` (GitHub CLI)
//   - `gh pr create --base ...` etc.
//   - `glab mr create ...` (GitLab CLI)
//   - `tea pr create ...` (Gitea CLI)
//
// Closing / listing / viewing PRs are NOT counted — only creation.
func IsPullRequest(cmd string) bool {
	if cmd == "" {
		return false
	}
	low := strings.ToLower(cmd)
	if strings.Contains(low, "gh pr create") {
		return true
	}
	if strings.Contains(low, "glab mr create") {
		return true
	}
	if strings.Contains(low, "tea pr create") {
		return true
	}
	return false
}

// prURLRe matches a typical GitHub / GitLab / Bitbucket PR/MR URL.
// We accept the form printed by `gh pr create` (always full URL) and
// by `git push -u origin <branch>` (PR-creation hint URL).
var prURLRe = regexp.MustCompile(`https?://[^\s\)]+/(?:pull|pull-request|pull-requests|merge_requests|merge-requests|pulls)/(\d+)\b`)

// prURLCompareRe matches the PR-create-hint URL git prints after
// `git push -u origin <branch>` (`/pull/new/<branch>`) and the
// GitLab "create new MR" URL (`-/merge_requests/new?...`).
var prURLCompareRe = regexp.MustCompile(`https?://[^\s\)]+/(?:pull/new/\S+|compare/\S+|-/merge_requests/new\?\S+)`)

// ExtractPRURLAndNumber returns the PR URL and number embedded in the
// command's stdout/stderr. Returns ("",0) when no URL is found.
func ExtractPRURLAndNumber(output string) (string, int) {
	if output == "" {
		return "", 0
	}
	if m := prURLRe.FindStringSubmatch(output); len(m) > 1 {
		url := strings.TrimRight(m[0], ".,;:)")
		var n int
		for _, c := range m[1] {
			if c < '0' || c > '9' {
				break
			}
			n = n*10 + int(c-'0')
		}
		return url, n
	}
	if m := prURLCompareRe.FindStringSubmatch(output); len(m) > 0 {
		return strings.TrimRight(m[0], ".,;:)"), 0
	}
	return "", 0
}

// ExtractPRTitle returns the value passed to `--title`, when present.
// Best-effort, mirrors ExtractCommitMessage.
func ExtractPRTitle(cmd string) string {
	if cmd == "" {
		return ""
	}
	if m := firstGroup(titleEqRe, cmd); m != "" {
		return strings.TrimSpace(m)
	}
	if m := firstGroup(titleFlagRe, cmd); m != "" {
		return strings.TrimSpace(m)
	}
	return ""
}

var (
	titleEqRe   = regexp.MustCompile(`--title=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S+))`)
	titleFlagRe = regexp.MustCompile(`--title\s+(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S+))`)
)

// PatchLineCounts is the output of CountPatchLines: per-file totals of
// added / removed lines. The slice preserves the order the files
// appeared in the patch so callers can attribute each file as its
// own EditDecision.
type PatchLineCounts struct {
	FilePath     string
	LinesAdded   int
	LinesRemoved int
}

// CountPatchLines walks a unified-diff patch (the body Codex passes
// to `apply_patch`, or the output of `git diff`) and returns one
// row per file with added/removed line counts.
//
// Recognises both standard `diff --git a/x b/x` headers and the
// `*** Update File: x` / `*** Add File: x` / `*** Delete File: x`
// markers Codex's `apply_patch` uses.
//
// The counter ignores hunk header lines (`@@ ... @@`) and the patch
// header lines themselves; only lines starting with `+` (added) or
// `-` (removed) inside a hunk are counted.
func CountPatchLines(patch string) []PatchLineCounts {
	if patch == "" {
		return nil
	}
	out := make([]PatchLineCounts, 0, 4)
	var cur *PatchLineCounts
	flush := func() {
		if cur != nil {
			out = append(out, *cur)
			cur = nil
		}
	}
	startFile := func(path string) {
		flush()
		cur = &PatchLineCounts{FilePath: path}
	}
	for _, line := range strings.Split(patch, "\n") {
		switch {
		case strings.HasPrefix(line, "diff --git "):
			// `diff --git a/foo b/bar` — prefer the b/ side
			fields := strings.Fields(line)
			if len(fields) >= 4 {
				startFile(stripABPrefix(fields[3]))
			} else {
				startFile("")
			}
		case strings.HasPrefix(line, "*** Update File: "):
			startFile(strings.TrimSpace(strings.TrimPrefix(line, "*** Update File: ")))
		case strings.HasPrefix(line, "*** Add File: "):
			startFile(strings.TrimSpace(strings.TrimPrefix(line, "*** Add File: ")))
		case strings.HasPrefix(line, "*** Delete File: "):
			startFile(strings.TrimSpace(strings.TrimPrefix(line, "*** Delete File: ")))
		case strings.HasPrefix(line, "+++ "):
			// Standard unified-diff "to" header. Use it as the
			// fallback file name if we never saw a `diff --git`.
			if cur == nil || cur.FilePath == "" {
				startFile(stripABPrefix(strings.TrimSpace(strings.TrimPrefix(line, "+++ "))))
			}
		case strings.HasPrefix(line, "--- "):
			// "from" header — ignore; the `+++` header
			// supersedes when present.
		case strings.HasPrefix(line, "@@"):
			// hunk header — skip
		case strings.HasPrefix(line, "+") && !strings.HasPrefix(line, "+++"):
			if cur == nil {
				startFile("")
			}
			cur.LinesAdded++
		case strings.HasPrefix(line, "-") && !strings.HasPrefix(line, "---"):
			if cur == nil {
				startFile("")
			}
			cur.LinesRemoved++
		}
	}
	flush()
	return out
}

func stripABPrefix(s string) string {
	if strings.HasPrefix(s, "a/") || strings.HasPrefix(s, "b/") {
		return s[2:]
	}
	return s
}

// CountInlineDiff returns lines-added / lines-removed for a vendor's
// "old text → new text" edit payload (Claude Code's Edit tool with
// `old_string` + `new_string`; Cursor's afterFileEdit `before` /
// `after`). The counts are line-based: the helper splits both blobs
// into newline-delimited lines, drops trailing empty lines, and
// counts the deltas.
//
// Empty `old` with non-empty `new` reports (len(new lines), 0). A
// non-empty `old` with empty `new` reports (0, len(old lines)).
// Otherwise: max(0, len(new)-len(old)) added, max(0,
// len(old)-len(new)) removed.
//
// This is intentionally simple — not a true LCS diff — because the
// hot path runs inside every PreToolUse / afterFileEdit hook
// invocation and dashboards only need order-of-magnitude correctness.
func CountInlineDiff(oldText, newText string) (added, removed int) {
	oldLines := splitLines(oldText)
	newLines := splitLines(newText)
	switch {
	case len(oldLines) == 0:
		return len(newLines), 0
	case len(newLines) == 0:
		return 0, len(oldLines)
	}
	if d := len(newLines) - len(oldLines); d > 0 {
		added = d
	} else if d < 0 {
		removed = -d
	}
	// For each in-range line that changed content, count it as
	// add + remove pair so dashboards see real movement instead of
	// "0 lines changed" when the edit is purely an in-place rewrite.
	min := len(oldLines)
	if len(newLines) < min {
		min = len(newLines)
	}
	for i := 0; i < min; i++ {
		if oldLines[i] != newLines[i] {
			added++
			removed++
		}
	}
	return added, removed
}

func splitLines(s string) []string {
	if s == "" {
		return nil
	}
	// Strip a single trailing newline (common in shell-quoted blobs)
	// before splitting so a value of `"a\n"` reports one line, not
	// two ("a" + "").
	if strings.HasSuffix(s, "\n") {
		s = s[:len(s)-1]
	}
	return strings.Split(s, "\n")
}
