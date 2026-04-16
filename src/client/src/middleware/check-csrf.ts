import { NextFetchEvent, NextMiddleware, NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
	ALLOWED_OPENLIT_ROUTES_WITHOUT_TOKEN,
	CRON_JOB_ROUTES,
} from "@/constants/route";

const STATE_CHANGING_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

/**
 * CSRF protection middleware.
 * Validates Origin header on state-changing requests to API routes.
 * Skips routes that use API key / Bearer token auth instead of session cookies,
 * mirroring the same allowlists used by check-auth.
 */
export default function checkCsrf(next: NextMiddleware) {
	return async (request: NextRequest, _next: NextFetchEvent) => {
		const { pathname } = request.nextUrl;

		// Only check state-changing methods on API routes
		if (
			STATE_CHANGING_METHODS.includes(request.method) &&
			pathname.startsWith("/api/")
		) {
			// Skip CSRF check for NextAuth routes (they have their own CSRF protection)
			if (pathname.startsWith("/api/auth/")) {
				return next(request, _next);
			}

			// Skip CSRF check for routes that use API key / Bearer token auth (not cookies).
			// These are the same routes allowed without a session token in check-auth.
			if (ALLOWED_OPENLIT_ROUTES_WITHOUT_TOKEN.includes(pathname)) {
				return next(request, _next);
			}

			// Skip CSRF check for cron job routes (authenticated via X-CRON-JOB header)
			if (CRON_JOB_ROUTES.includes(pathname)) {
				return next(request, _next);
			}

			const origin = request.headers.get("origin");
			const host = request.headers.get("host");

			// If there's an Origin header, validate it matches the host
			if (origin) {
				try {
					const originUrl = new URL(origin);
					const expectedHost = host?.split(":")[0];
					const originHost = originUrl.hostname;

					if (expectedHost && originHost !== expectedHost) {
						return NextResponse.json("Forbidden", { status: 403 });
					}
				} catch {
					// Invalid origin header
					return NextResponse.json("Forbidden", { status: 403 });
				}
			}
		}

		return next(request, _next);
	};
}
