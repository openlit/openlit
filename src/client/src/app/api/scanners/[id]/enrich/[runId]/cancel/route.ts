import { getCurrentUser } from "@/lib/session";
import { errorResponse } from "@/utils/api-response";
import asaw from "@/utils/asaw";
import { withScannerAccess, withScannerAudit } from "@/lib/access/scanner-route";
import { cancelScannerEnrich } from "@/lib/platform/connectors/scanner/enrich-crud";
import { isScannerEnrichRunId } from "@/lib/platform/connectors/scanner/enrich-params";
import { SCANNER_ENRICH_FAILED, SCANNER_ENRICH_RUN_ID_INVALID } from "@/constants/messages/en";

async function POSTHandler(
	_request: Request,
	{ params }: { params: { id: string; runId: string } }
) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });
	if (!isScannerEnrichRunId(params.runId)) {
		return Response.json({ err: SCANNER_ENRICH_RUN_ID_INVALID }, { status: 400 });
	}
	const [err, run] = await asaw(cancelScannerEnrich(params.id, params.runId));
	if (err) return errorResponse(err, SCANNER_ENRICH_FAILED);
	return Response.json({ run });
}

export const POST = withScannerAudit(withScannerAccess("enrich", POSTHandler));
