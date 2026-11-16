import { getCurrentUser } from "@/lib/session";
import { errorResponse } from "@/utils/api-response";
import asaw from "@/utils/asaw";
import { withScannerAccess } from "@/lib/access/scanner-route";
import { listScannerEnrichProvidersFor } from "@/lib/platform/connectors/scanner/enrich-crud";
import { SCANNER_ENRICH_FAILED } from "@/constants/messages/en";

async function GETHandler(_request: Request, { params }: { params: { id: string } }) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });
	const [err, providers] = await asaw(listScannerEnrichProvidersFor(params.id));
	if (err) return errorResponse(err, SCANNER_ENRICH_FAILED);
	return Response.json({ providers });
}

export const GET = withScannerAccess("enrich", GETHandler);
