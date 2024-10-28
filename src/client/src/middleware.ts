import { getToken } from "next-auth/jwt";
import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import {
	DEFAULT_LOGGED_IN_ROUTE,
	ALLOWED_OPENLIT_ROUTES_WITHOUT_TOKEN,
} from "@/constants/route";

export default withAuth(
	async function middleware(req) {
		const pathname = req.nextUrl.pathname;
		if (
			pathname.startsWith("/_next") ||
			pathname.startsWith("/static") ||
			pathname.startsWith("/images")
		)
			return NextResponse.next();

		const token = await getToken({ req });
		const isAuth = !!token;
		const isAllowedRequestWithoutToken =
			ALLOWED_OPENLIT_ROUTES_WITHOUT_TOKEN.includes(pathname);
		const isAuthPage =
			pathname.startsWith("/login") || pathname.startsWith("/register");
		const isApiPage = pathname.startsWith("/api");

		if (isAuthPage) {
			if (isAuth) {
				return NextResponse.redirect(new URL(DEFAULT_LOGGED_IN_ROUTE, req.url));
			}

			return null;
		}

		if (isApiPage) {
			if (isAuth || isAllowedRequestWithoutToken) {
				return NextResponse.next();
			}
		}

		if (!isAuth) {
			let from = pathname;
			if (req.nextUrl.search) {
				from += req.nextUrl.search;
			}

			return NextResponse.redirect(
				new URL(`/login?callbackUrl=${encodeURIComponent(from)}`, req.url)
			);
		}
	},
	{
		callbacks: {
			authorized() {
				// This is a work-around for handling redirect on auth pages.
				// We return true here so that the middleware function above
				// is always called.
				return true;
			},
		},
	}
);

export const config = {
	matcher: [
		"/api/:path*",
		"/login",
		"/register",
		"/getting-started",
		"/dashboard",
		"/requests",
		"/database-config",
		"/openground",
		"/exceptions",
		"/prompt-hub",
		"/vault",
		"/api-keys",
	],
};
