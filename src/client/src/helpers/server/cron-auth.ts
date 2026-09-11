/**
 * Cron route auth. This module is imported by Edge middleware, so it must not
 * use Node.js `crypto` or `Buffer`.
 */
function timingSafeEqualString(a: string, b: string): boolean {
	if (a.length !== b.length) {
		return false;
	}
	let mismatch = 0;
	for (let i = 0; i < a.length; i++) {
		mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return mismatch === 0;
}

/**
 * Cron routes accept `X-CRON-JOB` (or `x-cron-job`).
 * When `CRON_JOB_SECRET` is set (Docker images persist one per install),
 * require an exact match. When unset (`next dev`), keep the documented
 * `"true"` sentinel so local CE development still works.
 */
export function isValidCronJobRequest(request: {
	headers: { get(name: string): string | null };
}): boolean {
	const cronJobToken =
		request.headers.get("X-CRON-JOB") ??
		request.headers.get("x-cron-job") ??
		"";
	const configured = process.env.CRON_JOB_SECRET;
	const expectedToken =
		configured && configured.length > 0 ? configured : "true";
	return timingSafeEqualString(cronJobToken, expectedToken);
}
