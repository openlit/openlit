import { createHash, timingSafeEqual } from "crypto";

/**
 * Shared secret between the UI server and the realtime engine
 * (`src/engine`). It is deliberately separate from CRON_JOB_SECRET so a
 * leaked cron token cannot forge findings, and it has no development
 * fallback: when unset, the internal realtime API is closed.
 */
export const ENGINE_SECRET_HEADER = "X-OpenLIT-Engine-Secret";

export function getEngineSecret(): string | null {
	const secret = (process.env.OPENLIT_ENGINE_SECRET || "").trim();
	return secret.length > 0 ? secret : null;
}

function digest(value: string): Buffer {
	return createHash("sha256").update(value).digest();
}

/** Constant-time check of the engine secret header. */
export function isValidEngineRequest(request: {
	headers: { get(name: string): string | null };
}): boolean {
	const expected = getEngineSecret();
	if (!expected) return false;
	const provided = request.headers.get(ENGINE_SECRET_HEADER) ?? "";
	if (!provided) return false;
	return timingSafeEqual(digest(provided), digest(expected));
}
