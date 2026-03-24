import { NextFetchEvent, NextMiddleware, NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const STATE_CHANGING_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

/**
 * CSRF protection middleware.
 * Validates Origin header on state-changing requests to API routes.
 * This is a defense-in-depth measure alongside SameSite cookies.
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

			// Skip CSRF check for OTLP/telemetry ingestion endpoints that use API key auth
			if (pathname.startsWith("/api/otel/") || pathname.startsWith("/api/telemetry/")) {
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
