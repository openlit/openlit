import { getToken } from "next-auth/jwt";
import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

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
				return NextResponse.redirect(new URL("/dashboard", req.url));
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
		"/dashboard",
		"/api-keys",
		"/requests",
	],
};
