import getMessage from "@/constants/messages";
import { PageHeader } from "@/types/store/page";

export interface BreadcrumbConfig {
	title: string;
	href: string;
}

export interface RouteConfig {
	regex: RegExp;
	getTitle: (pathname: string, params?: Record<string, string>) => string;
	getBreadcrumbs: (pathname: string, params?: Record<string, string>) => BreadcrumbConfig[];
	getDescription?: (pathname: string, params?: Record<string, string>) => string;
}

// Utility function to extract route parameters from pathname
export function extractRouteParams(pathname: string, regex: RegExp): Record<string, string> {
	const match = pathname.match(regex);
	if (!match) return {};
	
	const params: Record<string, string> = {};
	// Extract UUID from dashboard routes
	if (regex.source.includes('\\[0-9a-f\\]')) {
		const uuidMatch = pathname.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
		if (uuidMatch) {
			params.id = uuidMatch[0];
		}
	}
	
	// Extract prompt hub ID
	if (pathname.includes('/prompt-hub/') && !pathname.endsWith('/prompt-hub')) {
		const parts = pathname.split('/');
		const idIndex = parts.indexOf('prompt-hub') + 1;
		if (idIndex < parts.length) {
			params.id = parts[idIndex];
		}
	}
	
	// Extract vault ID
	if (pathname.includes('/vault/') && !pathname.endsWith('/vault')) {
		const parts = pathname.split('/');
		const idIndex = parts.indexOf('vault') + 1;
		if (idIndex < parts.length) {
			params.id = parts[idIndex];
		}
	}
	
	// Extract openground ID
	if (pathname.includes('/openground/') && !pathname.endsWith('/openground')) {
		const parts = pathname.split('/');
		const idIndex = parts.indexOf('openground') + 1;
		if (idIndex < parts.length) {
			params.id = parts[idIndex];
		}
	}

	// Coding-agents per-user detail: /coding-agents/users/<userId>.
	// `userId` is URL-encoded (emails contain `@` etc.) so we leave
	// decoding to the caller (the route config calls
	// decodeURIComponent before rendering the breadcrumb title).
	if (pathname.startsWith('/coding-agents/users/')) {
		const parts = pathname.split('/').filter(Boolean);
		if (parts.length >= 3) {
			params.userId = parts[2];
		}
	}

	return params;
}

