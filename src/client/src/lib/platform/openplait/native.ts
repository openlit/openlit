/** Remove one optional trailing SQL terminator; OpenPlait owns the format. */
export function normalizeOpenPlaitReadStatement(query: string): string {
	return query.trim().replace(/;\s*$/, "");
}
