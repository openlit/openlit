import { withAudit } from "@/lib/audit/route";
import { withCurrentOrganisationPermission } from "@/lib/rbac/current";
import { deleteSecret } from "@/lib/platform/vault";

async function DELETEHandler(_: Request, context: any) {
	const { id } = context.params;
	const [err, res] = await deleteSecret(id);
	if (err) {
		return Response.json(err, {
			status: 400,
		});
	}

	return Response.json(res);
}

export const DELETE = withAudit(withCurrentOrganisationPermission("vault:delete", DELETEHandler));
