package detect

import "testing"

func TestCommandHead(t *testing.T) {
	cases := map[string]string{
		"":                                    "",
		"   ":                                 "",
		"ls -la":                              "ls",
		"\tgit status":                        "git",
		"PGPASSWORD=hunter2 psql -h db":       "psql",
		"A=1 B_2=x ./run.sh --flag":           "./run.sh",
		"FOO=bar":                             "",
		"env FOO=bar node app.js":             "env",
		"=notanassignment cmd":                "=notanassignment",
		"1X=y cmd":                            "1X=y",
		"/usr/bin/curl https://example.com/x": "/usr/bin/curl",
	}
	for in, want := range cases {
		if got := CommandHead(in); got != want {
			t.Errorf("CommandHead(%q) = %q, want %q", in, got, want)
		}
	}
}
