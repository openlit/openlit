import { NextRequest, NextResponse } from "next/server";
import { getAPIKeyInfo } from "@/lib/platform/api-keys";

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
			});
		}
	} catch (e) {
		console.error("Auth verification route error:", e);
	}

	return NextResponse.json({ valid: false }, { status: 401 });
}
