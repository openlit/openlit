import { withAudit } from "@/lib/audit/route";
import { withPermission } from "@/lib/rbac/route";
import {
	getOrganisationById,
	updateOrganisation,
	deleteOrganisation,
} from "@/lib/organisation";
import asaw from "@/utils/asaw";

async function GETHandler(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;

	const [err, res] = await asaw(getOrganisationById(id));
	if (err)
		return Response.json(err, {
			status: 400,
		});

	return Response.json(res);
}

async function PUTHandler(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;
	const formData = await request.json();

	const [err, res] = await asaw(
		updateOrganisation(id, { name: formData.name })
	);

	if (err)
		return Response.json(err, {
			status: 400,
		});

	return Response.json(res);
}

async function DELETEHandler(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;

	const [err, res] = await asaw(deleteOrganisation(id));

	if (err)
		return Response.json(err, {
			status: 400,
		});

	return Response.json(res);
}

export const GET = withPermission("organisation:read", GETHandler);
export const PUT = withAudit(withPermission("organisation:update", PUTHandler));
export const DELETE = withAudit(withPermission("organisation:delete", DELETEHandler));
