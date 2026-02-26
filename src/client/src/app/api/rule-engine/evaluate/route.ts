import { EvaluateInput } from "@/types/rule-engine";
import { evaluateRules } from "@/lib/platform/rule-engine/evaluate";
import { getAPIKeyInfo } from "@/lib/platform/api-keys";
import { getCurrentUser } from "@/lib/session";
import getMessage from "@/constants/messages";
import asaw from "@/utils/asaw";

export async function POST(request: Request) {
	// --- Authentication ---
	// Prefer Bearer token (external API usage); fall back to session auth.
	const authorizationHeader = request.headers.get("Authorization") || "";
	let databaseConfigId: string | undefined;

	if (authorizationHeader.startsWith("Bearer ")) {
		const apiKey = authorizationHeader.replace(/^Bearer /, "").trim();
		if (!apiKey) {
			return Response.json({ err: getMessage().NO_API_KEY }, { status: 401 });
		}

		const [keyErr, apiInfo] = await getAPIKeyInfo({ apiKey });
		if (keyErr || !apiInfo?.databaseConfigId) {
			return Response.json({ err: getMessage().NO_API_KEY }, { status: 401 });
		}

		databaseConfigId = apiInfo.databaseConfigId;
	} else {
		// Session-based auth (dashboard usage)
		const user = await getCurrentUser();
		if (!user) {
			return Response.json({ err: getMessage().UNAUTHORIZED_USER }, { status: 401 });
		}
	}

	// --- Parse request body ---
	let body: any;
	try {
		body = await request.json();
	} catch {
		return Response.json({ err: "Invalid JSON body" }, { status: 400 });
	}

	// --- Validate entity_type ---
	const VALID_ENTITY_TYPES = ["context", "prompt", "dataset", "meta_config"] as const;
	const entityType = body?.entity_type;
	if (!entityType || !VALID_ENTITY_TYPES.includes(entityType)) {
		return Response.json(
			{ err: `entity_type is required and must be one of: ${VALID_ENTITY_TYPES.join(", ")}` },
			{ status: 400 }
		);
	}

	// --- Validate fields ---
	const rawFields = body?.fields;
	if (!rawFields || typeof rawFields !== "object" || Array.isArray(rawFields)) {
		return Response.json(
			{ err: "fields must be a non-null object" },
			{ status: 400 }
		);
	}

	// Only allow primitive field values (string | number | boolean); drop anything else.
	// Enforce per-key and per-value length limits to prevent oversized UNION ALL queries.
	const MAX_FIELDS = 50;
	const MAX_KEY_LENGTH = 100;
	const MAX_VALUE_LENGTH = 1000;

	const sanitizedFields: Record<string, string | number | boolean> = {};
	for (const [key, value] of Object.entries(rawFields)) {
		if (typeof key !== "string") continue;
		const trimmedKey = key.trim();
		if (trimmedKey.length === 0 || trimmedKey.length > MAX_KEY_LENGTH) continue;
		if (
			typeof value === "string" &&
			value.length <= MAX_VALUE_LENGTH
		) {
			sanitizedFields[trimmedKey] = value;
		} else if (typeof value === "number" || typeof value === "boolean") {
			sanitizedFields[trimmedKey] = value;
		}
	}

	if (Object.keys(sanitizedFields).length === 0) {
		return Response.json(
			{ err: "fields must contain at least one valid key-value pair" },
			{ status: 400 }
		);
	}

	if (Object.keys(sanitizedFields).length > MAX_FIELDS) {
		return Response.json(
			{ err: `fields must not exceed ${MAX_FIELDS} entries` },
			{ status: 400 }
		);
	}

	const evaluateInput: EvaluateInput = {
		fields: sanitizedFields,
		entity_type: entityType,
		include_entity_data: body?.include_entity_data === true,
		entity_inputs: body?.entity_inputs && typeof body.entity_inputs === "object" && !Array.isArray(body.entity_inputs)
			? body.entity_inputs
			: undefined,
	};

	const [err, res]: any = await asaw(evaluateRules(evaluateInput, databaseConfigId));
	if (err) {
		// Return a generic message — do not expose internal ClickHouse errors to callers.
		return Response.json({ err: "Failed to evaluate rules" }, { status: 400 });
	}

	return Response.json(res);
}

export async function OPTIONS() {
	return new Response(null, {
		status: 200,
		headers: {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, Authorization",
		},
	});
}
