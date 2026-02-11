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
	CRON_JOB_ROUTES,
	ONBOARDING_WHITELIST_ROUTES,
	ONBOARDING_WHITELIST_API_ROUTES,
} from "@/constants/route";

export default function checkAuth(next: NextMiddleware) {
	return withAuth(
		async function middleware(request: NextRequest, _next: NextFetchEvent) {
			const pathname = request.nextUrl.pathname;
			if (
				pathname.startsWith("/_next") ||
				pathname.startsWith("/static") ||
				pathname.startsWith("/images")
			) {
				return next(request, _next);
			}

			try {
				const token = await getToken({ req: request });
				const isAuth = !!token;
				const isAllowedRequestWithoutToken =
					ALLOWED_OPENLIT_ROUTES_WITHOUT_TOKEN.includes(pathname);
				const isCronJobRoute = CRON_JOB_ROUTES.includes(pathname);
				const isAuthPage =
					pathname.startsWith("/login") || pathname.startsWith("/register");
				const isApiPage = pathname.startsWith("/api");
				const method = request.method.toUpperCase();
				const isOnboardingWhitelistedPage = ONBOARDING_WHITELIST_ROUTES.includes(
					pathname
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
					if (isAuth || isAllowedRequestWithoutToken || isCronJobRoute) {
						if (isCronJobRoute) {
							const cronJobToken = request.headers.get("X-CRON-JOB");
							if (cronJobToken) {
								return NextResponse.next();
							}
						}
						// Enforce onboarding restrictions for authenticated API calls.
						// Only explicitly whitelisted API routes should work before onboarding.
						if (
							isAuth &&
							token.hasCompletedOnboarding === false &&
							!isOnboardingWhitelisted
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
