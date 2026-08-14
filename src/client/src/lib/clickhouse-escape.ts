// Single source of truth for escaping a string interpolated into a ClickHouse
// SQL string literal. Previously this was duplicated in ~7 files; hoisting it
// means a future hardening applies everywhere at once.
//
// It escapes backslashes and single quotes (preventing the value from breaking
// out of a '...' literal) and strips C0 control characters / DEL, which have no
// legitimate place in these identifiers and could otherwise corrupt a query or
// the JSONEachRow stream.
export function escapeClickHouseString(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/'/g, "\\'")
		// eslint-disable-next-line no-control-regex
		.replace(/[\x00-\x1f\x7f]/g, "");
}
