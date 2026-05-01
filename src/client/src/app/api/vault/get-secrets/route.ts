import { SERVER_EVENTS } from "@/constants/events";
import getMessage from "@/constants/messages";
import { SecretGetFiltersWithApiKey } from "@/types/vault";
import { getSecretsFromDatabaseId } from "@/lib/platform/vault";
import PostHogServer from "@/lib/posthog";
import asaw from "@/utils/asaw";

const CORS_METHODS = "POST, OPTIONS";
const CORS_HEADERS = "Content-Type, Authorization";

function getConfiguredAllowedOrigins() {
	return [
		process.env.OPENLIT_ALLOWED_CORS_ORIGINS,
		process.env.OPENLIT_ALLOWED_ORIGINS,
		process.env.NEXTAUTH_URL,
	]
		.filter(Boolean)
		.flatMap((originList) => originList!.split(","))
		.map((origin) => origin.trim())
		.filter(Boolean);
}

function getAllowedCorsOrigin(request: Request) {
	const origin = request.headers.get("Origin");
	if (!origin) return null;

	const host = request.headers.get("Host");
	try {
		const originUrl = new URL(origin);
		if (host && originUrl.host === host) {
			return origin;
		}
	} catch {
		return null;
	}

	return getConfiguredAllowedOrigins().includes(origin) ? origin : null;
}

function getCorsHeaders(origin: string) {
	return {
		"Access-Control-Allow-Origin": origin,
		"Access-Control-Allow-Methods": CORS_METHODS,
		"Access-Control-Allow-Headers": CORS_HEADERS,
		"Vary": "Origin",
	};
}

export async function POST(request: Request) {
	const startTimestamp = Date.now();
	const corsOrigin = getAllowedCorsOrigin(request);
	const requestOrigin = request.headers.get("Origin");

	if (requestOrigin && !corsOrigin) {
		return Response.json(
			{ err: "Origin not allowed", res: null },
			{ status: 403 }
		);
	}

	const authorizationHeader = request.headers.get("Authorization") || "";
	let apiKey: string = "";
	if (authorizationHeader.startsWith("Bearer ")) {
		apiKey = authorizationHeader.replace(/^Bearer /, "");
	} else {
		return Response.json({
			err: getMessage().NO_API_KEY,
			res: null,
		});
	}

	const formData = await request.json();

	const filters: SecretGetFiltersWithApiKey = {
		apiKey,
		key: formData.key,
		tags: formData.tags,
	};

	const [err, data]: any = await asaw(getSecretsFromDatabaseId(filters));
	PostHogServer.fireEvent({
		event: err
			? SERVER_EVENTS.VAULT_SECRET_SDK_FETCH_FAILURE
			: SERVER_EVENTS.VAULT_SECRET_SDK_FETCH_SUCCESS,
		properties: {
			downloadSource: formData.source,
		},
		startTimestamp,
	});

	return Response.json(
		{
			err,
			res: data,
		},
		{
			headers: corsOrigin ? getCorsHeaders(corsOrigin) : undefined,
		}
	);
}

export async function OPTIONS(request: Request) {
	const corsOrigin = getAllowedCorsOrigin(request);
	if (!corsOrigin) {
		return new Response(null, { status: 403 });
	}

	return new Response(null, {
		status: 204,
		headers: getCorsHeaders(corsOrigin),
	});
}
