import { getCurrentUser } from "@/lib/session";
import { errorResponse } from "@/utils/api-response";
import asaw from "@/utils/asaw";
import { withScannerAccess } from "@/lib/access/scanner-route";
import { getScannerForgeRun } from "@/lib/platform/connectors/scanner/forge-crud";
import { isScannerForgeRunId } from "@/lib/platform/connectors/scanner/forge-runs";
import { SCANNER_FORGE_RUN_ID_INVALID, SCANNER_LOAD_FAILED } from "@/constants/messages/en";

async function GETHandler(
	_request: Request,
	{ params }: { params: { id: string; runId: string } }
) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });
	if (!isScannerForgeRunId(params.runId)) {
		return Response.json({ err: SCANNER_FORGE_RUN_ID_INVALID }, { status: 400 });
	}
	const [err, run] = await asaw(getScannerForgeRun(params.id, params.runId));
	if (err) return errorResponse(err, SCANNER_LOAD_FAILED);
	return Response.json({ run });
}

export const GET = withScannerAccess("read", GETHandler);
