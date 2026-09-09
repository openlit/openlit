import crypto from "crypto";

function timingSafeEqualString(a: string, b: string): boolean {
	const aBuf = Buffer.from(a);
	const bBuf = Buffer.from(b);
	if (aBuf.length !== bBuf.length) {
		return false;
	}
	return crypto.timingSafeEqual(aBuf, bBuf);
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
