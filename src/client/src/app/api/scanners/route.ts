import { getCurrentUser } from "@/lib/session";
import { errorResponse } from "@/utils/api-response";
import asaw from "@/utils/asaw";
import { withScannerAccess } from "@/lib/access/scanner-route";
import { listScannerConnectors } from "@/lib/platform/connectors/scanner/crud";
import { SCANNER_LOAD_FAILED } from "@/constants/messages/en";

async function GETHandler(_request: Request) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });
	const [err, connectors] = await asaw(listScannerConnectors());
	if (err) return errorResponse(err, SCANNER_LOAD_FAILED);
	return Response.json({ connectors: connectors || [] });
}

export const GET = withScannerAccess("read", GETHandler);
