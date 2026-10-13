package install

import (
	"reflect"
	"testing"
)

func TestVendorsFromArgIncludesOpenCode(t *testing.T) {
	t.Parallel()

	cases := []struct {
		in   string
		want []string
	}{
		{in: "opencode", want: []string{"opencode"}},
		{in: "all", want: []string{"claude-code", "cursor", "codex", "opencode"}},
	}

	for _, tc := range cases {
		got, err := vendorsFromArg(tc.in)
		if err != nil {
			t.Fatalf("vendorsFromArg(%q): %v", tc.in, err)
		}
		if !reflect.DeepEqual(got, tc.want) {
			t.Fatalf("vendorsFromArg(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}
