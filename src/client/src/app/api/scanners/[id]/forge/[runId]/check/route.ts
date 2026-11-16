import { getCurrentUser } from "@/lib/session";
import { errorResponse } from "@/utils/api-response";
import asaw from "@/utils/asaw";
import { withScannerAccess } from "@/lib/access/scanner-route";
import { checkScannerForgeRun } from "@/lib/platform/connectors/scanner/forge-crud";
import { isScannerForgeRunId } from "@/lib/platform/connectors/scanner/forge-runs";
import { SCANNER_FORGE_CHECK_FAILED, SCANNER_FORGE_RUN_ID_INVALID } from "@/constants/messages/en";

export const maxDuration = 60;

async function GETHandler(
	_request: Request,
	{ params }: { params: { id: string; runId: string } }
) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });
	if (!isScannerForgeRunId(params.runId)) {
		return Response.json({ err: SCANNER_FORGE_RUN_ID_INVALID }, { status: 400 });
	}
	const [err, check] = await asaw(checkScannerForgeRun(params.id, params.runId));
	if (err) return errorResponse(err, SCANNER_FORGE_CHECK_FAILED);
	return Response.json({ check });
}

export const GET = withScannerAccess("read", GETHandler);
