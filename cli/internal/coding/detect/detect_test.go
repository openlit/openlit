package detect

import "testing"

func TestIsGitCommit(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{`git commit -m "fix bug"`, true},
		{`git commit --message="fix bug"`, true},
		{`GIT_EDITOR=true git commit`, true},
		{`git -C subdir commit -m foo`, true},
		{`git -c user.email=a@b commit -m foo`, true},
		{`cd /tmp && git commit -m foo`, true},
		{`git commit --dry-run`, false},
		{`git commit --help`, false},
		{`git commit-tree -m foo`, false},
		{`git status`, false},
		{``, false},
	}
	for _, c := range cases {
		got := IsGitCommit(c.in)
		if got != c.want {
			t.Errorf("IsGitCommit(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestExtractCommitSHA(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{`[main 1a2b3c4] fix bug`, "1a2b3c4"},
		{`[feature/foo abcdef0123456789] msg`, "abcdef0123456789"},
		{`abc1234`, "abc1234"},
		{`abc1234\n`, "abc1234"},
		{`no commit info here`, ""},
		{``, ""},
	}
	for _, c := range cases {
		got := ExtractCommitSHA(c.in)
		if got != c.want {
			t.Errorf("ExtractCommitSHA(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestExtractCommitMessage(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{`git commit -m "hello world"`, "hello world"},
		{`git commit -m 'hi there'`, "hi there"},
		{`git commit --message="docs: tweak"`, "docs: tweak"},
		{`git commit -m bare`, "bare"},
		{`git commit`, ""},
	}
	for _, c := range cases {
		got := ExtractCommitMessage(c.in)
		if got != c.want {
			t.Errorf("ExtractCommitMessage(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestIsPullRequest(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{`gh pr create --title "feat: x" --body "..."`, true},
		{`gh pr create --base main`, true},
		{`glab mr create --target-branch main`, true},
		{`tea pr create --title foo`, true},
		{`gh pr list`, false},
		{`gh pr view 123`, false},
		{``, false},
	}
	for _, c := range cases {
		got := IsPullRequest(c.in)
		if got != c.want {
			t.Errorf("IsPullRequest(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestExtractPRURLAndNumber(t *testing.T) {
	cases := []struct {
		in      string
		wantURL string
		wantNum int
	}{
		{
			in:      `https://github.com/foo/bar/pull/123`,
			wantURL: "https://github.com/foo/bar/pull/123",
			wantNum: 123,
		},
		{
			in:      `Created: https://gitlab.com/foo/bar/-/merge_requests/45.`,
			wantURL: "https://gitlab.com/foo/bar/-/merge_requests/45",
			wantNum: 45,
		},
		{
			in:      `Visit https://github.com/foo/bar/compare/main...feat?expand=1 to create`,
			wantURL: "https://github.com/foo/bar/compare/main...feat?expand=1",
			wantNum: 0,
		},
		{
			in:      "no url",
			wantURL: "",
			wantNum: 0,
		},
	}
	for _, c := range cases {
		gotURL, gotNum := ExtractPRURLAndNumber(c.in)
		if gotURL != c.wantURL || gotNum != c.wantNum {
			t.Errorf("ExtractPRURLAndNumber(%q) = (%q, %d), want (%q, %d)", c.in, gotURL, gotNum, c.wantURL, c.wantNum)
		}
	}
}

func TestCountPatchLines(t *testing.T) {
	patch := `*** Begin Patch
*** Update File: a.txt
@@ -1,2 +1,3 @@
-old
+new1
+new2
 ctx
*** Add File: b.txt
+only_new
*** End Patch
`
	got := CountPatchLines(patch)
	if len(got) != 2 {
		t.Fatalf("got %d files, want 2: %+v", len(got), got)
	}
	if got[0].FilePath != "a.txt" || got[0].LinesAdded != 2 || got[0].LinesRemoved != 1 {
		t.Errorf("file[0] = %+v", got[0])
	}
	if got[1].FilePath != "b.txt" || got[1].LinesAdded != 1 || got[1].LinesRemoved != 0 {
		t.Errorf("file[1] = %+v", got[1])
	}
}

func TestCountPatchLinesUnifiedDiff(t *testing.T) {
	patch := `diff --git a/x.go b/x.go
index abc..def 100644
--- a/x.go
+++ b/x.go
@@ -1,3 +1,4 @@
 keep
-drop
+add1
+add2
 keep2
`
	got := CountPatchLines(patch)
	if len(got) != 1 {
		t.Fatalf("got %d files, want 1: %+v", len(got), got)
	}
	if got[0].FilePath != "x.go" || got[0].LinesAdded != 2 || got[0].LinesRemoved != 1 {
		t.Errorf("file[0] = %+v", got[0])
	}
}

func TestCountInlineDiff(t *testing.T) {
	cases := []struct {
		old, new            string
		wantAdd, wantRemove int
	}{
		{"", "abc", 1, 0},
		{"abc", "", 0, 1},
		{"a\nb\nc\n", "a\nb\nc\nd\n", 1, 0},
		{"a\nb\nc\n", "a\nx\nc\n", 1, 1},
		{"", "", 0, 0},
	}
	for _, c := range cases {
		add, rem := CountInlineDiff(c.old, c.new)
		if add != c.wantAdd || rem != c.wantRemove {
			t.Errorf("CountInlineDiff(%q,%q) = (%d,%d), want (%d,%d)", c.old, c.new, add, rem, c.wantAdd, c.wantRemove)
		}
	}
}
