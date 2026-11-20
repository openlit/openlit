import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { errorResponse } from "@/utils/api-response";
import asaw from "@/utils/asaw";
import { withScannerAccess, withScannerAudit } from "@/lib/access/scanner-route";
import {
	latestScannerEnrichRun,
	startScannerEnrich,
} from "@/lib/platform/connectors/scanner/enrich-crud";
import {
	isScannerEnrichAlertNumber,
	parseScannerEnrichInput,
} from "@/lib/platform/connectors/scanner/enrich-params";
import { isScannerJobId } from "@/lib/platform/connectors/scanner/job-findings";
import {
	SCANNER_ENRICH_FAILED,
	SCANNER_ENRICH_FINDING_INVALID,
	SCANNER_INVALID_JSON,
	SCANNER_JOB_ID_INVALID,
} from "@/constants/messages/en";

async function GETHandler(request: Request, { params }: { params: { id: string } }) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });
	const { searchParams } = new URL(request.url);
	const jobId = searchParams.get("jobId") || "";
	if (!isScannerJobId(jobId)) {
		return Response.json({ err: SCANNER_JOB_ID_INVALID }, { status: 400 });
	}
	const alertNumber = Number(searchParams.get("alertNumber"));
	if (!isScannerEnrichAlertNumber(alertNumber)) {
		return Response.json({ err: SCANNER_ENRICH_FINDING_INVALID }, { status: 400 });
	}
	const [err, run] = await asaw(latestScannerEnrichRun(params.id, jobId, alertNumber));
	if (err) return errorResponse(err, SCANNER_ENRICH_FAILED);
	return Response.json({ run });
}

async function POSTHandler(request: NextRequest, { params }: { params: { id: string } }) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });
	let body: Record<string, unknown> = {};
	try {
		const text = await request.text();
		if (text.trim()) body = JSON.parse(text) as Record<string, unknown>;
	} catch {
		return Response.json({ err: SCANNER_INVALID_JSON }, { status: 400 });
	}
	const [err, run] = await asaw(
		(async () => startScannerEnrich(params.id, parseScannerEnrichInput(body)))()
	);
	if (err) return errorResponse(err, SCANNER_ENRICH_FAILED);
	return Response.json({ run });
}

export const GET = withScannerAccess("read", GETHandler);
export const POST = withScannerAudit(withScannerAccess("enrich", POSTHandler));
