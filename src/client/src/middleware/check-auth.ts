import { withAuth } from "next-auth/middleware";
import { getToken } from "next-auth/jwt";
import {
	NextFetchEvent,
	NextMiddleware,
	NextRequest,
	NextResponse,
} from "next/server";
import {
	DEFAULT_LOGGED_IN_ROUTE,
	ALLOWED_OPENLIT_ROUTES_WITHOUT_TOKEN,
	ALLOWED_OPENLIT_ROUTE_PREFIXES_WITHOUT_TOKEN,
	ALLOWED_OPENLIT_ROUTES_WITH_TOKEN,
	ALLOWED_OPENLIT_ROUTE_PREFIXES_WITH_TOKEN,
	CRON_JOB_ROUTES,
	ONBOARDING_WHITELIST_ROUTES,
	ONBOARDING_WHITELIST_ROUTE_PREFIXES,
	ONBOARDING_WHITELIST_API_ROUTES,
} from "@/constants/route";

function isValidCronJobRequest(request: NextRequest) {
	// Self-hosted / dev installs run the cron in the same container and do
	// not set CRON_JOB_SECRET. Fall back to the literal "true" the cron
	// scripts send so the materialize / evaluation / pricing crons work out
	// of the box (this matches the documented `-H 'X-CRON-JOB: true'` call).
	// When an operator DOES set CRON_JOB_SECRET, both this check and the cron
	// scripts use it, so the endpoints require the secret and can't be
	// triggered without it.
	const expectedToken = process.env.CRON_JOB_SECRET || "true";
	const cronJobToken =
		request.headers.get("X-CRON-JOB") ?? request.headers.get("x-cron-job");

	return cronJobToken === expectedToken;
}

const rateLimitWindows = new Map<string, { count: number; resetAt: number }>();
// UI pages (telemetry/agents/dashboards) fire multiple parallel reads per
// navigation. 120/min was too low and 429'd normal tab switching; 10x keeps
// a abuse ceiling without breaking self-hosted browsing + auto-refresh.
const SENSITIVE_API_RATE_LIMIT = 1200;
const SENSITIVE_API_RATE_LIMIT_WINDOW_MS = 60_000;
const SENSITIVE_API_RATE_LIMIT_CLEANUP_MS = 60_000;
const RATE_LIMITED_API_PREFIXES = [
	"/api/organisation",
	"/api/metrics",
	"/api/telemetry",
	"/api/observability",
	"/api/prompt",
	"/api/evaluation",
	"/api/agents",
	"/api/alerts",
	"/api/vault",
	"/api/context",
	"/api/manage-dashboard",
];
let nextRateLimitCleanupAt = 0;

