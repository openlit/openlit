import { NextRequest, NextResponse } from "next/server";
import { getAPIKeyInfo } from "@/lib/platform/api-keys";
import { getApiKeyScopes } from "@/lib/platform/api-key-access/server";

export async function GET(request: NextRequest) {
	const authHeader = request.headers.get("Authorization") || "";
	if (!authHeader.startsWith("Bearer ")) {
		return NextResponse.json({ valid: false }, { status: 401 });
	}

	const apiKey = authHeader.replace(/^Bearer /, "").trim();
	if (!apiKey) {
		return NextResponse.json({ valid: false }, { status: 401 });
	}

	try {
		const [err, apiInfo] = await getAPIKeyInfo({ apiKey });

		if (!err && apiInfo?.databaseConfigId) {
			return NextResponse.json({
				valid: true,
				databaseConfigId: apiInfo.databaseConfigId,
				organisationId: apiInfo.organisationId || null,
				projectId: apiInfo.projectId || null,
				environment: apiInfo.environment || "production",
				// null = full access; an array restricts the key to those features.
				scopes: await getApiKeyScopes(apiInfo.id),
			});
		}
	} catch (e) {
		console.error("Auth verification route error:", e);
	}

	return NextResponse.json({ valid: false }, { status: 401 });
}
