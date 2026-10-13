import { getCurrentUser } from "@/lib/session";
import { errorResponse } from "@/utils/api-response";
import asaw from "@/utils/asaw";
import { withScannerAccess } from "@/lib/access/scanner-route";
import { listScannerJobFindings } from "@/lib/platform/connectors/scanner/crud";
import {
	SCANNER_FINDINGS_LOAD_FAILED,
	SCANNER_JOB_ID_INVALID,
} from "@/constants/messages/en";
import { isScannerJobId } from "@/lib/platform/connectors/scanner/job-findings";

async function GETHandler(
	request: Request,
	{ params }: { params: { id: string; jobId: string } }
) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });
	if (!isScannerJobId(params.jobId)) {
		return Response.json({ err: SCANNER_JOB_ID_INVALID }, { status: 400 });
	}
	const { searchParams } = new URL(request.url);
	const [err, result] = await asaw(
		listScannerJobFindings(params.id, params.jobId, {
			q: searchParams.get("q") || "",
			severity: searchParams.get("severity") || "all",
			page: searchParams.get("page") || "1",
			limit: searchParams.get("limit") || "",
		})
	);
	if (err) return errorResponse(err, SCANNER_FINDINGS_LOAD_FAILED);
	return Response.json(result);
}

export const GET = withScannerAccess("read", GETHandler);
