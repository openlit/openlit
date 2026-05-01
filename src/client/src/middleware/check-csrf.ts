import { NextFetchEvent, NextMiddleware, NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
	ALLOWED_OPENLIT_ROUTES_WITHOUT_TOKEN,
	ALLOWED_OPENLIT_ROUTE_PREFIXES_WITHOUT_TOKEN,
	CRON_JOB_ROUTES,
} from "@/constants/route";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isExemptPath(pathname: string) {
	return (
		pathname.startsWith("/api/auth/") ||
		ALLOWED_OPENLIT_ROUTES_WITHOUT_TOKEN.includes(pathname) ||
		ALLOWED_OPENLIT_ROUTE_PREFIXES_WITHOUT_TOKEN.some((prefix) =>
			pathname.startsWith(prefix)
		) ||
		CRON_JOB_ROUTES.includes(pathname)
	);
}

function isSameOrigin(request: NextRequest) {
	const origin = request.headers.get("origin");
	const host = request.headers.get("host");

	if (!origin || !host) return true;

	try {
		return new URL(origin).host === host;
	} catch {
		return false;
	}
}

export default function checkCsrf(next: NextMiddleware) {
	return async (request: NextRequest, event: NextFetchEvent) => {
		const { pathname } = request.nextUrl;

		if (
			STATE_CHANGING_METHODS.has(request.method.toUpperCase()) &&
			pathname.startsWith("/api/") &&
			!isExemptPath(pathname) &&
			!isSameOrigin(request)
		) {
			return NextResponse.json("Forbidden", { status: 403 });
		}

		return next(request, event);
	};
}
