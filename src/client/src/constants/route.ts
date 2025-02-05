export const DEFAULT_LOGGED_IN_ROUTE = "/getting-started";
export const ALLOWED_OPENLIT_ROUTES_WITHOUT_TOKEN = [
	"/api/prompt/get-compiled",
	"/api/vault/get-secrets",
];

// Route format is methodtype: routepathregex[]
export const RESTRICTED_DEMO_ACCOUNT_ROUTES: Record<string, string[]> = {
	POST: ["/api/db-config", "/api/user/profile"],
	PUT: ["/api/db-config", "/api/vault"],
	DELETE: ["/api/db-config", "/api/api-key", "/api/vault", "/api/prompt-hub"],
};
