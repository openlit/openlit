package tailfile

import (
	"errors"
	"io"
	"strings"
	"testing"
	"testing/iotest"
)

func collect(t *testing.T, src io.Reader, maxLine int) ([]string, error) {
	t.Helper()
	var got []string
	err := eachLineContaining(src, []byte(`"usage"`), maxLine, func(line []byte) {
		got = append(got, string(line))
	})
	return got, err
}

func TestEachLineContainingDeliversMatchingLines(t *testing.T) {
	src := strings.NewReader("{\"usage\":1}\nno match\n  {\"usage\":2}  \n{\"usage\":3}") // last line unterminated
	got, err := collect(t, src, MaxMatchLine)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(got, "|") != `{"usage":1}|{"usage":2}|{"usage":3}` {
		t.Fatalf("got %q", got)
	}
}

func TestEachLineContainingPassesOverLongNonMatchingLines(t *testing.T) {
	src := strings.NewReader(`{"usage":1}` + "\n" + strings.Repeat("x", 300_000) + "\n" + `{"usage":2}` + "\n")
	got, err := collect(t, src, 1024)
	if err != nil {
		t.Fatalf("err = %v, want nil (the long line has no usage)", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d lines, want 2", len(got))
	}
}

func TestEachLineContainingReportsSkippedMatchingLine(t *testing.T) {
	long := `{"usage":9,"pad":"` + strings.Repeat("x", 300_000) + `"}`
	src := strings.NewReader(`{"usage":1}` + "\n" + long + "\n" + `{"usage":2}` + "\n")
	got, err := collect(t, src, 1024)
	if !errors.Is(err, ErrLineTooLong) {
		t.Fatalf("err = %v, want ErrLineTooLong", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d lines, want the 2 that fit", len(got))
	}
}

// The reader hands over long lines in 64 KiB chunks; a needle straddling a
// chunk boundary inside an oversized line must still be detected.
func TestEachLineContainingFindsNeedleAcrossChunks(t *testing.T) {
	const chunk = 64 * 1024
	long := strings.Repeat("x", chunk-3) + `"usage"` + strings.Repeat("y", 100_000)
	_, err := collect(t, strings.NewReader(long+"\n"), 1024)
	if !errors.Is(err, ErrLineTooLong) {
		t.Fatalf("err = %v, want ErrLineTooLong", err)
	}
}

func TestEachLineContainingPropagatesReadErrors(t *testing.T) {
	boom := errors.New("disk went away")
	src := io.MultiReader(strings.NewReader(`{"usage":1}`+"\n"), iotest.ErrReader(boom))
	got, err := collect(t, src, MaxMatchLine)
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v, want the read error", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d lines before the error, want 1", len(got))
	}
}
