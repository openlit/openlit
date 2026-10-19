package detect

import "strings"

// CommandHead returns the executable a shell command line runs, for the
// metadata_only / minimal capture modes where only the "binary head"
// may leave the machine. Leading `NAME=value` environment assignments
// are skipped: that prefix is where inline credentials usually live
// (`PGPASSWORD=… psql …`, `API_KEY=… node script.js`). Returns "" when
// the command is empty or consists only of assignments.
func CommandHead(cmd string) string {
	for _, field := range strings.Fields(cmd) {
		if isEnvAssignment(field) {
			continue
		}
		return field
	}
	return ""
}

// isEnvAssignment reports whether a shell word is a `NAME=value`
// assignment (NAME being a valid shell identifier).
func isEnvAssignment(word string) bool {
	name, _, ok := strings.Cut(word, "=")
	if !ok || name == "" {
		return false
	}
	for i, r := range name {
		switch {
		case r == '_', r >= 'A' && r <= 'Z', r >= 'a' && r <= 'z':
		case r >= '0' && r <= '9' && i > 0:
		default:
			return false
		}
	}
	return true
}