// Route configurations for all pages
export const ROUTE_CONFIGS: RouteConfig[] = [
	// Home page
	{
		regex: /^\/home$/,
		getTitle: () => "Home",
		getBreadcrumbs: () => [],
	},
	
	// Dashboard routes
	{
		regex: /^\/dashboard$/,
		getTitle: () => "Dashboard",
		getBreadcrumbs: () => [],
	},
	
	// Individual dashboard view
	{
		regex: /^\/d\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		getTitle: () => "",
		getBreadcrumbs: () => [],
	},
	
	// Dashboard management
	{
		regex: /^\/dashboards$/,
		getTitle: () => "Dashboards",
		getBreadcrumbs: () => [],
	},
	
	{
		regex: /^\/dashboards\/board$/,
		getTitle: () => "Board",
		getBreadcrumbs: () => [
			{ title: "Dashboards", href: "/dashboards" }
		],
	},
	
	{
		regex: /^\/dashboards\/explorer$/,
		getTitle: () => "Explorer",
		getBreadcrumbs: () => [
			{ title: "Dashboards", href: "/dashboards" }
		],
	},
	
	{
		regex: /^\/dashboards\/widget$/,
		getTitle: () => "Widget",
		getBreadcrumbs: () => [
			{ title: "Dashboards", href: "/dashboards" }
		],
	},
	
	// Requests
	{
		regex: /^\/requests$/,
		getTitle: () => "Requests",
		getBreadcrumbs: () => [],
	},

	// Telemetry
	{
		regex: /^\/telemetry$/,
		getTitle: () => "Telemetry",
		getBreadcrumbs: () => [],
	},
	{
		regex: /^\/telemetry\/traces\/[^/]+$/,
		getTitle: () => "",
		getBreadcrumbs: () => [],
	},
	{
		regex: /^\/telemetry\/exceptions\/[^/]+$/,
		getTitle: () => "",
		getBreadcrumbs: () => [],
	},
	{
		regex: /^\/telemetry\/logs\/[^/]+$/,
		getTitle: () => "",
		getBreadcrumbs: () => [],
	},
	{
		regex: /^\/telemetry\/metrics\/[^/]+$/,
		getTitle: () => "",
		getBreadcrumbs: () => [],
	},
	
	// Exceptions
	{
		regex: /^\/exceptions$/,
		getTitle: () => "Exceptions",
		getBreadcrumbs: () => [],
	},
	
	// Prompt Hub
	{
		regex: /^\/prompt-hub$/,
		getTitle: () => getMessage().NAV_APP_PROMPTS,
		getBreadcrumbs: () => [],
	},
	{
		regex: /^\/prompt-hub\/new$/,
		getTitle: () => getMessage().PROMPT_HUB_CREATE_PROMPT,
		getBreadcrumbs: () => [],
	},
	{
		regex: /^\/prompt-hub\/[^/]+\/edit$/,
		getTitle: () => "",
		getBreadcrumbs: () => [],
	},
	{
		regex: /^\/prompt-hub\/[^/]+$/,
		getTitle: () => "",
		getBreadcrumbs: () => [],
	},
	
	// Vault
	{
		regex: /^\/vault$/,
		getTitle: () => "Vault",
		getBreadcrumbs: () => [],
	},
	
	{
		regex: /^\/vault\/[^/]+$/,
		getTitle: () => "",
		getBreadcrumbs: () => [],
	},

	// Rule Engine
	{
		regex: /^\/rule-engine$/,
		getTitle: () => getMessage().RULE_ENGINE_BREADCRUMB,
		getBreadcrumbs: () => [],
	},
	{
		regex: /^\/rule-engine\/[^/]+$/,
		getTitle: () => "",
		getBreadcrumbs: () => [],
	},

	// Openground
	{
		regex: /^\/openground$/,
		getTitle: () => "Openground",
		getBreadcrumbs: () => [],
	},
	
	{
		regex: /^\/openground\/[^/]+$/,
		getTitle: (pathname, params) => {
			if (pathname === "/openground/new") return getMessage().OPENGROUND_CREATE_NEW_PLAYGROUND;
			if (pathname === "/openground/models" || pathname === "/manage-models") return getMessage().OPENGROUND_MANAGE_MODELS;
			return params?.id ? getMessage().OPENGROUND_RUN_DETAILS : getMessage().FEATURE_OPENGROUND;
		},
		getBreadcrumbs: () => [
			{ title: getMessage().FEATURE_OPENGROUND, href: "/openground" }
		],
	},
	
	// Context
	{
		regex: /^\/context$/,
		getTitle: () => getMessage().CONTEXT_TITLE,
		getBreadcrumbs: () => [],
	},
	{
		regex: /^\/context\/new$/,
		getTitle: () => getMessage().CONTEXT_CREATE_NEW,
		getBreadcrumbs: () => [],
	},
	{
		regex: /^\/context\/[^/]+$/,
		getTitle: () => "",
		getBreadcrumbs: () => [],
	},

	// Settings
	{
		regex: /^\/settings$/,
		getTitle: () => "Settings",
		getBreadcrumbs: () => [],
	},
	
	{
		regex: /^\/settings\/profile$/,
		getTitle: () => "User Profile",
		getBreadcrumbs: () => [
			{ title: "Settings", href: "/settings" }
		],
	},
	
	{
		regex: /^\/evaluations\/settings$/,
		getTitle: () => "Evaluation Settings",
		getBreadcrumbs: () => [
			{ title: "Evaluations", href: "/evaluations" },
			{ title: "Settings", href: "/evaluations/settings" }
		],
	},
	{
		regex: /^\/evaluations\/types$/,
		getTitle: () => "Evaluation Types",
		getBreadcrumbs: () => [
			{ title: "Evaluations", href: "/evaluations" },
			{ title: "Evaluation Types", href: "/evaluations/types" }
		],
	},
	{
		regex: /^\/evaluations\/manual$/,
		getTitle: () => "Manual Marking",
		getBreadcrumbs: () => [
			{ title: "Evaluations", href: "/evaluations" },
			{ title: "Manual Marking", href: "/evaluations/manual" }
		],
	},
	{
		regex: /^\/evaluations\/?$/,
		getTitle: () => "Evaluations",
		getBreadcrumbs: () => [
			{ title: "Evaluations", href: "/evaluations" }
		],
	},
	
	{
		regex: /^\/settings\/database-config$/,
		getTitle: () => "Database Config",
		getBreadcrumbs: () => [
			{ title: "Settings", href: "/settings" }
		],
	},
	
	{
		regex: /^\/settings\/api-keys$/,
		getTitle: () => "API Keys",
		getBreadcrumbs: () => [
			{ title: "Settings", href: "/settings" }
		],
	},
	
	// Agents
	{
		regex: /^\/agents$/,
		getTitle: () => "Agents",
		getBreadcrumbs: () => [],
	},

	{
		regex: /^\/agents\/controller\/[^/]+$/,
		getTitle: () => "",
		getBreadcrumbs: () => [],
	},

	{
		regex: /^\/agents\/[^/]+$/,
		getTitle: () => "",
		getBreadcrumbs: () => [],
	},

	// Fleet Hub
	{
		regex: /^\/fleet-hub\/[^/]+$/,
		getTitle: () => "",
		getBreadcrumbs: () => [],
	},

	// Coding Agents — per-user drilldown.
	//
	// The per-user page lives under `/coding-agents/users/[userId]` (not
	// under `/agents/<key>` like the per-vendor detail page) because it
	// rolls up across vendors. Without an explicit route config the
	// breadcrumb generator falls through to the path-tail fallback,
	// which yields "Home › ishan.jain@grafana.com" — useless context for
	// the operator. We thread back through the Coding Agents tab on
	// the unified Agents hub so the user can backtrack out.
	{
		regex: /^\/coding-agents\/users\/[^/]+$/,
		getTitle: (_pathname, params) =>
			params?.userId ? decodeURIComponent(params.userId) : "User",
		getBreadcrumbs: () => [
			{ title: "Agents", href: "/agents" },
			{ title: getMessage().AGENTS_TAB_CODING, href: "/agents?tab=coding" },
			{ title: "Users", href: "/agents?tab=coding&codingTab=users" },
		],
	},

	// Chat
	{
		regex: /^\/chat$/,
		getTitle: () => getMessage().CHAT_TITLE,
		getBreadcrumbs: () => [],
		getDescription: () => getMessage().CHAT_DESCRIPTION,
	},
	{
		regex: /^\/chat\/settings$/,
		getTitle: () => getMessage().CHAT_SETTINGS_LINK,
		getBreadcrumbs: () => [
			{ title: getMessage().CHAT_TITLE, href: "/chat" }
		],
		getDescription: () => getMessage().CHAT_SETTINGS_DESCRIPTION,
	},
];

// Main function to generate page header based on pathname
export function generatePageHeader(pathname: string): PageHeader {
	const config = ROUTE_CONFIGS.find(({ regex }) => regex.test(pathname));
	
	if (!config) {
		// Fallback for unknown routes
		const pathParts = pathname.split('/').filter(Boolean);
		const title = pathParts[pathParts.length - 1]?.replace(/-/g, ' ') || 'Page';
		
		return {
			title: title.charAt(0).toUpperCase() + title.slice(1),
			breadcrumbs: [],
		};
	}
	
	const params = extractRouteParams(pathname, config.regex);
	
	return {
		title: config.getTitle(pathname, params),
		description: config.getDescription?.(pathname, params),
		breadcrumbs: config.getBreadcrumbs(pathname, params),
	};
}

// Hook for dynamic breadcrumb updates (for cases where you need to update title/description after data loads)
export function updatePageHeaderWithData(
	baseHeader: PageHeader,
	data: { title?: string; description?: string }
): PageHeader {
	return {
		...baseHeader,
		title: data.title || baseHeader.title,
		description: data.description || baseHeader.description,
	};
}
