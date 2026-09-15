package config

import "testing"

func TestSqlitePath(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"":                                   "",
		"file:/app/client/data/data.db":      "/app/client/data/data.db",
		"file:../data/data.db":               "../data/data.db",
		"file:./dev.db?connection_limit=1":   "./dev.db",
	}
	for in, want := range cases {
		if got := sqlitePath(in); got != want {
			t.Fatalf("sqlitePath(%q)=%q want %q", in, got, want)
		}
	}
}
