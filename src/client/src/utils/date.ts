export function parseDateString(dateString: string) {
	if (!dateString) return null;

	const hasTimeComponent =
		dateString.includes("T") || dateString.includes(" ");
	const normalizedDate = dateString.includes("T")
		? dateString
		: dateString.replace(" ", "T");

	// A bare calendar date (e.g. "2020-01-01") carries no timezone, so parse it
	// at local midnight to preserve the calendar day. Full timestamps are treated
	// as UTC unless they already carry an explicit offset.
	const timestamp = !hasTimeComponent
		? `${normalizedDate}T00:00:00`
		: /(?:Z|[+-]\d{2}:\d{2})$/.test(normalizedDate)
			? normalizedDate
			: `${normalizedDate}Z`;

	const date = new Date(timestamp);
	return Number.isNaN(date.getTime()) ? null : date;
}

export function formatBrowserDateTime(
	dateString?: string | null,
	fallback = "-"
) {
	const date = dateString ? parseDateString(dateString) : null;
	return date ? date.toLocaleString() : fallback;
}

export function formatDate(dateString: string, options?: { time?: boolean }) {
	const date = parseDateString(dateString);
	if (!date) return "-";

	return date.toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
		...(options?.time && {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		}),
	});
}