function shouldRateLimitApi(pathname: string) {
	return RATE_LIMITED_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function getClientRateLimitKey(request: NextRequest) {
	return (
		request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
		request.headers.get("x-real-ip") ||
		"unknown"
	);
}

function isRateLimited(request: NextRequest) {
	const now = Date.now();
	if (now >= nextRateLimitCleanupAt) {
		rateLimitWindows.forEach((window, key) => {
			if (window.resetAt <= now) rateLimitWindows.delete(key);
		});
		nextRateLimitCleanupAt = now + SENSITIVE_API_RATE_LIMIT_CLEANUP_MS;
	}

	const key = getClientRateLimitKey(request);
	const window = rateLimitWindows.get(key);

	if (!window || window.resetAt <= now) {
		rateLimitWindows.set(key, {
			count: 1,
			resetAt: now + SENSITIVE_API_RATE_LIMIT_WINDOW_MS,
		});
		return false;
	}

	window.count += 1;
	return window.count > SENSITIVE_API_RATE_LIMIT;
}



export default function checkAuth(next: NextMiddleware) {
	return withAuth(
		async function middleware(request: NextRequest, _next: NextFetchEvent) {
			const pathname = request.nextUrl.pathname;
			if (
				pathname.startsWith("/_next") ||
				pathname.startsWith("/static") ||
				pathname.startsWith("/images") ||
				pathname === "/api/auth/verify-key"
			) {
				// Static assets: skip all auth logic and let the request
				// continue to the underlying resource. We must return a
				// pass-through response directly here — this middleware is the
				// chain terminus, so its `next` is `NextResponse.next` itself,
				// and calling it as `next(request, event)` uses the request as
				// the response init and throws ("middleware accepts an async
				// API directly"), which surfaces as a 500 on every /images/*
				// (and /static) request.
				return NextResponse.next();
			}

			const isWithTokenRoute =
				ALLOWED_OPENLIT_ROUTES_WITH_TOKEN.includes(pathname) ||
				ALLOWED_OPENLIT_ROUTE_PREFIXES_WITH_TOKEN.some((prefix) =>
					pathname.startsWith(prefix)
				);

			const authHeader = request.headers.get("Authorization") || "";
			if (authHeader.startsWith("Bearer ")) {
				if (!isWithTokenRoute) {
					return NextResponse.json({ error: "Forbidden" }, { status: 403 });
				}

				const apiKey = authHeader.replace(/^Bearer /, "").trim();
				if (!apiKey) {
					return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
				}

				try {
					const verifyUrl = new URL("/api/auth/verify-key", request.url);
					const res = await fetch(verifyUrl, {
						headers: {
							Authorization: authHeader,
						},
					});

					if (res.ok) {
						const data = await res.json();
						if (data.valid && data.databaseConfigId) {
							const requestHeaders = new Headers(request.headers);
							requestHeaders.set("x-database-config-id", data.databaseConfigId);
							return next(
								new NextRequest(request, {
									headers: requestHeaders,
								}),
								_next
							);
						}
					}
				} catch (e) {
					console.error("Middleware API key validation error:", e);
				}

				return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
			}

			try {
				const token = await getToken({ req: request });
				const isAuth = !!token;
				const isAllowedRequestWithoutToken =
					ALLOWED_OPENLIT_ROUTES_WITHOUT_TOKEN.includes(pathname) ||
					ALLOWED_OPENLIT_ROUTE_PREFIXES_WITHOUT_TOKEN.some((prefix) =>
						pathname.startsWith(prefix)
					);
				const isCronJobRoute = CRON_JOB_ROUTES.includes(pathname);
				const isAuthPage =
					pathname.startsWith("/login") || pathname.startsWith("/register");
				const isApiPage = pathname.startsWith("/api");
				const isRateLimitedApi = shouldRateLimitApi(pathname);
				const method = request.method.toUpperCase();
				const isOnboardingWhitelistedPage = ONBOARDING_WHITELIST_ROUTES.includes(
					pathname
				) || ONBOARDING_WHITELIST_ROUTE_PREFIXES.some(
					(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
				);
				const exactApiRoutes: readonly string[] =
					method in ONBOARDING_WHITELIST_API_ROUTES.exact
						? ONBOARDING_WHITELIST_API_ROUTES.exact[
								method as keyof typeof ONBOARDING_WHITELIST_API_ROUTES.exact
							]
						: [];
				const prefixApiRoutes: readonly string[] =
					method in ONBOARDING_WHITELIST_API_ROUTES.prefix
						? ONBOARDING_WHITELIST_API_ROUTES.prefix[
								method as keyof typeof ONBOARDING_WHITELIST_API_ROUTES.prefix
							]
						: [];
				const isOnboardingWhitelistedApi =
					isApiPage &&
					(exactApiRoutes.includes(pathname) ||
						prefixApiRoutes.some((route: string) =>
							pathname.startsWith(route)
						));
				const isOnboardingWhitelisted =
					isOnboardingWhitelistedPage || isOnboardingWhitelistedApi;
				if (isAuthPage) {
					if (isAuth) {
						// Check if user needs onboarding
						if (token.hasCompletedOnboarding === false) {
							return NextResponse.redirect(
								new URL("/onboarding", request.url)
							);
						}
						return NextResponse.redirect(
							new URL(DEFAULT_LOGGED_IN_ROUTE, request.url)
						);
					}

					return NextResponse.next();
				}

				if (isApiPage) {
					if (isRateLimitedApi && !isCronJobRoute && isRateLimited(request)) {
						return NextResponse.json(
							{ error: "Too many requests" },
							{ status: 429 }
						);
					}

					if (isAuth || isAllowedRequestWithoutToken || isCronJobRoute) {
						if (isCronJobRoute) {
							if (isValidCronJobRequest(request)) {
								return NextResponse.next();
							}
							return NextResponse.json(
								{ error: "Forbidden" },
								{ status: 403 }
							);
						}
					// Enforce onboarding restrictions for authenticated API calls.
					// Only explicitly whitelisted API routes should work before onboarding.
					// Routes that are allowed without token should also bypass onboarding check.
					if (
						isAuth &&
						token.hasCompletedOnboarding === false &&
						!isOnboardingWhitelisted &&
						!isAllowedRequestWithoutToken
					) {
						return NextResponse.json(
							{ error: "Please complete onboarding first" },
							{ status: 403 }
						);
					}
						return NextResponse.next();
					}
				}

				if (!isAuth) {
					if (isApiPage) {
						return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
					}
					let from = pathname;
					if (request.nextUrl.search) {
						from += request.nextUrl.search;
					}

					return NextResponse.redirect(
						new URL(`/login?callbackUrl=${encodeURIComponent(from)}`, request.url)
					);
				}

				// Check if authenticated user needs onboarding
				if (
					isAuth &&
					token.hasCompletedOnboarding === false &&
					!isOnboardingWhitelisted
				) {
					return NextResponse.redirect(
						new URL("/onboarding", request.url)
					);
				}

				return NextResponse.next();
			} catch (error) {
				// If there's an error getting the token (e.g., invalid/corrupted token),
				// treat as unauthenticated and redirect to login
				console.error("Auth middleware error:", error);
				
				const isAuthPage =
					pathname.startsWith("/login") || pathname.startsWith("/register");
				
				if (!isAuthPage) {
					let from = pathname;
					if (request.nextUrl.search) {
						from += request.nextUrl.search;
					}

					return NextResponse.redirect(
						new URL(`/login?callbackUrl=${encodeURIComponent(from)}`, request.url)
					);
				}
				
				return NextResponse.next();
			}
		},
		{
			callbacks: {
				async authorized() {
					// This is a work-around for handling redirect on auth pages.
					// We return true here so that the middleware function above
					// is always called.
					return true;
				},
			},
		}
	);
}
