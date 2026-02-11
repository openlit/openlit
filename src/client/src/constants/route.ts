export const DEFAULT_LOGGED_IN_ROUTE = "/home";
export const ALLOWED_OPENLIT_ROUTES_WITHOUT_TOKEN = [
	"/api/prompt/get-compiled",
	"/api/vault/get-secrets",
];

export const CRON_JOB_ROUTES = ["/api/evaluation/auto"];

// Non-API routes that are accessible without completing onboarding
export const ONBOARDING_WHITELIST_ROUTES = ["/onboarding"];

// API routes that are accessible without completing onboarding.
// Prefix entries must include a trailing slash to avoid overmatching sibling routes.
export const ONBOARDING_WHITELIST_API_ROUTES = {
	exact: {
		GET: ["/api/organisation", "/api/organisation/invitation", "/api/user/profile"],
		POST: ["/api/organisation", "/api/user/complete-onboarding"],
	},
	prefix: {
		POST: ["/api/organisation/current/", "/api/organisation/invitation/"],
		DELETE: ["/api/organisation/invitation/"],
	},
} as const;

// Route format is methodtype: routepathregex[]
export const RESTRICTED_DEMO_ACCOUNT_ROUTES: Record<string, string[]> = {
	POST: ["/api/db-config", "/api/user/profile"],
	PUT: ["/api/db-config", "/api/vault"],
	DELETE: ["/api/db-config", "/api/api-key", "/api/vault", "/api/prompt-hub"],
};
