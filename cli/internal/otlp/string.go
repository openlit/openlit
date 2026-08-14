package otlp

import "fmt"

// defaultString isolates the fmt import to a single tiny file. Used as
// the last-resort fallback for non-string values flowing through EmitEvent.
func defaultString(v any) string {
	return fmt.Sprintf("%v", v)
}
