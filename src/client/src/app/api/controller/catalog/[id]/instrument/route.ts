import { withAudit } from "@/lib/audit/route";
import { withCurrentOrganisationPermission } from "@/lib/rbac/current";
import { getFeatureHandler } from "@/lib/platform/controller/features";

async function POSTHandler(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;
	const handler = getFeatureHandler("instrumentation")!;
	return handler.applyOperation(id, "enable", {});
}

export const POST = withAudit(withCurrentOrganisationPermission("controller:operate", POSTHandler));
