import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { errorResponse } from "@/utils/api-response";
import asaw from "@/utils/asaw";
import { withScannerAccess, withScannerAudit } from "@/lib/access/scanner-route";
import { runScannerForge } from "@/lib/platform/connectors/scanner/forge-crud";
import { parseScannerForgeInput } from "@/lib/platform/connectors/scanner/forge-params";
import type { ScannerForgeRunInput } from "@/lib/platform/connectors/scanner/types";
import { SCANNER_FORGE_FAILED, SCANNER_INVALID_JSON } from "@/constants/messages/en";

export const maxDuration = 120;

async function POSTHandler(
	request: NextRequest,
	{ params }: { params: { id: string } }
) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });
	let body: Record<string, unknown> = {};
	try {
		const text = await request.text();
		if (text.trim()) body = JSON.parse(text) as Record<string, unknown>;
	} catch {
		return Response.json({ err: SCANNER_INVALID_JSON }, { status: 400 });
	}
	let input: ScannerForgeRunInput;
	try {
		input = parseScannerForgeInput(body);
	} catch (error) {
		return Response.json(
			{ err: error instanceof Error ? error.message : SCANNER_FORGE_FAILED },
			{ status: 400 }
		);
	}
	const [err, result] = await asaw(runScannerForge(params.id, input));
	if (err) return errorResponse(err, SCANNER_FORGE_FAILED);
	return Response.json(result);
}

export const POST = withScannerAudit(withScannerAccess("scan", POSTHandler));
