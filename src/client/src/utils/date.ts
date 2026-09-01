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

const DATE_PART_KEYS = new Set([
	"year",
	"month",
	"day",
	"hour",
	"hours",
	"minute",
	"minutes",
	"second",
	"seconds",
	"millisecond",
	"milliseconds",
	"ms",
	"quarter",
	"isweekend",
	"weekend",
	"dayofweek",
	"weekday",
	"dayofyear",
	"weekofyear",
	"week",
	"timezone",
	"tz",
	"utc",
	"timestamp",
	"datetime",
	"date",
	"ampm",
	"meridiem",
	"offset",
]);

function normalizeDatePartKey(key: string): string {
	return key.toLowerCase().replace(/[\s_-]/g, "");
}

function datePartNumber(
	parts: Record<string, unknown>,
	...keys: string[]
): number | undefined {
	for (const key of keys) {
		const value = parts[key];
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
			return Number(value);
		}
	}
	return undefined;
}

function isPlainDatePartsObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

export function formatDatePartsValue(value: unknown): string | null {
	if (!isPlainDatePartsObject(value)) return null;
	const parts: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (entry === null || entry === undefined || entry === "") continue;
		parts[normalizeDatePartKey(key)] = entry;
	}
	if (!("year" in parts) || !("month" in parts) || !("day" in parts)) return null;
	if (!Object.keys(parts).every((key) => DATE_PART_KEYS.has(key))) return null;
	const year = datePartNumber(parts, "year");
	const month = datePartNumber(parts, "month");
	const day = datePartNumber(parts, "day");
	if (!year || !month || !day) return null;
	const hour = datePartNumber(parts, "hour", "hours") ?? 0;
	const minute = datePartNumber(parts, "minute", "minutes") ?? 0;
	const second = datePartNumber(parts, "second", "seconds") ?? 0;
	const date = new Date(year, month - 1, day, hour, minute, second);
	if (Number.isNaN(date.getTime())) return null;
	return date.toLocaleString();
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