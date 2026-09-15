import { withAudit } from "@/lib/audit/route";
import { withCurrentOrganisationPermission } from "@/lib/rbac/current";
import { getFeatureHandler } from "@/lib/platform/controller/features";
import { withControllerProduct } from "@/lib/platform/controller/product";

async function POSTHandler(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;
	const handler = getFeatureHandler("lifecycle")!;
	return handler.applyOperation(id, "stop", {});
}

export const POST = withControllerProduct(
	withAudit(withCurrentOrganisationPermission("controller:operate", POSTHandler))
);
