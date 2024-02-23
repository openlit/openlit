import { getToken } from "next-auth/jwt";
import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

const DEFAULT_ROUTE = "/getting-started";

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
		const isAuthPage =
			pathname.startsWith("/login") || pathname.startsWith("/register");
		const isApiPage = pathname.startsWith("/api");

		if (isAuthPage) {
			if (isAuth) {
				return NextResponse.redirect(new URL(DEFAULT_ROUTE, req.url));
			}

			return null;
		}

		if (isApiPage) {
			if (isAuth) {
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
		"/api-keys",
		"/requests",
	],
};
