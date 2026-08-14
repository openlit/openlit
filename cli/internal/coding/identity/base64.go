package identity

import "encoding/base64"

// base64URLDecode is a thin wrapper around encoding/base64's URL
// decoder so the caller's intent is obvious at the call site. We use
// the URL alphabet (with `-` and `_` instead of `+` and `/`) because
// that's what JWT specifies; the no-padding variant is required
// because callers append `=` themselves before invoking us.
func base64URLDecode(seg string) ([]byte, error) {
	return base64.URLEncoding.DecodeString(seg)
}
