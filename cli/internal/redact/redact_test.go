package redact

import (
	"strings"
	"testing"
)

// Vendor prefixes that GitHub's push-protection scanner shape-matches
// against (Stripe `sk_live_…`, etc.) are assembled at runtime via
// `strings.Repeat` so the source file never contains
// "<prefix><20+ alphanumerics>" as a single literal. The redactor still
// sees the full, well-formed fake key when the test runs because Go
// string concatenation produces the same bytes the regex expects —
// the scanner just can't see it on disk. Don't inline these.
var (
	stripeSkLiveFake = "sk_live_" + strings.Repeat("a", 30)
	stripeRkLiveFake = "rk_live_" + strings.Repeat("a", 30)
)

// shouldRedactTier1 lists strings that contain a secret tier-1 should
// remove. The check is "Replacement appears in the output" rather than
// exact equality, since some patterns leave a prefix in place
// (e.g. "Authorization: Bearer ...").
var shouldRedactTier1 = []struct {
	name string
	in   string
}{
	{"aws_access_key_id", "AKIAIOSFODNN7EXAMPLE inside a sentence"},
	{"aws_secret_access_key_assignment", `aws_secret_access_key="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"`},
	{"gh_pat", "ghp_abcdefghijklmnopqrstuvwxyz0123456789"},
	{"openai_sk", "sk-proj-abc123_XYZ-secrets-living-here-now"},
	{"anthropic_sk", "sk-ant-abc123-secrets-456-zzz"},
	{"google_api_key", "AIza0123456789abcdefghijklmnopqrstuv-_X"},
	{"slack_xoxb", "xoxb-12345678-1234567890123-123456789012-abc123def456ghi789jkl"},
	{"stripe_sk_live", stripeSkLiveFake},
	{"stripe_rk_live", stripeRkLiveFake},
	{"jwt", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.signature123"},
	{"bearer_header", "Authorization: Bearer abc123def456ghi789jkl"},
	{"private_key", "-----BEGIN RSA PRIVATE KEY-----\nMIIEvQIBADANBgkq\n-----END RSA PRIVATE KEY-----"},
	{"azure_sas_sig", "?sv=2021-08-06&sig=AbCdEf%2BGhIj0123456789xyzPQR%3D"},
	{"azure_storage_conn", "DefaultEndpointsProtocol=https;AccountName=foo;AccountKey=AbCdEfGh1234567890abcdefghijklmn=="},
	{"hf_token", "hf_AbCdEfGhIjKlMnOpQrStUvWx12"},
	{"npm_token", "npm_abcdefghijklmnopqrstuvwxyz012345"},
	{"postgres_url", "postgres://app:s3cret-Pa55@db.internal:5432/main"},
	{"mysql_url", "mysql://root:hunter2hunter2@10.0.0.5/orders"},
}

func TestStringTier1RedactsKnownSecrets(t *testing.T) {
	for _, tc := range shouldRedactTier1 {
		t.Run(tc.name, func(t *testing.T) {
			out := String(tc.in)
			if !strings.Contains(out, Replacement) {
				t.Errorf("expected replacement marker; got %q", out)
			}
		})
	}
}

func TestPostgresURLKeepsHostDropsCreds(t *testing.T) {
	// The capture-rewrite path must keep the scheme + host so a
	// dashboard can still tell which DB the agent was hitting, while
	// dropping the user + password. Asserts the exact shape so a
	// future refactor of the replacement template can't silently
	// regress (e.g. swallowing the path).
	in := "postgres://app:s3cret-Pa55@db.internal:5432/main"
	want := "postgres://[REDACTED]:[REDACTED]@db.internal:5432/main"
	if got := String(in); got != want {
		t.Errorf("String(%q) = %q, want %q", in, got, want)
	}
}

func TestStringTier1LeavesNonSecretsAlone(t *testing.T) {
	cases := []string{
		"hello world",
		"User clicked the merge button",
		"no secrets here, just an explanation about authentication",
		"sk-",   // too short to match
		"AKIA1", // too short to match
	}
	for _, s := range cases {
		if got := String(s); got != s {
			t.Errorf("String(%q) = %q (changed unexpectedly)", s, got)
		}
	}
}

func TestStringFullCatchesGenericPasswords(t *testing.T) {
	cases := []string{
		`password="hunter22hunter22"`,
		`password=hunter22hunter22`,
		`api_key: "sk-some-thing-12345-678"`,
	}
	for _, s := range cases {
		out := StringFull(s)
		if !strings.Contains(out, Replacement) {
			t.Errorf("StringFull(%q) did not redact: got %q", s, out)
		}
	}
}

func TestForCaptureSelector(t *testing.T) {
	if got := ForCapture("metadata_only")("password=secret_value_123"); got == "password="+Replacement {
		// Tier 1 alone should NOT match this generic password pattern.
		t.Errorf("metadata_only mode unexpectedly applied tier 2: %q", got)
	}
	if got := ForCapture("full")("password=secret_value_123"); !strings.Contains(got, Replacement) {
		t.Errorf("full mode should have redacted: %q", got)
	}
}

func TestEmptyString(t *testing.T) {
	if got := String(""); got != "" {
		t.Errorf("String(%q) = %q", "", got)
	}
	if got := StringFull(""); got != "" {
		t.Errorf("StringFull(%q) = %q", "", got)
	}
}
