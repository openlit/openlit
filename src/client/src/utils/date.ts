function parseDateString(dateString: string) {
	if (!dateString) return null;

	const normalizedDate = dateString.includes("T")
		? dateString
		: dateString.replace(" ", "T");
	const timestamp = /(?:Z|[+-]\d{2}:\d{2})$/.test(normalizedDate)
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