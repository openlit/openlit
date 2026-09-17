import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { errorResponse } from "@/utils/api-response";
import asaw from "@/utils/asaw";
import { withScannerAccess, withScannerAudit } from "@/lib/access/scanner-route";
import { runScannerJob } from "@/lib/platform/connectors/scanner/crud";
import { parseScannerScanInput } from "@/lib/platform/connectors/scanner/scan-params";
import { SCANNER_INVALID_JSON, SCANNER_SCAN_FAILED } from "@/constants/messages/en";

export const maxDuration = 300;

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
	const [err, result] = await asaw(runScannerJob(params.id, parseScannerScanInput(body)));
	if (err) return errorResponse(err, SCANNER_SCAN_FAILED);
	return Response.json(result);
}

export const POST = withScannerAudit(withScannerAccess("scan", POSTHandler));
