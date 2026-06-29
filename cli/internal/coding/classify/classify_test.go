package classify

import "testing"

func TestClassify(t *testing.T) {
	cases := []struct {
		name       string
		in         Inputs
		want       string
		wantReason string
	}{
		{
			name:       "no_signal",
			in:         Inputs{},
			want:       "unknown",
			wantReason: "no_signal",
		},
		{
			// Strongest signal: API-key allowlist + repo origin both
			// agree.
			name: "work_full_match",
			in: Inputs{
				APIKeyAllowlistKnown: true,
				APIKeyOnAllowlist:    true,
				RepoURL:              "https://github.com/my-org/api.git",
				RepoAllowlist:        []string{"github.com/my-org/"},
			},
			want:       "work",
			wantReason: "api_key_allowlist+repo_origin_match",
		},
		{
			name: "work_api_key_only",
			in: Inputs{
				APIKeyAllowlistKnown: true,
				APIKeyOnAllowlist:    true,
				RepoURL:              "",
			},
			want:       "work",
			wantReason: "api_key_allowlist_only",
		},
		{
			// New v1 default path: no API-key allowlist infrastructure
			// (APIKeyAllowlistKnown=false), but the user's repo IS on
			// the allowlist. Repo signal is strong on its own — return
			// "work" instead of falsely flagging "personal".
			name: "work_repo_only_no_key_data",
			in: Inputs{
				APIKeyAllowlistKnown: false,
				APIKeyOnAllowlist:    false,
				RepoURL:              "https://github.com/my-org/api.git",
				RepoAllowlist:        []string{"github.com/my-org/"},
			},
			want:       "work",
			wantReason: "repo_origin_match",
		},
		{
			// Repo URL exists, allowlist exists, and the URL did NOT
			// match. Org has explicitly declared this repo non-work.
			name: "personal_repo_not_on_allowlist",
			in: Inputs{
				APIKeyAllowlistKnown: false,
				APIKeyOnAllowlist:    false,
				RepoURL:              "https://github.com/random-user/side-project.git",
				RepoAllowlist:        []string{"github.com/my-org/"},
			},
			want:       "personal",
			wantReason: "repo_origin_no_match",
		},
		{
			// Governance signal: API-key allowlist EXISTS and the key
			// is positively NOT on it, but the user is committing to a
			// work repo. Worth flagging.
			name: "personal_api_on_work_repo",
			in: Inputs{
				APIKeyAllowlistKnown: true,
				APIKeyOnAllowlist:    false,
				RepoURL:              "https://github.com/my-org/api.git",
				RepoAllowlist:        []string{"github.com/my-org/"},
			},
			want:       "personal",
			wantReason: "api_key_personal_on_work_repo",
		},
		{
			// Conflict: work identity (API-key allowlisted) on a
			// non-allowlisted repo. Could be a missing entry or a
			// genuine policy violation — let the dispute UI decide.
			name: "ambiguous_api_on_unknown_repo",
			in: Inputs{
				APIKeyAllowlistKnown: true,
				APIKeyOnAllowlist:    true,
				RepoURL:              "https://github.com/random-user/side.git",
				RepoAllowlist:        []string{"github.com/my-org/"},
			},
			want:       "unknown",
			wantReason: "api_key_work_on_non_allowlisted_repo",
		},
		{
			// Regression guard: this was the bug that motivated the
			// rewrite. A user with OPENLIT_CODING_REPO_ALLOWLIST set to
			// their work repo, NO API-key allowlist infrastructure, and
			// committing to that very repo was getting labelled
			// "personal" — exactly the opposite of the truth. Now
			// returns "work" via the repo-only branch.
			name: "regression_repo_only_no_key_known_returns_work_not_personal",
			in: Inputs{
				APIKeyAllowlistKnown: false,
				APIKeyOnAllowlist:    false,
				RepoURL:              "https://github.com/openlit/openlit.git",
				RepoAllowlist:        []string{"github.com/openlit/openlit"},
			},
			want:       "work",
			wantReason: "repo_origin_match",
		},
		{
			// "Has repo but no allowlist configured" — we can't say
			// either way. Don't pretend confidence.
			name: "no_repo_allowlist_returns_unknown_not_personal",
			in: Inputs{
				APIKeyAllowlistKnown: false,
				APIKeyOnAllowlist:    false,
				RepoURL:              "https://github.com/anyone/anything.git",
				RepoAllowlist:        nil,
			},
			want:       "unknown",
			wantReason: "no_repo_allowlist_configured",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Classify(tc.in)
			if got.Value != tc.want {
				t.Errorf("Classify(%+v).Value = %s; want %s (reason: %s)", tc.in, got.Value, tc.want, got.Reason)
			}
			if tc.wantReason != "" && got.Reason != tc.wantReason {
				t.Errorf("Classify(%+v).Reason = %s; want %s", tc.in, got.Reason, tc.wantReason)
			}
			if got.Reason == "" {
				t.Errorf("expected non-empty reason; got empty")
			}
		})
	}
}

func TestSplitAllowlist(t *testing.T) {
	got := SplitAllowlist("github.com/foo, github.com/bar  , ,git@gitlab.com:baz/")
	if len(got) != 3 {
		t.Errorf("expected 3 entries; got %v", got)
	}
}
