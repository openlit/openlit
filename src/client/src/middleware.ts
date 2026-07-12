import { chain } from "@/middleware/chain";
import checkAuth from "@/middleware/check-auth";
import checkCsrf from "@/middleware/check-csrf";
import checkDemoAccount from "@/middleware/check-demo-account";

export const middleware = chain([
	checkCsrf,
	checkDemoAccount,
	// @ts-expect-error Type 'NextMiddlewareWithAuth' is not assignable to type 'NextMiddleware'.
	checkAuth,
]);

// IMPORTANT: `config.matcher` MUST be a compile-time constant. Next.js
// statically analyzes this array at build time and silently falls back to a
// match-everything matcher (`^/.*$`) if it can't — which makes the whole
// middleware stack (CSRF, auth, rate-limit) run on every request, including
// static assets under /images and /static (those then 500 on the static-asset
// short-circuit) and public files like /robots.txt (those redirect to /login).
// Do NOT spread an imported binding (e.g. a shared/enterprise matcher array)
// in here — that is exactly what breaks the static analysis. The enterprise
// build extends the matched routes by overriding this filesystem-routed file
// with its own static literal, not by injecting values at runtime.
export const config = {
	matcher: [
		"/api/:path*",
		"/login",
		"/register",
		"/getting-started",
		"/dashboard",
		"/telemetry",
		"/telemetry/:path*",
		"/observability",
		"/observability/:path*",
		"/requests",
		"/openground",
		"/exceptions",
		"/prompt-hub",
		"/vault",
		"/settings/:path*",
		"/telemetry-enabled",
		"/home",
		"/dashboards/:path*",
		"/d/:path*",
		"/fleet-hub",
		"/agents",
		"/agents/:path*",
		"/onboarding",
		"/chat",
		"/chat/:path*"
	],
};
