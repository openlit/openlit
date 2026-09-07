import { getCurrentUser } from "@/lib/session";
import { errorResponse } from "@/utils/api-response";
import asaw from "@/utils/asaw";
import { withScannerAccess } from "@/lib/access/scanner-route";
import { lookupLatestScannerFindingsForRepo } from "@/lib/platform/connectors/scanner/lookup";
import {
	SCANNER_LOAD_FAILED,
	SCANNER_TARGET_REQUIRED,
} from "@/constants/messages/en";

async function GETHandler(request: Request) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });
	const { searchParams } = new URL(request.url);
	const repoUrl = searchParams.get("repoUrl") || "";
	if (!repoUrl.trim()) {
		return Response.json({ err: SCANNER_TARGET_REQUIRED }, { status: 400 });
	}
	const [err, result] = await asaw(
		lookupLatestScannerFindingsForRepo({ repoUrl })
	);
	if (err) return errorResponse(err, SCANNER_LOAD_FAILED);
	return Response.json(result);
}

export const GET = withScannerAccess("read", GETHandler);
